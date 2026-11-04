// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30: one person row of the People list (also the Map's list): open button, ✎ inline name edit, archive box, and a pointer drag onto another ring group. */
import { el } from '../../demo/src/ui/dom'
import { HELLO_NAME_MAX } from './hello'
import type { Person } from './model'
import { Ring } from './model'
import { nameEdit } from './ring_hover'
import { dragMovedTo, dropRing } from './row_edit'
import type { ZoneBox } from './row_edit'
import { webSlot } from './rings_layout'
import { contextPress } from './context_press'
import { dragStarts } from './web_view'
import { editKey } from './tap_edit'
import { S } from './strings'
import { toolsRowAfterTap } from './row_tools'

/** What a row does to the record; the list view owns the redraw, the undo and the toasts. */
export interface RowActions {
  open(id: string): void
  rename(p: Person, name: string): void
  archive(p: Person): void
  move(p: Person, ring: Ring): void
  /** Multi-select: set while the mode is on (a tap toggles the row, no edit, no drag); `pick` enters it from a right click or a long press. */
  select?: { checked: boolean; toggle(): void }
  pick(p: Person): void
}

const HOLD_MS = 300

/** The boxes of the ring groups on screen (not the pinned one) under `root`. */
function zoneBoxes(root: ParentNode): { box: ZoneBox; node: HTMLElement }[] {
  return [...root.querySelectorAll<HTMLElement>('section[data-zone]:not([data-zone="pinned"])')].map((node) => {
    const r = node.getBoundingClientRect()
    return { node, box: { ring: node.dataset.zone as Ring, left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
  })
}

// Touch has no hover: a tap opens the tools of that one row, a tap anywhere else closes them.
let toolsHost: HTMLElement | null = null
let toolsId: string | null = null
function tapRow(host: HTMLElement | null, id: string | null): void {
  toolsId = toolsRowAfterTap(toolsId, id)
  toolsHost?.classList.remove('tools-on')
  toolsHost = toolsId ? host : null
  toolsHost?.classList.add('tools-on')
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || (e.target as Element | null)?.closest('.row-tool')) return
    const row = (e.target as Element | null)?.closest<HTMLElement>('.person-row') ?? null
    tapRow(row, row?.dataset.personRow ?? null)
  }, true)
}

export function personRow(p: Person, a: RowActions): HTMLElement {
  const host = el('div', { class: 'person-row', 'data-person-row': p.id })
  let lifted = false
  let swallow = false
  const show = (): void => {
    if (a.select) {
      const { checked, toggle } = a.select
      host.replaceChildren(el('label', { class: 'row-pick' + (checked ? ' on' : '') }, [
        el('input', { type: 'checkbox', 'data-row-check': p.id, checked, 'aria-label': p.name, onchange: toggle }),
        el('b', {}, [p.name]), p.context ? el('small', { class: 'meta' }, [p.context]) : null,
      ]))
      return
    }
    const open = el('button', { class: 'zoom-row', 'data-person': p.id, onclick: () => { if (!swallow) a.open(p.id) } }, [
      el('b', {}, [p.name]), p.context ? el('small', { class: 'meta' }, [p.context]) : null,
    ])
    host.replaceChildren(
      open,
      el('button', { class: 'row-tool row-tool-hover', 'data-row-edit': p.id, 'aria-label': S.rowEdit, title: S.rowEdit, onclick: edit }, ['✎']),
      el('button', { class: 'row-tool row-tool-hover', 'data-row-archive': p.id, 'aria-label': S.rowArchive, title: S.rowArchive, onclick: () => a.archive(p) }, ['🗃']),
    )
  }
  const edit = (): void => {
    const input = el('input', { class: 'field tap-edit-input', 'aria-label': S.zoneRename(p.name), maxlength: String(HELLO_NAME_MAX), 'data-row-input': p.id }) as HTMLInputElement
    input.value = p.name
    const finish = (how: 'save' | 'cancel'): void => {
      const r = nameEdit(p.name, input.value, how)
      if (r.kind === 'commit') a.rename(p, r.name)
      else show()
    }
    input.addEventListener('keydown', (e) => { const k = editKey(e.key); if (k) { e.preventDefault(); finish(k) } })
    host.replaceChildren(
      input,
      el('button', { class: 'row-tool ok-mark', 'data-row-accept': p.id, 'aria-label': S.rowAccept, title: S.rowAccept, onclick: () => finish('save') }, ['✓']),
      el('button', { class: 'row-tool cancel-mark', 'data-row-cancel': p.id, 'aria-label': S.rowCancel, title: S.rowCancel, onclick: () => finish('cancel') }, ['✕']),
    )
    input.focus(); input.select()
  }
  // The page still scrolls until the hold has lifted the row.
  host.addEventListener('touchmove', (e) => { if (lifted) e.preventDefault() }, { passive: false })
  contextPress(host, () => { if (!a.select) a.pick(p) })
  host.addEventListener('pointerdown', (down) => {
    if (a.select || (down.target as HTMLElement).closest('.row-tool, input') || (down.pointerType === 'mouse' && down.button !== 0)) return
    const touch = down.pointerType !== 'mouse'
    const root = host.closest('.people-list') ?? document
    let over: HTMLElement | null = null
    const lift = (): void => { lifted = true; host.classList.add('lifted') }
    const timer = touch ? window.setTimeout(lift, HOLD_MS) : 0
    const target = (e: PointerEvent): { node: HTMLElement; ring: Ring } | null => {
      const boxes = zoneBoxes(root)
      const ring = dropRing(boxes.map((b) => b.box), e.clientX, e.clientY)
      const node = boxes.find((b) => b.box.ring === ring)?.node
      return ring && node ? { node, ring } : null
    }
    const move = (e: PointerEvent): void => {
      if (!lifted) {
        if (!dragStarts(e.clientX - down.clientX, e.clientY - down.clientY, touch)) return
        if (touch) { end(); return }
        lift()
      }
      host.style.transform = `translate(${e.clientX - down.clientX}px, ${e.clientY - down.clientY}px)`
      const now = target(e)?.node ?? null
      if (now !== over) { over?.classList.remove('drop'); now?.classList.add('drop'); over = now }
    }
    const end = (): void => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      over?.classList.remove('drop')
      host.classList.remove('lifted')
      host.style.transform = ''
    }
    const cancel = (): void => { end(); lifted = false }
    const up = (e: PointerEvent): void => {
      const was = lifted
      const to = was ? dragMovedTo(webSlot(p), target(e)?.ring ?? null) : null
      end(); lifted = false
      if (!was) return
      swallow = true
      setTimeout(() => { swallow = false }, 0)
      if (to) a.move(p, to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  })
  show()
  return host
}
