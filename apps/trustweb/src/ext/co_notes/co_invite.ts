// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 (co-notes-link): invitations to a co-created note. One invite = one link for ONE person (single use) or, advanced, an anonymous link anyone
 * holding it can open. The link is `?note=<id>#k=<key>`: the id is a mailbox name on the relay, the AES-GCM key stays in the fragment (a browser never
 * sends it to a server, I1). The sealed snapshot of the note waits in that mailbox; the relay's first-claim rule on reading it is what makes a link
 * single use (co_invite_relay.ts): the first device's read token claims the mailbox, every other device gets the same 404 as for an unknown link.
 * Pure and DOM-free; the sealing is WebCrypto.
 */
import { fromB64u, open, randomBytes, seal, toB64u } from '../../../../demo/src/crypto'
import { Ring, RINGS } from '../../model'
import type { BarId } from '../../bottom_bar'

export type InviteState = 'invited' | 'opened' | 'connected'
export type InviteMode = 'person' | 'anyone'

export interface CoInvite {
  /** 128-bit random id, 32 hex: also the relay mailbox name `co-invite:<id>`. */
  id: string
  noteId: string
  /** Typed name or the person's name, as I see it. */
  name: string
  /** The person's relay did when I know it (invite bound to that person). */
  did?: string
  personId?: string
  /** The ring the guest lands in, in MY web. Default Intending to connect (I9). */
  ring: Ring
  mode: InviteMode
  /** Anonymous links only: do I see that someone watches. */
  watch: boolean
  state: InviteState
  at: number
  openedAt?: number
  /** 256-bit AES-GCM key, base64url. Kept on my device to copy the link again; in the link it rides in the fragment only. */
  key: string
}

export interface InviteOwner { did: string; id: string; name: string }
export interface InviteLink { id: string; key: string; anonymous: boolean; watch: boolean; owner: InviteOwner }

/** A guest's shell on this device (AppState.coGuest): the note it opened, the owner, the event the note is linked to, whether it came by an anonymous link. */
export interface CoGuest { noteId: string; inviteId: string; owner: InviteOwner; anonymous: boolean; eventId?: string }

const ID_RE = /^[0-9a-f]{32}$/
const KEY_RE = /^[A-Za-z0-9_-]{43}$/
const NAME_MAX = 60
const INVITES_MAX = 200
const STATES: readonly string[] = ['invited', 'opened', 'connected']
const STATE_RANK: Record<InviteState, number> = { invited: 0, opened: 1, connected: 2 }
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const clamp = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')

export function newInvite(o: { noteId: string; name: string; now: number; did?: string; personId?: string; ring?: Ring; mode?: InviteMode; watch?: boolean }): CoInvite {
  const mode = o.mode ?? 'person'
  return {
    id: hex(randomBytes(16)), noteId: o.noteId, name: clamp(o.name, NAME_MAX), ring: o.ring ?? Ring.Intending, mode, watch: mode === 'anyone' && o.watch === true,
    state: 'invited', at: o.now, key: toB64u(randomBytes(32)), ...(o.did ? { did: o.did } : {}), ...(o.personId ? { personId: o.personId } : {}),
  }
}

/** One stored or received invite, cleaned; null when it is not one. Unknown fields drop; ring and state fall back to the safe value. */
export function cleanInvite(raw: unknown): CoInvite | null {
  const o = (raw ?? {}) as Record<string, unknown>
  if (typeof o.id !== 'string' || !ID_RE.test(o.id) || typeof o.key !== 'string' || !KEY_RE.test(o.key) || typeof o.noteId !== 'string' || !o.noteId) return null
  const mode: InviteMode = o.mode === 'anyone' ? 'anyone' : 'person'
  return {
    id: o.id, key: o.key, noteId: o.noteId.slice(0, 80), name: clamp(o.name, NAME_MAX), mode,
    ring: RINGS.includes(o.ring as Ring) ? (o.ring as Ring) : Ring.Intending, watch: mode === 'anyone' && o.watch === true,
    state: STATES.includes(o.state as string) ? (o.state as InviteState) : 'invited', at: Number.isFinite(o.at) ? (o.at as number) : 0,
    ...(Number.isFinite(o.openedAt) ? { openedAt: o.openedAt as number } : {}),
    ...(typeof o.did === 'string' && o.did ? { did: o.did.slice(0, 512) } : {}), ...(typeof o.personId === 'string' && o.personId ? { personId: o.personId.slice(0, 40) } : {}),
  }
}

export function cleanInvites(raw: unknown): CoInvite[] {
  const seen = new Set<string>()
  const out: CoInvite[] = []
  for (const r of Array.isArray(raw) ? raw : []) {
    const i = cleanInvite(r)
    if (i && !seen.has(i.id)) { seen.add(i.id); out.push(i) }
  }
  return out.slice(0, INVITES_MAX)
}

