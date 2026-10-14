/** Long-press drag for a field's grip, with pointer events (no library). The drop lands in a `[data-zone]` section, before a `[data-slot]` field. */
import type { Section } from './placement'

const HOLD_MS = 350
const SLOP_PX = 8

export const drag = $state({ key: null as string | null, zone: null as string | null, before: null as string | null })

export type Drop = (key: string, section: Section, before: string | null) => void

function whereAt(x: number, y: number): { zone: string; before: string | null } | null {
  const el = document.elementFromPoint(x, y)
  const slot = el?.closest<HTMLElement>('[data-slot]')
  const zone = (slot ?? el)?.closest<HTMLElement>('[data-zone]')
  if (!zone?.dataset.zone) return null
  if (!slot) return { zone: zone.dataset.zone, before: null }
  const r = slot.getBoundingClientRect()
  const next = (slot.nextElementSibling as HTMLElement | null)?.dataset.slot ?? null
  return { zone: zone.dataset.zone, before: y < r.top + r.height / 2 ? slot.dataset.slot ?? null : next }
}

export function grip(node: HTMLElement, onDrop: Drop): { update: (d: Drop) => void; destroy: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let origin = { x: 0, y: 0, id: 0 }
  let drop = onDrop

  function reset(): void {
    clearTimeout(timer)
    timer = undefined
    drag.key = drag.zone = drag.before = null
  }

  function down(e: PointerEvent): void {
    origin = { x: e.clientX, y: e.clientY, id: e.pointerId }
    timer = setTimeout(() => {
      node.setPointerCapture(origin.id)
      drag.key = node.dataset.key ?? null
      navigator.vibrate?.(15)
    }, HOLD_MS)
  }

  function move(e: PointerEvent): void {
    if (drag.key === null) {
      if (timer && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > SLOP_PX) reset()
      return
    }
    const at = whereAt(e.clientX, e.clientY)
    drag.zone = at?.zone ?? null
    drag.before = at?.before ?? null
  }

  function up(e: PointerEvent): void {
    const key = drag.key
    const at = key === null ? null : whereAt(e.clientX, e.clientY)
    reset()
    if (key !== null && at && at.before !== key) drop(key, at.zone as Section, at.before)
  }

  node.addEventListener('pointerdown', down)
  node.addEventListener('pointermove', move)
  node.addEventListener('pointerup', up)
  node.addEventListener('pointercancel', reset)
  return {
    update: (d) => { drop = d },
    destroy: () => {
      reset()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', reset)
    },
  }
}
