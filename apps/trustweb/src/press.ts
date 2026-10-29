// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25 rule (Jakob 2026-10-29): hover on the desktop == long press on the phone; one press = the small card, two = the full page. */
import { contextPress } from './context_press'

export const DOUBLE_MS = 280

/** A click handler: a lone press calls `single` once the double window has passed, two presses inside it call `double` only. */
export function singleOrDouble(single: () => void, double: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return () => {
    if (timer === undefined) { timer = setTimeout(() => { timer = undefined; single() }, DOUBLE_MS); return }
    clearTimeout(timer); timer = undefined; double()
  }
}

/** `on` while a mouse hovers `target` or after a touch holds it 500 ms (context_press.ts), `off` when the mouse leaves. A hold has no leave: the caller ends it. */
export function onHoverOrLongPress(target: Element, on: () => void, off: () => void): void {
  target.addEventListener('pointerenter', (e) => { if ((e as PointerEvent).pointerType === 'mouse') on() })
  target.addEventListener('pointerleave', (e) => { if ((e as PointerEvent).pointerType === 'mouse') off() })
  contextPress(target as HTMLElement, on)
}
