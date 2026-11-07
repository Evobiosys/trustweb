// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 (co-notes-link): the invite mailboxes on the notes relay (notes_relay.ts, services/trustweb-backup/notes_relay.mjs, unchanged).
 *   co-invite:<id>  the owner leaves the note's snapshot, sealed under the invite key. The relay lets the FIRST read token that finds mail claim the mailbox,
 *                   every other token gets the same 404 as for an unknown mailbox: that is the single use, with no new server code.
 *   co-open:<id>    the guest leaves "opened" (name, did) sealed under the same key; the owner reads and deletes it.
 * The relay sees opaque bytes and two random names; never the note, the key or a person. Never throws: false / refused / offline / [].
 */
import type { Identity } from '../../../../demo/src/did'
import { relayEnvelope, frameChunks, joinFrames, relayToken, RELAY_BLOB_MAX, type RelayDeps } from '../../notes_relay'
import { readToken, openSealed, sealSnapshot, type CoInvite, type InviteLink } from './co_invite'

const HEADER_BYTES = 20
const box = (kind: 'invite' | 'open', id: string): string => `co-${kind}:${id}`
const route = (d: RelayDeps, q = ''): string => `${d.origin}/notes/relay${q}`
const forQuery = (mailbox: string, id?: string): string => `?for=${encodeURIComponent(mailbox)}${id ? `&id=${id}` : ''}`
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const sha256Hex = async (s: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s) as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('')

/** The guest's name on the relay: not an identity, only a stable tag of this device so its posts can be told apart. */
const guestFrom = async (device: string): Promise<{ from: string; token: string }> => ({ from: `guest:${(await sha256Hex(`from\0${device}`)).slice(0, 32)}`, token: await sha256Hex(`send\0${device}`) })

async function post(d: RelayDeps, mailbox: string, from: string, token: string, bytes: Uint8Array): Promise<boolean> {
  try {
    for (const frame of frameChunks(bytes, RELAY_BLOB_MAX - HEADER_BYTES)) {
      const res = await d.fetch(route(d), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Token': token }, body: JSON.stringify(relayEnvelope(mailbox, from, frame, d.now())) })
      if (!res.ok) return false
    }
    return true
  } catch {
    return false
  }
}

type Fetched = { status: 'ok'; items: { id: string; frame: Uint8Array }[] } | { status: 'none' } | { status: 'offline' }

/** Every item of a mailbox as raw frames. 'none' = the relay's one 404 (nothing there, wrong token, unknown mailbox: not told apart). */
async function fetchBox(d: RelayDeps, mailbox: string, token: string): Promise<Fetched> {
  try {
    const headers = { 'X-Relay-Token': token }
    const list = await d.fetch(route(d, forQuery(mailbox)), { headers })
    if (list.status >= 500) return { status: 'offline' }
    if (!list.ok || !list.json) return { status: 'none' }
    const ids = (((await list.json()) as { items?: { id: string }[] }).items ?? []).map((i) => i.id)
    const items: { id: string; frame: Uint8Array }[] = []
    for (const id of ids) {
      const one = await d.fetch(route(d, forQuery(mailbox, id)), { headers })
      const blob = one.ok && one.json ? ((await one.json()) as { blob?: unknown }).blob : null
      if (typeof blob === 'string') items.push({ id, frame: unb64(blob) })
    }
    return items.length ? { status: 'ok', items } : { status: 'none' }
  } catch {
    return { status: 'offline' }
  }
}

/** The owner leaves the note's snapshot, sealed under the invite key, in the invite mailbox. */
export async function publishInvite(d: RelayDeps, me: Identity, inv: CoInvite, snapshot: unknown): Promise<boolean> {
  return post(d, box('invite', inv.id), me.did, await relayToken(me, 'send'), await sealSnapshot(snapshot, inv.key))
}

export type Claim = { ok: true; snapshot: unknown } | { ok: false; why: 'refused' | 'offline' }

/** A guest opens the link: reads the snapshot with this device's read token. A used link, an unknown one and a wrong key all answer 'refused'. */
export async function claimInvite(d: RelayDeps, link: InviteLink, device: string): Promise<Claim> {
  const got = await fetchBox(d, box('invite', link.id), await readToken(link.key, device, link.anonymous))
  if (got.status === 'offline') return { ok: false, why: 'offline' }
  if (got.status === 'none') return { ok: false, why: 'refused' }
  const bytes = joinFrames(got.items.map((i) => i.frame))
  const snapshot = bytes ? await openSealed(bytes, link.key) : null
  return snapshot === null ? { ok: false, why: 'refused' } : { ok: true, snapshot }
}

export interface Hello { name?: string; did?: string; at: number }

/** The guest tells the owner it opened the note (and, once connected, who it is). Sealed under the invite key. */
export async function reportOpened(d: RelayDeps, link: InviteLink, device: string, who: { name?: string; did?: string }, now: number): Promise<boolean> {
  const { from, token } = await guestFrom(device)
  return post(d, box('open', link.id), from, token, await sealSnapshot({ k: 'open', ...(who.name ? { name: who.name.slice(0, 60) } : {}), ...(who.did ? { did: who.did.slice(0, 512) } : {}), at: now }, link.key))
}

/** What guests left in the open mailbox of this invite: read once, removed from the relay. Whatever does not open under the key stays ignored. */
export async function pollOpened(d: RelayDeps, me: Identity, inv: CoInvite): Promise<Hello[]> {
  const mailbox = box('open', inv.id)
  const token = await relayToken(me, 'read')
  const got = await fetchBox(d, mailbox, token)
  if (got.status !== 'ok') return []
  const sets = new Map<string, { id: string; frame: Uint8Array }[]>()
  for (const i of got.items) { const set = String.fromCharCode(...i.frame.slice(0, 16)); sets.set(set, [...(sets.get(set) ?? []), i]) }
  const out: Hello[] = []
  for (const items of sets.values()) {
    const bytes = joinFrames(items.map((i) => i.frame))
    const o = (bytes ? await openSealed(bytes, inv.key) : null) as Record<string, unknown> | null
    if (!o || o.k !== 'open' || !Number.isFinite(o.at)) continue
    out.push({ at: o.at as number, ...(typeof o.name === 'string' ? { name: o.name.slice(0, 60) } : {}), ...(typeof o.did === 'string' ? { did: o.did.slice(0, 512) } : {}) })
    try { for (const i of items) await d.fetch(route(d, forQuery(mailbox, i.id)), { method: 'DELETE', headers: { 'X-Relay-Token': token } }) } catch { /* it expires on its own */ }
  }
  return out
}

/**
 * The owner takes a link back: reads the invite mailbox with a token of its own and deletes what is in it. Works while nobody opened the link (then the
 * mailbox is still unclaimed); false when somebody did (their device holds the claim and a copy), or the relay is down.
 */
export async function revokeInvite(d: RelayDeps, inv: CoInvite): Promise<boolean> {
  const mailbox = box('invite', inv.id)
  const token = await readToken(inv.key, `owner:${inv.id}`, false)
  const got = await fetchBox(d, mailbox, token)
  if (got.status !== 'ok') return false
  try {
    for (const i of got.items) await d.fetch(route(d, forQuery(mailbox, i.id)), { method: 'DELETE', headers: { 'X-Relay-Token': token } })
    return true
  } catch {
    return false
  }
}
