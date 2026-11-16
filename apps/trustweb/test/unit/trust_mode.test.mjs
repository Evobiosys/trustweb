// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c social-hosting: the trust predicate (rings + per-person overrides) and the trusted-only gates. */
import { TRUST_RINGS, isTrusted, serversAllowed, setTrustOverride, trustLabel, trustedOnly, setTrustedOnly } from '../../src/trust_mode.ts'

const P = (id, ring, trust) => ({ id, ring, ...(trust ? { trust } : {}) })

describe('isTrusted', () => {
  it('Closest and Close are trusted by default, every other ring is not', () => {
    expect(TRUST_RINGS).toEqual(['closest', 'close'])
    for (const r of ['closest', 'close']) expect(isTrusted(P('a', r))).toBe(true)
    for (const r of ['family', 'friend', 'acquaintance', 'intending', 'none', 'unsorted']) expect(isTrusted(P('a', r))).toBe(false)
  })
  it('an override wins over the ring in both directions', () => {
    expect(isTrusted(P('a', 'acquaintance', 'yes'))).toBe(true)
    expect(isTrusted(P('a', 'closest', 'no'))).toBe(false)
    expect(isTrusted(P('a', 'close', 'no'))).toBe(false)
  })
  it('a missing person is not trusted', () => {
    expect(isTrusted(undefined)).toBe(false)
  })
})

describe('setTrustOverride', () => {
  it('sets, replaces and clears (default removes the key)', () => {
    const p = P('a', 'friend')
    setTrustOverride(p, 'trusted'); expect(p.trust).toBe('yes')
    setTrustOverride(p, 'not'); expect(p.trust).toBe('no')
    setTrustOverride(p, 'default'); expect('trust' in p).toBe(false)
  })
  it('rejects anything else', () => {
    expect(() => setTrustOverride(P('a', 'friend'), 'maybe')).toThrow(/trusted, not or default/)
  })
  it('trustLabel names the effective answer and why', () => {
    expect(trustLabel(P('a', 'close'))).toEqual({ trusted: true, why: 'ring' })
    expect(trustLabel(P('a', 'friend'))).toEqual({ trusted: false, why: 'ring' })
    expect(trustLabel(P('a', 'friend', 'yes'))).toEqual({ trusted: true, why: 'override' })
    expect(trustLabel(P('a', 'closest', 'no'))).toEqual({ trusted: false, why: 'override' })
  })
})

describe('trusted-only mode', () => {
  it('is off by default and stored only when on', () => {
    const r = {}
    expect(trustedOnly(r)).toBe(false)
    setTrustedOnly(r, true); expect(r.trustedOnly).toBe(true); expect(trustedOnly(r)).toBe(true)
    setTrustedOnly(r, false); expect('trustedOnly' in r).toBe(false)
  })
  it('serversAllowed is the one gate: false while trusted-only is on', () => {
    expect(serversAllowed({})).toBe(true)
    expect(serversAllowed({ trustedOnly: true })).toBe(false)
  })
})
