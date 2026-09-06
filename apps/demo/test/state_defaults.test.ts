import { describe, expect, it } from 'vitest'
import { kvSet } from '../src/db'
import { loadState, threadsInScope, KEY } from '../src/state'

/**
 * A state saved by a build of the demo before Profile/InventoryItem existed
 * has neither field on disk. Every reader added in this change (screenHome's
 * `s.inventory.length`, threadsInScope's `s.inventory.map`, screenProfile's
 * `s.profile.*`) assumes both are present. Without normalization, opening
 * the app on a phone that already ran an earlier build throws mid-render --
 * or, worse, mid-consent-ceremony inside runConsentCeremony -- rather than
 * during boot where bootFailed() could at least say why.
 *
 * This writes a legacy-shaped record straight to the kv store (bypassing
 * state.ts's own in-memory `cached` var, which would otherwise just hand
 * back whatever object a same-process saveState() had cached, never
 * exercising loadState()'s normalization at all) and proves loadState()
 * fills in both fields before anything else touches the result.
 */
describe('loadState() normalizes a pre-Profile/Inventory record', () => {
  // A single test on purpose: loadState() memoizes its result in a
  // module-level `cached` var (see state.ts), so a second loadState() call
  // anywhere in this file would just hand back the first call's already-
  // normalized object without re-reading or re-normalizing anything --
  // silently making a second `it()` here pass without testing what it
  // claims to.
  it('fills in an empty inventory and an empty profile, and survives threadsInScope()', async () => {
    const legacy = { me: { id: 'x0000000', displayName: 'Alte Version' }, threads: [], peers: [] }
    await kvSet(KEY, legacy)

    const s = await loadState()
    expect(s).not.toBeNull()
    expect(s!.inventory).toEqual([])
    expect(s!.profile).toEqual({ displayName: 'Alte Version', bio: '', neighbourhood: '', languages: [] })
    expect(s!.queryLog).toEqual([])
    expect(s!.pendingAcceptRequests).toEqual([])
    expect(() => threadsInScope(s!)).not.toThrow()
    expect(threadsInScope(s!)).toEqual([])
    // k-standardize pass (2026-09-06): "Test mode: single-holder matches
    // allowed" defaults to false/OFF for a device that never saved it.
    expect(s!.testModeSingleHolderMatches).toBe(false)
  })
})
