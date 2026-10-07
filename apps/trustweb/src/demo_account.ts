/**
 * Demo accounts, owner 2026-10-06 (Omi walk, then his 09:29 spec): from the QR
 * button, make a dummy connection to an account you name. The name field is
 * prefilled "-demo" with the caret in front of it, so typing gives
 * "<name>-demo"; the suffix can be erased. The account is a separate identity
 * that can call into your web like a connected person, it is taken down after a
 * week by default (end it early, extend it), and its connection is active
 * only once you allowed it in your own view, so nobody can exploit the link.
 * Consent per ask stays (the gate in net.ts is untouched).
 *
 * Two ways to run it: on THEIR phone (they scan the code) or ON THIS PHONE
 * (a second tab under its own persona, for a demo in your hand), from where
 * it can later be HANDED OVER to their phone with what it found and the
 * permissions you set (an encrypted pack on the backup server, opened with a
 * key that travels only in the hand-over link's fragment).
 *
 * The link is the ordinary one-scan connect link (apps/demo's connect_link.ts)
 * plus a URL FRAGMENT, which a browser never sends to the server:
 *   #t=<account name>&a=<account id>&x=<expiresAt ms>
 *   &p=<did>&pi=<id>&pn=<name>   optional: the demo inventory on the Swiss
 *                                server (services/trustweb-peer), published as
 *                                <app>/demo-peer.json once deployed
 *   &own=1                       opened on the owner's own phone
 * Hand-over link: <app>?handover=1#k=<recovery key>&a=<account id>&t=<name>
 * Pure and DOM-free so the unit tests import the exact functions the app calls.
 */

export const DEMO_SUFFIX = '-demo'
/** Older accounts (made before 09:29 today) carry this suffix; they keep working. */
export const LEGACY_SUFFIX = '-test'
export const DEMO_LIFETIME_MS = 7 * 86_400_000
const NAME_MAX = 40
/** did:peer:2 strings are long (~200 chars); anything past this is not one of ours. */
const DID_MAX = 600
const ID_MAX = 40
const PEER_NAME_MAX = 40
const ACCOUNT_ID_RE = /^[a-zA-Z0-9]{4,16}$/
const PERSONA_PREFIX = 'demo-'

const KEY_ACCOUNT = 't'
const KEY_ACCOUNT_ID = 'a'
const KEY_EXPIRES = 'x'
const KEY_OWN = 'own'
const KEY_PEER_DID = 'p'
const KEY_PEER_ID = 'pi'
const KEY_PEER_NAME = 'pn'
const KEY_HANDOVER_KEY = 'k'

/** A peer the demo account should also connect to (the demo inventory). */
export interface DemoPeerRef {
  did: string
  id: string
  name: string
}

export interface DemoAccountLink {
  account: string
  /** The account's id on the owner's phone; absent on links made before it existed. */
  accountId?: string
  /** When the owner's phone takes the account down; absent on older links. */
  expiresAt?: number
  /** Opened on the owner's own phone (a second tab), not on somebody else's. */
  own?: boolean
  peer?: DemoPeerRef
}

export interface HandoverLink {
  keyText: string
  accountId: string
  account: string
}

/** Trims, collapses spaces, caps the length. "-demo" alone (nothing but a suffix, or no letter or digit) is nothing. */
export function demoAccountName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
  const core = name.replace(new RegExp(`(${DEMO_SUFFIX}|${LEGACY_SUFFIX})$`, 'i'), '')
  return /[\p{L}\p{N}]/u.test(core) ? name : ''
}

/** The persona a demo account runs under on the owner's own phone: its own storage record and relay identity. */
export function demoPersona(accountId: string): string {
  return PERSONA_PREFIX + accountId.toLowerCase()
}

export function isDemoPersona(v: string | null): v is string {
  return v !== null && v.startsWith(PERSONA_PREFIX) && ACCOUNT_ID_RE.test(v.slice(PERSONA_PREFIX.length)) && v === v.toLowerCase()
}

/** "7 days", "3 hours", "12 minutes", "ended": each unit rounded up, so a fresh week reads as 7 days. */
export function timeLeft(expiresAt: number, now: number): { ended: boolean; days: number; hours: number; minutes: number } {
  const ms = expiresAt - now
  if (ms <= 0) return { ended: true, days: 0, hours: 0, minutes: 0 }
  const days = ms >= 86_400_000 ? Math.ceil(ms / 86_400_000 - 1e-6) : 0
  const hours = ms >= 3_600_000 ? Math.ceil(ms / 3_600_000 - 1e-6) : 0
  return { ended: false, days, hours, minutes: Math.max(1, Math.ceil(ms / 60_000)) }
}

function nonEmpty(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max
}

/** Shape check for demo-peer.json (untrusted: a static file next to the app). */
export function isDemoPeerRef(v: unknown): v is DemoPeerRef {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return nonEmpty(o.did, DID_MAX) && o.did.startsWith('did:peer:') && nonEmpty(o.id, ID_MAX) && nonEmpty(o.name, PEER_NAME_MAX)
}

/** The fragment (without "#") that turns a connect link into a demo-account link. */
export function demoFragment(link: DemoAccountLink): string {
  const q = new URLSearchParams()
  q.set(KEY_ACCOUNT, link.account)
  if (link.accountId) q.set(KEY_ACCOUNT_ID, link.accountId)
  if (link.expiresAt) q.set(KEY_EXPIRES, String(link.expiresAt))
  if (link.own) q.set(KEY_OWN, '1')
  if (link.peer) {
    q.set(KEY_PEER_DID, link.peer.did)
    q.set(KEY_PEER_ID, link.peer.id)
    q.set(KEY_PEER_NAME, link.peer.name)
  }
  return q.toString()
}

/**
 * Reads a demo-account link's fragment ("#..." or bare). Null when it is not
 * one (every ordinary visit, and a connect link with notes only: "#n=").
 * Optional parts are kept only when well-formed.
 */
export function parseDemoFragment(hash: string): DemoAccountLink | null {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const account = demoAccountName(q.get(KEY_ACCOUNT) ?? '')
  if (!account) return null
  const out: DemoAccountLink = { account }
  const id = q.get(KEY_ACCOUNT_ID)
  if (id && ACCOUNT_ID_RE.test(id)) out.accountId = id
  const x = Number(q.get(KEY_EXPIRES))
  if (Number.isFinite(x) && x > 0) out.expiresAt = x
  if (q.get(KEY_OWN) === '1') out.own = true
  const peer = { did: q.get(KEY_PEER_DID), id: q.get(KEY_PEER_ID), name: q.get(KEY_PEER_NAME) }
  if (isDemoPeerRef(peer)) out.peer = peer
  return out
}

/** The hand-over link's fragment: the pack's key, never sent to a server. */
export function handoverFragment(link: HandoverLink): string {
  const q = new URLSearchParams()
  q.set(KEY_HANDOVER_KEY, link.keyText)
  q.set(KEY_ACCOUNT_ID, link.accountId)
  q.set(KEY_ACCOUNT, link.account)
  return q.toString()
}

export function parseHandoverFragment(hash: string): HandoverLink | null {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const keyText = q.get(KEY_HANDOVER_KEY) ?? ''
  const accountId = q.get(KEY_ACCOUNT_ID) ?? ''
  const account = demoAccountName(q.get(KEY_ACCOUNT) ?? '')
  if (!/^TW1[A-Z0-9-]{20,80}$/i.test(keyText) || !ACCOUNT_ID_RE.test(accountId) || !account) return null
  return { keyText, accountId, account }
}
