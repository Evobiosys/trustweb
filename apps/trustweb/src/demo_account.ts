/**
 * Demo (test) accounts, owner 2026-10-06 (Omi walk): from the QR button, make
 * an account named "<their first name>-test" for the person in front of you.
 * They open it on their phone and can ask your web right away, as if they
 * were connected; you still say yes or no to every ask (the gate in net.ts
 * is untouched), and the account is listed on your phone and removable.
 *
 * The link is the ordinary one-scan connect link (apps/demo's connect_link.ts)
 * plus a URL FRAGMENT, which a browser never sends to the server:
 *   #t=<account name>                      the name the other phone starts with
 *   &p=<did>&pi=<id>&pn=<name>            optional: a second peer to connect to,
 *                                         the demo inventory on the Swiss server
 *                                         (services/trustweb-peer), published as
 *                                         <app>/demo-peer.json when deployed.
 * Pure and DOM-free so the unit tests import the exact functions the app calls.
 */

export const TEST_SUFFIX = '-test'
const NAME_MAX = 30
/** did:peer:2 strings are long (~200 chars); anything past this is not one of ours. */
const DID_MAX = 600
const ID_MAX = 40
const PEER_NAME_MAX = 40

const KEY_ACCOUNT = 't'
const KEY_PEER_DID = 'p'
const KEY_PEER_ID = 'pi'
const KEY_PEER_NAME = 'pn'

/** A peer the test account should also connect to (the demo inventory). */
export interface DemoPeerRef {
  did: string
  id: string
  name: string
}

export interface DemoAccountLink {
  account: string
  peer?: DemoPeerRef
}

/** "Anna" -> "Anna-test". Trims, caps the length, never doubles the suffix. */
export function testAccountName(firstName: string): string {
  const base = firstName.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
  if (!base) return ''
  return base.toLowerCase().endsWith(TEST_SUFFIX) ? base : base + TEST_SUFFIX
}

export function isTestAccountName(name: string): boolean {
  return name.toLowerCase().endsWith(TEST_SUFFIX) && name.length > TEST_SUFFIX.length
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
 * A peer is kept only when all three of its fields are well-formed.
 */
export function parseDemoFragment(hash: string): DemoAccountLink | null {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const account = q.get(KEY_ACCOUNT)
  if (!account || !isTestAccountName(account) || account.length > NAME_MAX + TEST_SUFFIX.length) return null
  const peer = { did: q.get(KEY_PEER_DID), id: q.get(KEY_PEER_ID), name: q.get(KEY_PEER_NAME) }
  return isDemoPeerRef(peer) ? { account, peer } : { account }
}
