/**
 * The app's one toast (main.ts). A toast never takes taps, unless it is given an onClick (Jakob 2026-10-19: "<name> added." opens
 * their card): then it is a button for that message only, keyboard-reachable. `mark` names a data attribute it carries meanwhile.
 */
export interface ToastOpts {
  onClick?: () => void
  /** A dataset key (camelCase), e.g. 'archivedToast' -> [data-archived-toast]. */
  mark?: string
}

export function createToast(t: HTMLElement, ms = 3200): (msg: string, o?: ToastOpts) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let shown: ToastOpts = {}
  const hide = (): void => {
    t.classList.remove('on', 'tap')
    if (shown.mark) delete t.dataset[shown.mark]
    t.setAttribute('role', 'status')
    t.removeAttribute('tabindex')
    shown = {}
  }
  const tap = (): void => {
    const go = shown.onClick
    if (!go) return
    clearTimeout(timer)
    hide()
    go()
  }
  t.addEventListener('click', tap)
  t.addEventListener('keydown', (e) => { if (shown.onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tap() } })
  return (msg, o = {}) => {
    hide()
    shown = o
    t.textContent = msg
    if (o.mark) t.dataset[o.mark] = ''
    if (o.onClick) { t.setAttribute('role', 'button'); t.setAttribute('tabindex', '0'); t.classList.add('tap') }
    t.classList.add('on')
    clearTimeout(timer)
    timer = setTimeout(hide, ms)
  }
}
