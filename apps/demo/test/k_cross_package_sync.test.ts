import { describe, expect, it } from 'vitest'
import { DEFAULT_K } from '@resource-web/network-access/anonymity'
import { INVENTORY_DEFAULT_K } from '@resource-web/inventory-store'

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
