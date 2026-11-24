// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-invite-link (Jakob: "an invite link like for events - one that can be passed on and one that cannot be passed on - also in
 * advanced a setting for how many this invite link can work, phishing protection in general"). The community invite: two links, both the
 * inviter's connect link (handshake v2, k=) plus `#inv=<token>` in the fragment (never sent to a server).
 *
 *   personal  single use, bound to the recipient: the first accept writes the recipient's DID into the inviter's counter; any other DID,
 *             and any later accept, is refused ('used'). The same DID again (a resent connect-ack) stays accepted.
 *   open      can be passed on: up to `max` different recipients (Advanced, default OPEN_INVITE_MAX_USES), until the expiry.
 *
 * Token = base64url(JSON {v,k,id,t,l,n,x}) "." Ed25519 signature by the inviter's DID signing key over "tw-invite-v1|<inviter DID>|<payload>".
 * The DID is not in the token: it is the link's `connect=` DID, so a token moved onto another person's link fails. The recipient checks
 * the signature and the expiry before the accept screen (a tampered name or community never shows); the inviter's device checks it again,
 * keeps the counter (its own record, never synced: the acks reach this device's DID only) and rate-limits attempts per token.
 * The token itself rides inside the sealed connect-ack (handshake_crypto.ts), so the relay never sees it.
 *
 * No runtime imports: apps/mcp loads this under plain node and signs with node:crypto; the app signs with @noble (did.ts signBytes).
 */

/** Advanced default: how many people one open link lets in. */
export const OPEN_INVITE_MAX_USES = 10
/** Advanced default: days an invite link works (both kinds). */
export const INVITE_DAYS = 30
/** Accept attempts per token and hour; over it every further attempt is refused ('rate') until the hour has passed. */
export const INVITE_TRIES_PER_HOUR = 10
/** The inviter's counter keeps this many links (oldest first out). */
export const INVITE_LEDGER_MAX = 200
/** Bounds of the Advanced inputs. */
export const INVITE_MAX_USES_LIMIT = 1000
export const INVITE_DAYS_LIMIT = 365
/** The fragment key of an invite link. */
export const INVITE_PARAM = 'inv'

const DAY = 86_400_000
const HOUR = 3_600_000
const CONTEXT = 'tw-invite-v1'

export type InviteKind = 'personal' | 'open'
export type InviteRefusal = 'tampered' | 'expired' | 'used' | 'limit' | 'revoked' | 'unknown' | 'rate'

/** What the token says (signed). */
export interface InviteToken { v: 1; k: 'p' | 'o'; id: string; t: string; l: string; n: string; x: number; /** wave46 iyg-guest-path: the inviter organizes the community (signed with the rest) */ o?: 1 }

/** One link in the inviter's counter. */
export interface InviteEntry {
  id: string
  kind: InviteKind
  tag: string
  label: string
  at: number
  x: number
  max: number
  tok: string
  uses: { did: string; at: number }[]
  tries: number[]
  revoked?: true
}

export interface InviteSettings { max?: number; days?: number }

export type Signer = (bytes: Uint8Array) => string
export type Verifier = (bytes: Uint8Array, sig: string) => boolean

// ---- base64url (no Buffer: the browser runs this too) ----
const toB64u = (b: Uint8Array): string => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const fromB64u = (s: string): Uint8Array => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)) }
const B64U = /^[A-Za-z0-9_-]+$/
const te = new TextEncoder()

const signedBytes = (inviterDid: string, payload: string): Uint8Array => te.encode(`${CONTEXT}|${inviterDid}|${payload}`)

/** Advanced values in force (defaults, clamped). */
export function inviteSettingsOf(s: InviteSettings | undefined): { max: number; days: number } {
  const clamp = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d)
  return { max: clamp(s?.max, 1, INVITE_MAX_USES_LIMIT, OPEN_INVITE_MAX_USES), days: clamp(s?.days, 1, INVITE_DAYS_LIMIT, INVITE_DAYS) }
}

