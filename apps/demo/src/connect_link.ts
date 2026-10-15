/**
 * The one-scan connect link (relay mode only, demo 2 at minimum).
 *
 * WHY THIS FILE EXISTS.
 *
 * The demo's original connect ceremony (main.ts's showMyConnectCode /
 * scanConnectCode) is two scans: each device shows a QR encoding JSON
 * (wire.ts's ConnectEnvelope), and each camera reads the other's. On a
 * phone whose OS has no separate QR-scanner app (GrapheneOS, the owner's
 * phone), the built-in camera can only OFFER TO OPEN A LINK -- pointed at a
 * QR full of JSON, it has nothing to do. So the laptop's QR must encode a
 * URL, and because the owner explicitly ruled out a second scan in the
 * other direction, the phone has to tell the laptop who it is over the
 * network instead of via a second code the laptop scans.
 *
 * Format follows `apps/mobile-ui/src/screens/connect_url.js`'s
 * `buildConnectUrl` -- read that file's header before changing this one --
 * which already solved "a fresh device's native camera app must be able to
 * open this": `<origin>?connect=<did>&…`. Two differences from that
 * function, both because this app's shape differs from mobile-ui's:
 *
 *  - No `relay=` param. mobile-ui's app can be deployed at an origin
 *    different from the mediator it should talk to, so `buildConnectUrl`
 *    carries the mediator's origin explicitly. This app's relay ingress is
 *    origin-locked by CORS to begin with (relay.ts's module header) -- the
 *    page can only ever POST to the relay it is itself served from -- so a
 *    phone that opened this link is already on the right origin and
 *    `resolveRelayOrigin()` (relay.ts) finds it via `location.origin` with
 *    no help needed.
 *  - No `app=` param. mobile-ui hosts more than one app id at a shared
 *    origin/path; each build of this demo is its own static deployment
 *    (`WOT_BASE`, mode.ts), so there is only ever one app at this URL.
 *  - A `name=` param mobile-ui's onboarding-only flow does not need (a
 *    brand-new mobile-ui device has no persona to greet by name yet). This
 *    demo's two seeded personas DO have names, and "verbunden mit Marlene"
 *    is worse than useless if it cannot say who.
 *
 * THE SECURITY HONESTY PART (read this before touching pairKey derivation
 * anywhere near this ceremony).
 *
 * The two-scan ceremony's key (crypto.ts's `derivePairKey`) is HKDF over
 * two plaintext nonces, one shown on each screen. That is safe ONLY because
 * both nonces travel exclusively between two cameras in the same room --
 * see crypto.ts's own SECURITY NOTE. A one-scan ceremony breaks that
 * assumption by construction: the laptop's half must reach the phone
 * somehow (this URL/QR), and the phone's half must reach the laptop
 * somehow, and since there is no second scan, that second half has to
 * travel over the network -- through the relay. A nonce the relay carries
 * is a nonce the relay has seen, and `derivePairKey(nonceA, nonceB)` from
 * two relay-visible nonces is a key the relay could compute too. Shipping
 * that and still calling the result "the relay cannot read your traffic"
 * would be a lie (I7, and the handover for this feature is explicit: do
 * not quietly keep the old claim).
 *
 * CHOSEN FIX: real X25519 key agreement (did.ts's `ecdhSharedSecret`,
 * crypto.ts's `deriveEcdhPairKey`), not "derive the key so only the
 * QR-borne half is secret" (the handover's other offered option). Reasons:
 *
 *  1. A did:peer:2's key-agreement element is a PUBLIC key. Putting it in
 *     the URL, or having the phone send it back over the relay in the
 *     clear, costs nothing a passive relay operator does not already have
 *     -- it already sees both parties' DIDs, in cleartext, on every wire,
 *     to route them (relay.ts's module header: "the relay learns who is
 *     talking to whom"). ECDH's whole point is that this is fine: knowing
 *     both public keys does not let anyone compute X25519(myPriv,
 *     theirPub) without one of the PRIVATE keys, and neither private key
 *     ever leaves its device.
 *  2. It is strictly stronger than "only the QR-borne half is secret" would
 *     have been -- that scheme still needs the QR-borne half to STAY
 *     secret from an eavesdropper who can see the URL (a shoulder-surfing
 *     phone camera, a screen recording), which is a much easier attack
 *     than "steal a private key off a device". ECDH does not depend on the
 *     URL being unobserved by third parties at all; the DID inside it is
 *     already meant to be a public, shareable identifier.
 *  3. did.ts already carries an X25519 keypair on every identity for
 *     exactly this shape-compatibility reason -- no new dependency, no new
 *     key material to manage.
 *
 * WHAT THIS STILL DOES NOT PROVE (say this honestly in the UI, not just
 * here): this is unauthenticated ECDH. If someone tampers with the QR
 * itself before the phone scans it -- swaps in their own DID -- the phone
 * pairs with the attacker instead, same as any unauthenticated
 * Diffie-Hellman exchange (and same as the two-scan ceremony's own
 * "anyone who saw both codes" caveat, just for a different step). What IS
 * newly true, and worth saying plainly: the relay itself, given ONLY what
 * it sees on the wire (both DIDs, cleartext, as it always does), cannot
 * compute the pair key. That is a strictly HONEST upgrade over the
 * two-scan relay ceremony's own disclosure (i18n.ts's `relayExplain`),
 * which still has to say "anyone who saw both codes could compute the same
 * key" because THAT ceremony still uses `derivePairKey`.
 *
 * THE WIRE ENVELOPE THIS CEREMONY ADDS: wire.ts's `ConnectAckEnvelope`
 * (`t: 'connect-ack'`), sent by the phone to the laptop's DID once the
 * phone has minted its own identity and connected to the relay. It carries
 * no secret (just the phone's own `did` and display name), so it travels
 * UNENCRYPTED via relay.ts's `sendRaw` -- the laptop cannot yet derive any
 * shared key to decrypt anything WITH, since it does not know the phone's
 * public key until this exact message arrives. Once it arrives, the
 * laptop's `pairKey()` (main.ts) switches that peer's derivation to ECDH
 * for everything that follows (queries, answers, the live-link chat/ping) --
 * see state.ts's `Peer.pairing`.
 */
