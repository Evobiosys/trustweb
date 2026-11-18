// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c sync-seamless (B3): the vault is rescanned by itself while its handle is kept and the browser still allows reading it (stubbed handle). */
import { createRescan, FOCUS_GAP_MS, RESCAN_MS } from '../../src/ext/obsidian/obsidian_rescan.ts'

function rig(over = {}) {
  let clock = 1_000_000
  const calls = []
  const handle = { queryPermission: async () => 'granted', ...over.handle }
  const r = createRescan({
    handle: () => ('noHandle' in over ? null : handle), now: () => clock, live: () => over.live ?? true,
    scan: async (h) => { calls.push(h); if (over.fail) throw new Error('x'); await (over.hold ?? Promise.resolve()) },
  })
  return { r, calls, advance: (ms) => { clock += ms }, handle }
}

describe('obsidian rescan', () => {
  it('the five-minute tick scans only once RESCAN_MS has passed since the last scan', async () => {
    const x = rig()
    x.r.mark(1_000_000)
    x.advance(RESCAN_MS - 1)
    expect(await x.r.tick()).toBe(false)
    x.advance(2)
    expect(await x.r.tick()).toBe(true)
    expect(x.calls).toEqual([x.handle])
    expect(x.r.last()).toBe(1_000_000 + RESCAN_MS + 1)
  })

  it('coming back to the app scans at once, unless a scan just ran (FOCUS_GAP_MS)', async () => {
    const x = rig()
    x.r.mark(1_000_000)
    x.advance(FOCUS_GAP_MS - 1)
    expect(await x.r.focus()).toBe(false)
    x.advance(2)
    expect(await x.r.focus()).toBe(true)
  })

  it('no handle, a browser that no longer allows reading (denied, prompt), or a page that is gone: no scan, no prompt', async () => {
    for (const x of [rig({ noHandle: true }), rig({ handle: { queryPermission: async () => 'denied' } }), rig({ handle: { queryPermission: async () => 'prompt' } }), rig({ live: false }), rig({ handle: { queryPermission: undefined } })]) {
      x.advance(RESCAN_MS * 2)
      expect(await x.r.tick()).toBe(false)
      expect(x.calls).toHaveLength(0)
    }
  })

  it('one scan at a time; a failing scan leaves the last time alone so the next trigger tries again', async () => {
    let release
    const x = rig({ hold: new Promise((res) => { release = res }) })
    x.advance(RESCAN_MS * 2)
    const first = x.r.tick()
    expect(await x.r.focus()).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(x.calls).toHaveLength(1)
    const bad = rig({ fail: true })
    bad.advance(RESCAN_MS * 2)
    expect(await bad.r.tick()).toBe(false)
    expect(bad.r.last()).toBe(0)
  })
})