/** A new signed link entry. `id` = 16 random bytes base64url (the nonce). */
export function createInvite(o: { kind: InviteKind; tag: string; label: string; inviterDid: string; inviterName: string; id: string; now: number; settings?: InviteSettings; sign: Signer; organizer?: boolean }): InviteEntry {
  const { max, days } = inviteSettingsOf(o.settings)
  const x = o.now + days * DAY
  const tok: InviteToken = { v: 1, k: o.kind === 'personal' ? 'p' : 'o', id: o.id, t: o.tag, l: o.label.slice(0, 60), n: o.inviterName.slice(0, 40), x, ...(o.organizer ? { o: 1 as const } : {}) }
  const payload = toB64u(te.encode(JSON.stringify(tok)))
  return { id: o.id, kind: o.kind, tag: o.tag, label: tok.l, at: o.now, x, max: o.kind === 'personal' ? 1 : max, tok: `${payload}.${o.sign(signedBytes(o.inviterDid, payload))}`, uses: [], tries: [] }
}

const parseToken = (raw: unknown): InviteToken | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  if (t.v !== 1 || (t.k !== 'p' && t.k !== 'o') || typeof t.id !== 'string' || !B64U.test(t.id) || t.id.length > 32) return null
  if (typeof t.t !== 'string' || !t.t || typeof t.l !== 'string' || typeof t.n !== 'string' || typeof t.x !== 'number' || !Number.isFinite(t.x)) return null
  return { v: 1, k: t.k, id: t.id, t: t.t, l: t.l, n: t.n, x: t.x, ...(t.o === 1 ? { o: 1 as const } : {}) }
}

/** Checks a token against the inviter's DID (the link's `connect=`): signature, shape, expiry. */
export function verifyInvite(token: string, inviterDid: string, now: number, verify: Verifier): { ok: true; inv: InviteToken } | { ok: false; reason: 'tampered' | 'expired' } {
  if (typeof token !== 'string' || token.length > 1200) return { ok: false, reason: 'tampered' }
  const [payload, sig, extra] = token.split('.')
  if (extra !== undefined || !payload || !sig || !B64U.test(payload) || !B64U.test(sig)) return { ok: false, reason: 'tampered' }
  if (!verify(signedBytes(inviterDid, payload), sig)) return { ok: false, reason: 'tampered' }
  let inv: InviteToken | null
  try { inv = parseToken(JSON.parse(new TextDecoder().decode(fromB64u(payload)))) } catch { inv = null }
  if (!inv) return { ok: false, reason: 'tampered' }
  if (now > inv.x) return { ok: false, reason: 'expired' }
  return { ok: true, inv }
}

/** The invite link: the connect link with the token in the fragment. */
export const inviteLink = (connectLink: string, e: Pick<InviteEntry, 'tok'>): string => `${connectLink.split('#')[0]}#${INVITE_PARAM}=${e.tok}`

/** The token of an opened link's fragment, or null. */
export function inviteOfHash(hash: string): string | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get(INVITE_PARAM)
  return v && v.length <= 1200 ? v : null
}

const live = (e: InviteEntry, now: number): boolean => !e.revoked && now <= e.x && e.uses.length < e.max

/** The open link of `tag` still working, if there is one (the sheet shows the same open link until it is used up, expired or revoked). */
export const openInviteOf = (ledger: readonly InviteEntry[] | undefined, tag: string, now: number): InviteEntry | undefined =>
  (ledger ?? []).filter((e) => e.kind === 'open' && e.tag === tag && live(e, now)).sort((a, b) => b.at - a.at)[0]

/** The counter with one more link, bounded. */
export const addInvite = (ledger: readonly InviteEntry[] | undefined, e: InviteEntry): InviteEntry[] => [...(ledger ?? []), e].slice(-INVITE_LEDGER_MAX)

/** Advanced "max uses": applies to the open links of `tag` still working, and to the next one. */
export const setOpenMax = (ledger: readonly InviteEntry[] | undefined, tag: string, max: number): InviteEntry[] =>
  (ledger ?? []).map((e) => (e.kind === 'open' && e.tag === tag && !e.revoked ? { ...e, max: inviteSettingsOf({ max }).max } : e))

