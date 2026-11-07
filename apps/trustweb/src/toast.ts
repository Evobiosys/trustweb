/**
 * The app's one toast (main.ts). A toast never takes taps, unless it is given an onClick (Jakob 2026-10-19: "<name> added." opens
 * their card): then it is a button for that message only, keyboard-reachable. `mark` names a data attribute it carries meanwhile.
 */
import { createFadeTimer, type FadeTimer } from './fade_timer'

/** Wave 28: every toast/notice bar fades after FADE_AFTER_MS (400 ms opacity fade; none under prefers-reduced-motion) and carries an x. */
export const FADE_AFTER_MS = 5000
const FADE_MS = 400

/** Hover, focus or touch-hold on `host` keeps its bar; `start` (re)arms the timer, `close` ends it, `x` makes the closing button. */
export function fadeHost(host: HTMLElement, onGone: () => void): { start: (ms?: number) => void; close: () => void; x: (label: string) => HTMLButtonElement } {
  let timer: FadeTimer | undefined
  const hold = (): void => timer?.pause()
  const free = (): void => timer?.resume()
  for (const [a, b] of [['mouseenter', 'mouseleave'], ['touchstart', 'touchend'], ['touchstart', 'touchcancel'], ['focusin', 'focusout']] as const) {
    host.addEventListener(a, hold, { passive: true })
    host.addEventListener(b, free, { passive: true })
  }
  const close = (): void => timer?.close()
  return {
    start(ms = FADE_AFTER_MS) {
      timer?.stop()
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
      host.classList.remove('fading')
      timer = createFadeTimer({ ms, fadeMs: reduce ? 0 : FADE_MS, onFading: () => host.classList.add('fading'), onGone: () => { host.classList.remove('fading'); onGone() } })
      timer.start()
    },
    close,
    x(label) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'fade-x'
      b.setAttribute('data-notice-close', '')
      b.textContent = '×'
      b.setAttribute('aria-label', label)
      b.title = label
      b.addEventListener('click', (e) => { e.stopPropagation(); close() })
      return b
    },
  }
}

export interface ToastOpts {
  onClick?: () => void
  /** A dataset key (camelCase), e.g. 'archivedToast' -> [data-archived-toast]. */
  mark?: string
}

export function createToast(t: HTMLElement, closeLabel: string, ms = FADE_AFTER_MS): (msg: string, o?: ToastOpts) => void {
  let shown: ToastOpts = {}
  const fade = fadeHost(t, () => hide())
  const hide = (): void => {
    t.classList.remove('on', 'tap', 'fading')
    if (shown.mark) delete t.dataset[shown.mark]
    t.setAttribute('role', 'status')
    t.removeAttribute('tabindex')
    shown = {}
  }
  const tap = (): void => {
    const go = shown.onClick
    if (!go) return
    fade.close()
    go()
  }
  t.addEventListener('click', tap)
  t.addEventListener('keydown', (e) => { if (e.target === t && shown.onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tap() } })
  return (msg, o = {}) => {
    hide()
    shown = o
    t.replaceChildren(msg, fade.x(closeLabel))
    if (o.mark) t.dataset[o.mark] = ''
    if (o.onClick) { t.setAttribute('role', 'button'); t.setAttribute('tabindex', '0'); t.classList.add('tap') }
    t.classList.add('on')
    fade.start(ms)
  }
}
