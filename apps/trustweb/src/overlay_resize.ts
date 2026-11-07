// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37: a drag handle at the bottom-right of the ring list card; its size is kept per ring (overlay_size.ts) and restored on open. */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'
import { clampSize, overlayKey, parseSize, serializeSize, type OverlaySize } from './overlay_size'

/** Call after `card` sits in the page (its position is set). `scale` = on-screen px per layout px of the zoom layer around it. */
export function makeResizable(card: HTMLElement, ring: string, scale: number, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const key = overlayKey(ring)
  const room = (): OverlaySize => {
    const r = card.getBoundingClientRect()
    return { w: Math.max(0, (document.documentElement.clientWidth - r.left) / scale - 4), h: Math.max(0, (window.innerHeight - r.top) / scale - 4) }
  }
  const apply = (s: OverlaySize): OverlaySize => {
    const c = clampSize(s, room())
    card.style.maxWidth = 'none'; card.style.maxHeight = 'none'
    card.style.width = c.w + 'px'; card.style.height = c.h + 'px'
    return c
  }
  let saved: OverlaySize | null = null
  try { saved = parseSize(storage.getItem(key)) } catch { /* not remembered */ }
  if (saved) apply(saved)
  const grip = el('span', { class: 'ring-card-grip', 'data-ring-card-grip': '', role: 'separator', 'aria-label': S.ringCardResize, title: S.ringCardResize })
  grip.addEventListener('pointerdown', (d) => {
    d.preventDefault(); d.stopPropagation()
    grip.setPointerCapture(d.pointerId)
    const from = { x: d.clientX, y: d.clientY, w: card.offsetWidth, h: card.offsetHeight }
    const move = (e: PointerEvent): void => { apply({ w: from.w + (e.clientX - from.x) / scale, h: from.h + (e.clientY - from.y) / scale }) }
    const end = (): void => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end)
      try { storage.setItem(key, serializeSize({ w: card.offsetWidth, h: card.offsetHeight })) } catch { /* not remembered */ }
    }
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end)
  })
  card.appendChild(grip)
}
