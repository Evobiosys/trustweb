// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-circles-view: the Circles view under the eye. Each tag is a circle: its people on a ring around its name. Drag a person from the pool (or another
 * circle) into a circle to give the tag, out of a circle to take it off. Tap a circle = open its people, tap a person = card, long press / right click = rename.
 * Local only (I1): only the owner's own tags and people. DOM; main.ts passes the app in.
 */
import { el } from '../../demo/src/ui/dom'
import type { Person } from './model'
import { Ring } from './model'
import { type ColourTag, memberIds } from './colour_tags'
import { applyDrop } from './circles_apply'
import { type Circle, NEW_CIRCLE, circlesOf, dropEffect, hiddenCount, ringSlots } from './circles_model'
import { contextPress } from './context_press'
import { hitControls } from './expanse'
import { S } from './strings'
import { dragStarts } from './web_view'

export interface CirclesIo {
  people: () => Person[]
  save: () => void
  tags: () => readonly ColourTag[]
  saveTags: (t: readonly ColourTag[]) => void
  /** A person's avatar (picture or initial). */
  face: (p: Person) => HTMLElement
  /** The person's card. */
  open: (id: string) => void
  toast: (msg: string, undo: () => void) => void
}

/** A touch must rest this long on an avatar before it lifts (a quicker swipe scrolls the page instead). */
const LIFT_MS = 250
/** Who is in the pool: everyone in the web, not removed and not archived. */
const alive = (p: Person): boolean => p.deleted_at === undefined && p.ring !== Ring.None

let openId: string | null = null

