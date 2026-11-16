// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c social-hosting: the one new wire envelope `host` (apps/demo wire.ts). Strict at the untrusted-input boundary; the body is checked again by SocialHost. */
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'

const env = (m, over = {}) => ({ v: 1, t: 'host', m, ...over })

describe('host envelope', () => {
  it('round-trips a message with its k', () => {
    for (const m of [{ k: 'get', q: 'q1', name: 'ada lovelace' }, { k: 'drop' }, { k: 'rec', q: 'q', recs: [] }, { k: 'put', rec: { a: 1 } }, { k: 'intent', intent: { to: 'x' } }]) {
      expect(decodeFromQr(encodeForQr(env(m)))).toEqual(env(m))
    }
  })
  it('rejects a wrong version, a missing or odd body, a body without k, an unknown k and anything over 8 KB', () => {
    for (const bad of [env({ k: 'get' }, { v: 2 }), { v: 1, t: 'host' }, env(null), env('x'), env([]), env({}), env({ k: 5 }), env({ k: 'launch' }), env({ k: 'put', rec: 'x'.repeat(9000) })]) {
      expect(decodeFromQr(JSON.stringify(bad))).toBeNull()
    }
  })
  it('keeps nothing but v, t and m (extra top-level fields are not read)', () => {
    expect(decodeFromQr(JSON.stringify(env({ k: 'drop' }, { evil: 1 })))).toEqual(env({ k: 'drop' }))
  })
})
