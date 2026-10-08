/**
 * Wave 6h (Q1/Q2): a laptop that sleeps while the TrustWeb tab sits behind another window. The relay socket it held is dead when it
 * wakes, but nothing tells the page: the tab never becomes visible (the person works in another window), so the wave-6f "fresh socket
 * after more than 60 s hidden" never runs, and asks wait on the relay until the person looks at the tab, by then long past their moment.
 *
 * This watch notices the sleep itself: a timer that ticks every TICK_MS sees the clock jump by more than SLEPT_MS between two ticks
 * (a page cannot run while the machine sleeps). Background tabs may be throttled to about one tick a minute, so SLEPT_MS is well above
 * that. The caller then reopens the drain (net.ts refresh). The browser's 'online' event and a page restored from the back-forward
 * cache call the same hook (main.ts).
 * DOM-free: the timer functions and the clock are injected.
 */

/** How often the watch looks at the clock. */
export const TICK_MS = 20_000
/** A gap between two ticks longer than this means the machine slept (throttled background timers tick at about one a minute). */
export const SLEPT_MS = 150_000

export interface WakeWatchDeps {
  now(): number
  every(fn: () => void, ms: number): unknown
  stop(handle: unknown): void
}

/** Calls `onWake` after every sleep it notices. Returns a stop function. */
export function watchWake(onWake: () => void, deps: WakeWatchDeps): () => void {
  let last = deps.now()
  const handle = deps.every(() => {
    const now = deps.now()
    const gap = now - last
    last = now
    if (gap > SLEPT_MS) onWake()
  }, TICK_MS)
  return () => deps.stop(handle)
}
