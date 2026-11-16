// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * review-fixes-43c: what a relay operator can read in a stored wire. The raw text plus every base64 / base64url token (16+ chars)
 * decoded as UTF-8: a JSON field that only base64-wraps a name is still plaintext to the relay.
 */
const TOKEN = /[A-Za-z0-9+/_-]{16,}={0,2}/g

/** The raw wire and the UTF-8 decoding of each base64(url) token in it. */
export function readable(wire) {
  const out = [wire]
  for (const tok of wire.match(TOKEN) ?? []) {
    try { out.push(Buffer.from(tok.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) } catch { /* not base64 */ }
  }
  return out
}

/** Which of `names` a relay operator can read in `wire`. */
export function plainHits(wire, names) {
  const texts = readable(wire)
  return names.filter((n) => texts.some((t) => t.includes(n)))
}

/** 'connect-ack' for the cleartext bootstrap wire (connect_link.ts), else 'other'. */
export function wireKind(wire) {
  return readable(wire).some((t) => /\\?"t\\?":\\?"connect-ack\\?"/.test(t)) ? 'connect-ack' : 'other'
}
