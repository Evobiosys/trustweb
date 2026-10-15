/** Right click, or a touch held 500 ms without moving 6 px: calls `onPress`. The click that ends a long press is swallowed. */
const HOLD_MS = 500
const SLOP_PX = 6

export function contextPress(target: HTMLElement, onPress: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let from = { x: 0, y: 0 }
  let swallow = false
  const stop = (): void => { clearTimeout(timer); timer = undefined }
  target.addEventListener('pointerdown', (e) => {
    swallow = false
    if (e.pointerType === 'mouse') return
    from = { x: e.clientX, y: e.clientY }
    stop()
    timer = setTimeout(() => { timer = undefined; swallow = true; navigator.vibrate?.(15); onPress() }, HOLD_MS)
  })
  target.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP_PX) stop() })
  for (const ev of ['pointerup', 'pointercancel']) target.addEventListener(ev, stop)
  target.addEventListener('click', (e) => { if (swallow) { swallow = false; e.stopImmediatePropagation(); e.preventDefault() } }, true)
  target.addEventListener('contextmenu', (e) => { e.preventDefault(); stop(); onPress() })
}