import type { Identity as DidIdentity } from './did'
import type { ConnectAckEnvelope, Identity } from './types'

/** Query param names, kept short (every character here counts toward the
 *  QR's byte size -- see the result report's measured versions) but
 *  matching mobile-ui's `connect` name exactly, per this module's header:
 *  follow that file's convention rather than inventing a second one. */
const PARAM_CONNECT = 'connect'
const PARAM_ID = 'id'
const PARAM_NAME = 'name'

/**
 * Build the one-scan connect URL a phone's native camera app can open:
 * `<origin+path>?connect=<did>&id=<personaId>&name=<displayName>`.
 *
 * `origin` must already include this app's own path (mode.ts's `WOT_BASE`)
 * -- callers pass `location.origin + location.pathname`, mirroring
 * meet.js's `appBaseUrl` construction exactly (see that file's comment on
 * why a bare `location.origin` would silently drop a path prefix).
 *
 * `from` carries BOTH `id` and `displayName` -- not just the display name
 * -- because `id` is load-bearing, not decorative: every envelope this
 * device later sends (QueryEnvelope, AnswerEnvelope's peer lookup,
 * ChatEnvelope, PingEnvelope) carries `from.id`, and main.ts's incoming-query
 * handling looks up the sender by `s.peers.find(p => p.id === q.from.id)`
 * (see that function's doc comment). If the scanning device's Peer record
 * for "the device that showed this QR" does not have exactly this `id`,
 * every later query from this device is silently treated as coming from an
 * unknown peer -- `blocked: true`, `emitAnswer`'s documented fallback for
 * "we cannot derive a key" -- which looks identical to an actual decline
 * (I3) and would be a very confusing way to fail.
 */
export function buildConnectLinkUrl(origin: string, did: string, from: Identity): string {
  const url = new URL(origin)
  url.search = ''
  url.hash = ''
  url.searchParams.set(PARAM_CONNECT, did)
  url.searchParams.set(PARAM_ID, from.id)
  url.searchParams.set(PARAM_NAME, from.displayName)
  return url.toString()
}

export interface ConnectLinkParams {
  did: string
  from: Identity
}

/**
 * Parse `location.search` (or any query string) back into the connect
 * link's params. Returns `null` when `connect` or `id` is absent -- the
 * ordinary case for every visit that is not a one-scan pairing, and a
 * malformed link otherwise -- or when either looks structurally impossible
 * (empty). Does NOT validate the did:peer:2 shape itself; `did.ts`'s
 * `resolveDidPeer` is the actual untrusted-input boundary for that (called
 * downstream, when the ECDH shared secret is computed), and duplicating its
 * validation here would just be a second place for the two checks to drift
 * apart.
 */
export function parseConnectLinkParams(search: string): ConnectLinkParams | null {
  const params = new URLSearchParams(search)
  const did = params.get(PARAM_CONNECT)
  const id = params.get(PARAM_ID)
  if (!did || !id) return null
  const displayName = params.get(PARAM_NAME) ?? ''
  return { did, from: { id, displayName } }
}

/**
 * The phone's side of the ceremony's payload: a `ConnectAckEnvelope`
 * (wire.ts/types.ts). `from` is this device's ordinary persona identity
 * (state.me -- the same Identity every other envelope type already
 * carries); `didIdentity` is its did:peer:2 relay identity
 * (relay_identity.ts's `ensureRelayIdentity`). Kept as a tiny pure function
 * -- separate from the actual `relayChannel.sendRaw` call, which needs live
 * network state main.ts owns -- so it stays testable without a relay.
 */
export function buildConnectAck(from: Identity, didIdentity: DidIdentity, reachOut = false): ConnectAckEnvelope {
  return { v: 1, t: 'connect-ack', from, did: didIdentity.did, ...(reachOut ? { reachOut: true as const } : {}) }
}