/** The state only moves forward; an anonymous link has no connection, so it stops at opened. */
export function advance(inv: CoInvite, to: InviteState, now: number): CoInvite {
  if (inv.mode === 'anyone' && to === 'connected') return inv
  if (STATE_RANK[to] <= STATE_RANK[inv.state]) return inv
  return { ...inv, state: to, ...(to === 'opened' && inv.openedAt === undefined ? { openedAt: now } : {}) }
}

/** `<origin>/?note=<id>&f=<owner did>&fi=<owner id>&fn=<owner name>#k=<key>[&a=1]`. The query tells the guest whom the gate names; the key is only in the fragment. */
export function inviteUrl(origin: string, inv: CoInvite, owner: InviteOwner): string {
  const u = new URL(origin)
  u.search = ''
  u.searchParams.set('note', inv.id)
  u.searchParams.set('f', owner.did)
  u.searchParams.set('fi', owner.id)
  u.searchParams.set('fn', owner.name)
  u.hash = `k=${inv.key}${inv.mode === 'anyone' ? `&a=1${inv.watch ? '&w=1' : ''}` : ''}`
  return u.toString()
}

/** The invitation an opened address carries; null for any other address, a bad id or key, or a key found in the query (I1: it never belongs there). */
export function parseInviteLink(search: string, hash: string): InviteLink | null {
  const q = new URLSearchParams(search)
  const f = new URLSearchParams(hash.replace(/^#/, ''))
  const id = q.get('note') ?? ''
  const key = f.get('k') ?? ''
  const did = q.get('f') ?? ''
  if (q.has('k') || !ID_RE.test(id) || !KEY_RE.test(key) || !did || did.length > 512) return null
  return { id, key, anonymous: f.get('a') === '1', watch: f.get('a') === '1' && f.get('w') === '1', owner: { did, id: clamp(q.get('fi'), 40), name: clamp(q.get('fn'), NAME_MAX) } }
}

/**
 * 64 hex the relay stores as the read claim of the invite mailbox. A person link: derived from the key AND this device's secret, so the first device
 * claims it and every other device fails. An anonymous link: from the key alone, so every holder reads.
 */
export async function readToken(key: string, deviceSecret: string, anonymous: boolean): Promise<string> {
  const material = new TextEncoder().encode(`trustweb-co-invite/read\0${key}\0${anonymous ? 'anyone' : deviceSecret}`)
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', material as BufferSource)))
}

const IV_BYTES = 12
const aesKey = (key: string): Promise<CryptoKey> => crypto.subtle.importKey('raw', fromB64u(key) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])

/** [12-byte IV][AES-GCM of `value` as JSON] under the invite key. */
export async function sealSnapshot(value: unknown, key: string): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES)
  const cipher = await seal(await aesKey(key), iv, new TextEncoder().encode(JSON.stringify(value)))
  const out = new Uint8Array(IV_BYTES + cipher.length)
  out.set(iv)
  out.set(cipher, IV_BYTES)
  return out
}

/** The JSON sealed under `key`; null for a wrong key, damaged bytes or no JSON. Never throws. */
export async function openSealed(bytes: Uint8Array, key: string): Promise<unknown> {
  try {
    if (bytes.length <= IV_BYTES) return null
    const plain = await open(await aesKey(key), bytes.slice(0, IV_BYTES), bytes.slice(IV_BYTES))
    return plain ? JSON.parse(new TextDecoder().decode(plain)) : null
  } catch {
    return null
  }
}

/** The ring to move a person to once they connected through this invite: only somebody who joined my web after the invite was made and still sits in a ring the app gave them; null = leave them. */
export function ringFor(inv: CoInvite, person: { ring: Ring; metAt: number }): Ring | null {
  return person.metAt >= inv.at && person.ring !== inv.ring && (person.ring === Ring.Acquaintance || person.ring === Ring.Intending) ? inv.ring : null
}

/** A typed name that matches nobody offers a single-use link for that name (trimmed); a match, or nothing typed, offers none. */
export const offerFor = (typed: string, matches: number): string | null => (!matches && typed.trim() ? typed.trim() : null)

export interface AccessRow { name: string; role: 'owner' | 'guest'; state?: InviteState; invite?: CoInvite }

/** "People with access": me as owner, then each invite. */
export const accessRows = (myName: string, invites: readonly CoInvite[]): AccessRow[] => [
  { name: myName, role: 'owner' },
  ...invites.map((invite): AccessRow => ({ name: invite.name, role: 'guest', state: invite.state, invite })),
]

/** The bottom bar of a guest: Web, Chat in the centre and highlighted, Resources; a note linked to an event adds Events and highlights that instead. */
export const guestShell = (isEvent: boolean): { tabs: BarId[]; primary: BarId } =>
  isEvent ? { tabs: ['web', 'chat', 'events', 'inventory'], primary: 'events' } : { tabs: ['web', 'chat', 'inventory'], primary: 'chat' }
