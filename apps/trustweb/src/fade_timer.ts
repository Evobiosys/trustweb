// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 toast-fade: the life of a toast or notice bar. shown -> fading (after `ms`) -> gone (after `fadeMs`). A hover or touch-hold
 * (`pause`) keeps it shown and restarts the full wait on `resume`; `close` ends it at once. fadeMs 0 (reduced motion) skips fading.
 * Pure: no DOM, the caller maps the callbacks to classes.
 */
export type FadeState = 'shown' | 'fading' | 'gone'

export interface FadeTimer {
  start(): void
  pause(): void
  resume(): void
  close(): void
  /** Drops the timer without a callback (the bar is being replaced). */
  stop(): void
  readonly state: FadeState
}

export function createFadeTimer(o: { ms: number; fadeMs: number; onFading: () => void; onGone: () => void }): FadeTimer {
  let state: FadeState = 'gone'
  let timer: ReturnType<typeof setTimeout> | undefined
  const gone = (): void => { clearTimeout(timer); state = 'gone'; o.onGone() }
  const wait = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!o.fadeMs) return gone()
      state = 'fading'
      o.onFading()
      timer = setTimeout(gone, o.fadeMs)
    }, o.ms)
  }
  return {
    get state() { return state },
    start() { state = 'shown'; wait() },
    pause() { if (state === 'gone') return; clearTimeout(timer); state = 'shown' },
    resume() { if (state === 'shown') wait() },
    stop() { clearTimeout(timer); state = 'gone' },
    close() { if (state !== 'gone') gone() },
  }
}