/** "Revoke all": every link of `tag` (all tags when absent) stops working; the counter keeps them (I6). */
export const revokeInvites = (ledger: readonly InviteEntry[] | undefined, tag?: string): { ledger: InviteEntry[]; revoked: number } => {
  let revoked = 0
  const out = (ledger ?? []).map((e) => {
    if (e.revoked || (tag && e.tag !== tag)) return e
    revoked++
    return { ...e, revoked: true as const }
  })
  return { ledger: out, revoked }
}

/**
 * The inviter's device: a connect-ack carried this token from `fromDid`. Verifies it against this device's own DID, then the counter:
 * the same recipient again is accepted without counting; otherwise the attempt is counted (rate limit), and revoked / expired / used up
 * is refused. An accepted use writes the recipient DID into the entry (the personal link is bound to it from then on).
 */
export function redeemInvite(ledger: readonly InviteEntry[] | undefined, token: string, o: { myDid: string; fromDid: string; now: number; verify: Verifier }):
  { ok: true; ledger: InviteEntry[]; entry: InviteEntry } | { ok: false; reason: InviteRefusal; ledger: InviteEntry[] } {
  const all = [...(ledger ?? [])]
  const v = verifyInvite(token, o.myDid, o.now, o.verify)
  if (!v.ok && v.reason === 'tampered') return { ok: false, reason: 'tampered', ledger: all }
  const id = v.ok ? v.inv.id : safeId(token)
  const at = all.findIndex((e) => e.id === id && e.tok === token)
  if (at < 0) return { ok: false, reason: 'unknown', ledger: all }
  const e = all[at]
  if (e.uses.some((u) => u.did === o.fromDid)) return { ok: true, ledger: all, entry: e }   // already let in: a resent ack, also after a revoke
  const tries = e.tries.filter((t) => o.now - t < HOUR)
  if (tries.length >= INVITE_TRIES_PER_HOUR) { all[at] = { ...e, tries }; return { ok: false, reason: 'rate', ledger: all } }
  const counted: InviteEntry = { ...e, tries: [...tries, o.now] }
  const refuse = (reason: InviteRefusal): { ok: false; reason: InviteRefusal; ledger: InviteEntry[] } => { all[at] = counted; return { ok: false, reason, ledger: all } }
  if (e.revoked) return refuse('revoked')
  if (!v.ok || o.now > e.x) return refuse('expired')
  if (e.uses.length >= e.max) return refuse(e.kind === 'personal' ? 'used' : 'limit')
  const entry: InviteEntry = { ...counted, uses: [...e.uses, { did: o.fromDid, at: o.now }] }
  all[at] = entry
  return { ok: true, ledger: all, entry }
}

/** The id inside a token whose signature held but which expired (verifyInvite does not return it then). */
function safeId(token: string): string | null {
  try { return parseToken(JSON.parse(new TextDecoder().decode(fromB64u(token.split('.')[0]))))?.id ?? null } catch { return null }
}

export type InviteState = 'active' | 'used' | 'expired' | 'revoked'
export const inviteStateOf = (e: InviteEntry, now: number): InviteState => (e.revoked ? 'revoked' : now > e.x ? 'expired' : e.uses.length >= e.max ? 'used' : 'active')

/** MCP invite_link_status and the sheet's counter line: per link its kind, community, uses of max, expiry, state. Never a DID or the token. */
export function inviteStatus(ledger: readonly InviteEntry[] | undefined, now: number, tag?: string): { id: string; kind: InviteKind; tag: string; community: string; uses: number; max: number; expiresAt: number; state: InviteState }[] {
  return (ledger ?? []).filter((e) => !tag || e.tag === tag)
    .map((e) => ({ id: e.id, kind: e.kind, tag: e.tag, community: e.label, uses: e.uses.length, max: e.max, expiresAt: e.x, state: inviteStateOf(e, now) }))
}

/** The recipient's device: invites it took (token ids); a second accept of the same link on this phone is refused before anything is sent. */
export const INVITES_TAKEN_MAX = 200
export const takeInvite = (taken: readonly string[] | undefined, id: string): string[] => [...(taken ?? []).filter((x) => x !== id), id].slice(-INVITES_TAKEN_MAX)
