import { describe, expect, it } from 'vitest'
import { DEFAULT_K } from '@resource-web/network-access/anonymity'
import { INVENTORY_DEFAULT_K } from '@resource-web/inventory-store'
import { CENTRAL_K_FLOOR } from '@resource-web/wot-policy'

/**
 * k-standardize pass (2026-09-06), docs/k-parameters.md's k1 section.
 *
 * packages/inventory-store deliberately keeps its own zero-dependency copy
 * of the k-anonymity floor (`INVENTORY_DEFAULT_K`) rather than importing
 * packages/network-access's canonical `DEFAULT_K` -- inventory-store
 * declares zero dependencies in its own package.json (decision B-22's
 * AGPL/third-party-dependency audit relied on that fact), and network-access
 * is licensed AGPL-3.0-or-later, so wiring one to import the other is a
 * dependency/license call for the project owner, not made silently.
 *
 * That non-import is only safe while the two values agree. Neither package
 * may depend on the other to check this itself (that dependency is exactly
 * what is being avoided), so apps/demo -- which already depends on both --
 * is the one place able to import both constants and assert they still
 * match. If this test ever fails, someone changed one constant without the
 * other: fix the value, don't delete this test.
 */
describe('inventory-store INVENTORY_DEFAULT_K stays in sync with network-access DEFAULT_K', () => {
  it('the two independently-declared k-anonymity floors are equal', () => {
    expect(INVENTORY_DEFAULT_K).toBe(DEFAULT_K)
  })
})

/**
 * k-standardize follow-up (2026-09-08), docs/k-parameters.md's k4 section.
 *
 * Unlike INVENTORY_DEFAULT_K above, `@resource-web/wot-policy`'s
 * `CENTRAL_K_FLOOR` is NOT expected to equal `DEFAULT_K`. It is a separate,
 * deliberately stricter floor for the central-index (hosted, opt-in) layer
 * -- packages/wot-policy has zero imports from apps/demo or
 * packages/network-access by design (see that package's own header
 * comment), so this gap between 7 and 3 is a real, known, and currently
 * unresolved product question (❗ for Jakob: keep CENTRAL_K_FLOOR at 7, or
 * align it down to DEFAULT_K), not drift to be silently reconciled.
 *
 * This test does not assert the two are equal -- the opposite: it pins the
 * CURRENT relationship (7 and 3, unequal) so that if either constant's
 * value ever changes, this test fails loudly instead of the difference
 * quietly becoming stale or being "fixed" by someone who does not know it
 * is deliberate. apps/demo is again the one place able to import both
 * @resource-web/network-access and @resource-web/wot-policy to check this.
 */
describe('wot-policy CENTRAL_K_FLOOR and network-access DEFAULT_K: the current, known, tracked difference', () => {
  it('CENTRAL_K_FLOOR is 7 and DEFAULT_K is 3 -- the gap is known and tracked, not drift', () => {
    expect(
      CENTRAL_K_FLOOR,
      'CENTRAL_K_FLOOR changed -- docs/k-parameters.md k4 and the ❗ open question for Jakob need updating too, not just this test',
    ).toBe(7)
    expect(
      DEFAULT_K,
      'DEFAULT_K changed -- docs/k-parameters.md k1 and this file\'s CENTRAL_K_FLOOR-vs-DEFAULT_K gap need re-checking too, not just this test',
    ).toBe(3)
    expect(
      CENTRAL_K_FLOOR,
      'CENTRAL_K_FLOOR and DEFAULT_K have converged -- docs/k-parameters.md k4 said this was open (❗ for Jakob); if this was an intentional resolution, update the doc and this test together, do not just let it pass silently',
    ).not.toBe(DEFAULT_K)
  })
})
