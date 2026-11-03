// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * relay_send_auth.ts -- the demo's signer for `POST /relay/send` (sender
 * auth v2, SPEC F9).
 *
 * A port of packages/transport/src/relay_send_auth.ts's `signSend`, NOT an
 * import -- same reason did.ts reimplements did_identity.ts: the transport
 * module uses Node's `Buffer`, and this app is its own browser bundle. The
 * signed bytes MUST stay byte-identical to transport's `sendSigningInputV2`;
 * test/relay_send_auth.test.ts compares them directly.
 *
 * Signed bytes (UTF-8, "\n"-joined, exactly 7 lines):
 *   trustweb-relay-send/v2 \n did \n kid-or-empty \n aud \n ts \n nonce \n hex(sha256(wire bytes))
 *
 * `aud` is the ORIGIN of the ingress URL the demo posts to, so a captured
 * send cannot be replayed against a different relay. The demo has no device
 * keys, so `kid` is always the empty line and the DID's own Ed25519 key signs.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Identity } from './did'
import { randomBytes, toB64u } from './crypto'

export const SEND_AUTH_HEADERS = {
  did: 'x-tw-relay-did',
  kid: 'x-tw-relay-kid',
  aud: 'x-tw-relay-aud',
  ts: 'x-tw-relay-ts',
  nonce: 'x-tw-relay-nonce',
  sig: 'x-tw-relay-sig',
} as const

export const SEND_AUTH_PREFIX = 'trustweb-relay-send/v2'

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The exact bytes signed for one send; `wire` is the request body as sent. */
export function sendSigningInputV2(p: { did: string; kid?: string; aud: string; ts: string; nonce: string; wire: string }): Uint8Array {
  const digest = hex(sha256(new TextEncoder().encode(p.wire)))
  return new TextEncoder().encode([SEND_AUTH_PREFIX, p.did, p.kid ?? '', p.aud, p.ts, p.nonce, digest].join('\n'))
}

/** Headers to attach to `POST /relay/send` for `wire`, signed for audience `aud` with a fresh nonce. */
export function signSend(
  identity: Pick<Identity, 'did' | 'signing'>,
  wire: string,
  opts: { aud: string; now?: number; nonce?: string },
): Record<string, string> {
  const ts = String(opts.now ?? Date.now())
  const nonce = opts.nonce ?? toB64u(randomBytes(16))
  const sig = ed25519.sign(sendSigningInputV2({ did: identity.did, aud: opts.aud, ts, nonce, wire }), identity.signing.secretKey)
  return {
    [SEND_AUTH_HEADERS.did]: identity.did,
    [SEND_AUTH_HEADERS.aud]: opts.aud,
    [SEND_AUTH_HEADERS.ts]: ts,
    [SEND_AUTH_HEADERS.nonce]: nonce,
    [SEND_AUTH_HEADERS.sig]: toB64u(sig),
  }
}

/**
 * The ms to add to the local clock after the relay refused a send as `stale`
 * and told its own time in a `Date` header (F4); undefined for anything else.
 */
export function staleClockOffset(res: Response, body: { reason?: string }, localNow: number): number | undefined {
  if (res.status !== 401 || typeof body.reason !== 'string' || !body.reason.includes('stale')) return undefined
  const date = res.headers.get('date')
  if (date === null) return undefined
  const serverNow = Date.parse(date)
  return Number.isFinite(serverNow) ? serverNow - localNow : undefined
}
