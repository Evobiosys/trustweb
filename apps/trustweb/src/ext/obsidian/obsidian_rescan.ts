// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c sync-seamless (B3): the kept vault folder is rescanned by itself, on coming back to the app and every RESCAN_MS, while the browser still allows
 * reading it. It never asks: a permission that is not already granted ends the round silently (the Sync again button asks, with a tap). Pure over injected deps.
 */
export const RESCAN_MS = 5 * 60_000
/** Coming back to the app scans unless a scan ran less than this long ago (a quick tab switch is no reason to read the vault again). */
export const FOCUS_GAP_MS = 30_000

export interface RescanHandle { queryPermission?: (o: { mode: 'read' }) => Promise<'granted' | 'denied' | 'prompt'> }
export interface RescanDeps<H extends RescanHandle> {
  handle: () => H | null
  now: () => number
  /** False once the page is gone or the module is off. */
  live: () => boolean
  scan: (handle: H) => Promise<void>
}

export function createRescan<H extends RescanHandle>(d: RescanDeps<H>) {
  let last = 0
  let busy = false
  async function run(gap: number): Promise<boolean> {
    const handle = d.handle()
    if (!handle || busy || !d.live() || d.now() - last < gap) return false
    busy = true
    try {
      if ((await handle.queryPermission?.({ mode: 'read' }).catch(() => 'denied')) !== 'granted') return false
      await d.scan(handle)
      last = d.now()
      return true
    } catch { return false } finally { busy = false }
  }
  return {
    /** A scan that ran by another way (the owner's tap) counts as the last one. */
    mark: (at: number): void => { last = at },
    last: (): number => last,
    tick: (): Promise<boolean> => run(RESCAN_MS),
    focus: (): Promise<boolean> => run(FOCUS_GAP_MS),
  }
}