export function circlesView(io: CirclesIo, redraw: () => void = () => undefined): HTMLElement {
  const people = io.people().filter(alive)
  const tags = io.tags()
  const circles = circlesOf(tags, (id) => memberIds(people, tags, id))
  const byId = new Map(people.map((p) => [p.id, p]))
  const root = el('div', { class: 'circles', 'data-circles': '' })
  const heldBy = (pid: string): Set<string> => new Set(circles.filter((c) => c.members.includes(pid)).map((c) => c.id))

  const person = (pid: string, from: string | null, cls: string, label?: string): HTMLElement => {
    const p = byId.get(pid)!
    const b = el('button', { class: cls, type: 'button', 'data-drag-pid': pid, 'data-from': from ?? '', 'aria-label': S.circles.personAria(p.name), title: p.name }, [io.face(p), label ? el('span', { class: 'circle-pname' }, [label]) : null])
    return b
  }

  const circleEl = (c: Circle): HTMLElement => {
    const slots = ringSlots(c.members.length)
    const more = hiddenCount(c.members.length)
    const body = el('button', { class: 'circle-body', type: 'button', 'data-circle-open': c.id, 'aria-expanded': String(openId === c.id), 'aria-label': S.circles.circleAria(c.name, c.members.length), onclick: () => { openId = openId === c.id ? null : c.id; redraw() } },
      [el('b', { class: 'circle-name' }, [c.name]), el('small', { class: 'circle-count' }, [String(c.members.length)]), more ? el('small', { class: 'circle-more' }, [S.circles.more(more)]) : null])
    contextPress(body, () => { openId = c.id; redraw(); setTimeout(() => root.querySelector<HTMLInputElement>('[data-circle-rename]')?.focus(), 0) })
    const wrap = el('div', { class: 'circle' + (openId === c.id ? ' open' : ''), 'data-circle': c.id, style: `--d:${c.size}px; --c:${c.colour}` }, [body])
    c.members.slice(0, slots.length).forEach((pid, i) => {
      const a = person(pid, c.id, 'circle-av')
      a.style.left = `${slots[i].x * 100}%`; a.style.top = `${slots[i].y * 100}%`
      wrap.appendChild(a)
    })
    return wrap
  }

  const newInput = el('input', { class: 'circle-new-name', type: 'text', maxlength: '40', placeholder: S.circles.namePh, 'aria-label': S.circles.nameAria, 'data-circle-new-name': '' }) as HTMLInputElement
  const newTile = el('div', { class: 'circle circle-new', 'data-circle': NEW_CIRCLE, style: '--d:104px' }, [el('span', { class: 'circle-new-text' }, [S.circles.dropNew]), newInput])

  const open = circles.find((c) => c.id === openId)
  const panel = open
    ? el('section', { class: 'circle-panel', 'data-circle-panel': open.id, style: `--c:${open.colour}` }, [
      el('div', { class: 'circle-panel-head' }, [
        el('b', {}, [S.circles.openTitle(open.name), ' · ', S.circles.count(open.members.length)]),
        el('button', { class: 'linkbtn', type: 'button', 'data-circle-close': '', onclick: () => { openId = null; redraw() } }, [S.circles.close]),
      ]),
      renameBox(open, tags, io, redraw),
      el('div', { class: 'circle-chips' }, open.members.length ? open.members.map((pid) => person(pid, open.id, 'circle-chip', byId.get(pid)!.name)) : [el('p', { class: 'meta' }, [S.circles.emptyCircle])]),
    ])
    : null

  const pool = el('section', { class: 'circle-pool', 'data-circles-pool': '' }, [
    el('h3', { class: 'eyebrow' }, [S.circles.people]),
    el('div', { class: 'circle-chips' }, people.length ? [...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => person(p.id, null, 'circle-chip', p.name)) : [el('p', { class: 'meta' }, [S.circles.nobody])]),
  ])

  root.append(el('p', { class: 'meta circles-hint' }, [S.circles.hint]), el('div', { class: 'circles-row', 'data-circles-row': '' }, [...circles.map(circleEl), newTile]), ...(panel ? [panel] : []), pool)

  /** Drag: a mouse lifts after 4 px, a touch after it rested LIFT_MS (8 px of movement before that is a scroll). Drop on a circle adds the tag, on nothing removes it from the circle it came out of. */
  let dragged = false
  root.addEventListener('click', (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false } else { const a = (e.target as HTMLElement).closest<HTMLElement>('[data-drag-pid]'); if (a) io.open(a.dataset.dragPid!) } }, true)
  let lifted = false
  root.addEventListener('touchmove', (e) => { if (lifted) e.preventDefault() }, { passive: false })
  root.addEventListener('pointerdown', (down) => {
    const src = (down.target as HTMLElement).closest<HTMLElement>('[data-drag-pid]')
    if (!src || (down.pointerType === 'mouse' && down.button !== 0)) return
    const pid = src.dataset.dragPid!
    const from = src.dataset.from || null
    const touch = down.pointerType !== 'mouse'
    let ghost: HTMLElement | undefined
    let target: string | null = null
    const boxes = (): { left: number; top: number; right: number; bottom: number; id: string; t: HTMLElement }[] =>
      [...root.querySelectorAll<HTMLElement>('[data-circle]')].map((t) => { const { left, top, right, bottom } = t.getBoundingClientRect(); return { left, top, right, bottom, id: t.dataset.circle!, t } })
    const lift = (e: PointerEvent): void => {
      lifted = true; dragged = true
      src.classList.add('lifted')
      root.classList.add('dragging')
      ghost = src.cloneNode(true) as HTMLElement
      ghost.classList.add('circle-ghost')
      ghost.removeAttribute('data-drag-pid')
      document.body.appendChild(ghost)
      move(e)
    }
    const move = (e: PointerEvent): void => {
      if (!ghost) return
      ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`
      const bs = boxes()
      const hit = hitControls(bs, e.clientX, e.clientY)
      target = hit?.id ?? null
      // Letting go over the open circle's own list keeps the person where they are (a slip is no removal).
      const pb = root.querySelector('[data-circle-panel]')?.getBoundingClientRect()
      if (!hit && pb && from && e.clientX >= pb.left && e.clientX <= pb.right && e.clientY >= pb.top && e.clientY <= pb.bottom) target = from
      for (const b of bs) b.t.classList.toggle('drop', b === hit && b.id !== from)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onMove = (e: PointerEvent): void => {
      if (lifted) { move(e); return }
      if (!dragStarts(e.clientX - down.clientX, e.clientY - down.clientY, touch)) return
      if (touch) end(false)        // moved before the hold: a scroll
      else lift(e)
    }
    const end = (drop: boolean, e?: PointerEvent): void => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      ghost?.remove()
      root.classList.remove('dragging')
      for (const t of root.querySelectorAll('.drop')) t.classList.remove('drop')
      src.classList.remove('lifted')
      if (lifted && drop && e) finish()
      lifted = false
      setTimeout(() => { dragged = false }, 0)
    }
    const onUp = (e: PointerEvent): void => end(true, e)
    const onCancel = (): void => end(false)
    const finish = (): void => {
      const p = byId.get(pid)
      if (!p) return
      const effect = dropEffect(from, target, heldBy(pid))
      if (!effect.add && !effect.remove && !effect.create) return
      const beforeFields = p.fields ? { ...p.fields } : undefined
      const beforeTags = io.tags()
      const nameOf = (id: string | undefined): string => tags.find((t) => t.id === id)?.label ?? id ?? ''
      const made = applyDrop(p, effect, beforeTags, newInput.value.trim() || S.circles.newName(circles.length + 1))
      if (made.tags !== beforeTags) io.saveTags(made.tags)
      io.save()
      const msg = effect.create ? S.circles.created(p.name, made.tags.find((t) => t.id === made.added)?.label ?? '') : effect.add ? S.circles.added(p.name, nameOf(effect.add)) : S.circles.removed(p.name, nameOf(effect.remove))
      io.toast(msg, () => { if (beforeFields) p.fields = beforeFields; else delete p.fields; io.saveTags(beforeTags); io.save(); redraw() })
      redraw()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    if (touch) timer = setTimeout(() => lift(down), LIFT_MS)
  })
  return root
}

/** The circle's name: a small greyed box (an optional input looks optional); the new name is saved on change. */
function renameBox(c: Circle, tags: readonly ColourTag[], io: CirclesIo, redraw: () => void): HTMLElement {
  const i = el('input', { class: 'circle-rename', type: 'text', maxlength: '40', value: c.name, 'aria-label': S.circles.renameAria, 'data-circle-rename': c.id }) as HTMLInputElement
  i.addEventListener('change', () => {
    const label = i.value.trim()
    if (!label) { i.value = c.name; return }
    io.saveTags(tags.map((t) => (t.id === c.id ? { ...t, label } : t)))
    redraw()
  })
  return i
}

