import { describe, expect, it } from 'vitest'
import { kvGet, kvSet } from '../src/db'
import { loadState, saveState, KEY, type DeviceState } from '../src/state'

/**
 * Demo 20's `pendingAcceptRequests` (main.ts) used to live only as a
 * module-level array, never written through `saveState`, so a reload before
 * Jakob tapped "Anfrage bestätigen" lost the request outright -- reproduced
 * live, deterministically (5/5), against the deployed build (see main.ts's
 * `pendingRequestBubble()` doc comment). This proves the fix: the field now
 * survives a round trip through the same `saveState`/`kv` layer a real page
 * reload goes through.
 *
 * Deliberately reads back via `kvGet` directly, bypassing state.ts's own
 * in-memory `cached` var (same reasoning as state_defaults.test.ts's own
 * comment on why it writes straight to the kv store) -- a passing
 * `loadState()` call alone would not distinguish "actually on disk" from
 * "still sitting in this module's memory", and only the former is what a
 * real reload (a fresh module instance) can read back.
 */
describe('pendingAcceptRequests survives a simulated reload', () => {
  it('is present in the underlying kv record after saveState, not just in memory', async () => {
    const base: DeviceState = {
      me: { id: 'jakob000', displayName: 'Jakob' },
      threads: [],
      peers: [],
      inventory: [],
      profile: { displayName: 'Jakob', bio: '', neighbourhood: '', languages: [] },
      queryLog: [],
      pendingAcceptRequests: [],
    }
    await kvSet(KEY, base)

    const s = await loadState()
    expect(s).not.toBeNull()
    expect(s!.pendingAcceptRequests).toEqual([])

    // Simulate handleRawWire's mutation: a connect-ack arrives, queuing a
    // request, and the (now-added) persistence line runs.
    const req = { did: 'did:peer:2:guest1', from: { id: 'guest001', displayName: 'Theresa' } }
    s!.pendingAcceptRequests = [req]
    await saveState(s!)

    // The point of the test: read the RAW stored record, not the module's
    // own `cached` copy, proving the write actually reached storage.
    const onDisk = await kvGet<DeviceState>(KEY)
    expect(onDisk?.pendingAcceptRequests).toEqual([req])
  })
})
