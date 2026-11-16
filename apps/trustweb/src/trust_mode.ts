// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c social-hosting (Jakob ε): who counts as trusted, and the trusted-only switch ("Only through people I trust (no servers)").
 * Trust = the Closest and Close rings, unless a per-person override says otherwise (Person.trust 'yes' | 'no'; absent = by ring).
 * Pure, no DOM, no runtime imports of model.ts (apps/mcp runs this file under plain node): rings are compared as their string values.
 */
export const TRUST_RINGS: readonly string[] = ['closest', 'close']

export type TrustOverride = 'yes' | 'no'
interface Trustable { ring: string; trust?: TrustOverride }

/** The one predicate: the override when set, else whether the ring is Closest or Close. A missing person is not trusted. */
export function isTrusted(p: Trustable | undefined): boolean {
  if (!p) return false
  if (p.trust === 'yes') return true
  if (p.trust === 'no') return false
  return TRUST_RINGS.includes(p.ring)
}

/** The effective answer and where it comes from, for the person page ("Trusted (Close ring)"). */
export function trustLabel(p: Trustable): { trusted: boolean; why: 'ring' | 'override' } {
  return { trusted: isTrusted(p), why: p.trust === 'yes' || p.trust === 'no' ? 'override' : 'ring' }
}

/** 'trusted' / 'not' set the override, 'default' removes it (the ring decides again). */
export function setTrustOverride(p: { trust?: TrustOverride }, v: string): void {
  if (v === 'trusted') p.trust = 'yes'
  else if (v === 'not') p.trust = 'no'
  else if (v === 'default') delete p.trust
  else throw new Error('trust needs trusted, not or default')
}

export const trustedOnly = (r: { trustedOnly?: boolean }): boolean => r.trustedOnly === true

/** Only the "on" form is stored (a default is not written down). */
export function setTrustedOnly(r: { trustedOnly?: boolean }, on: boolean): void {
  if (on) r.trustedOnly = true
  else delete r.trustedOnly
}

/** The single gate every server call passes: directory publish, search, intents, hand-off and relay fallbacks. False while trusted-only is on. */
export const serversAllowed = (r: { trustedOnly?: boolean }): boolean => !trustedOnly(r)
