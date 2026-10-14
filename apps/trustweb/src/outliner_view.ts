/**
 * The Manage outliner (wave 7): each person as a collapsed row, an expanded simple view and an expanded advanced view
 * (fields and rules: outliner_fields.ts). A long press on a field lifts it; dropping it moves it within or across the two sections,
 * remembered on this device. Pointer events, no library.
 */
import { el } from '../../demo/src/ui/dom'
import { Presence, favouriteLink, loadLayout, moveField, presence, saveLayout, sections, setValue, slotOf, value } from './outliner_fields'
import type { Layout, Slot } from './outliner_fields'
import { Ring } from './model'
import type { AppState, Person } from './model'
import { S } from './strings'

export interface OutlinerDeps {
  s: AppState
  people: Person[]
  save: () => void
  /** The app's ring picker for this person (it owns the ask-again rule of a tighter ring). */
  pickRing: (p: Person) => void
  /** The person's full card. */
  openCard: (p: Person) => void
  /** Row of ring, then name, as the old list ordered it. */
  order: (a: Person, b: Person) => number
}

type Open = 'simple' | 'advanced'
/** Which people are expanded; kept across the re-renders a search keystroke causes. */
const opened = new Map<string, Open>()

const LONG_PRESS_MS = 420
/** A move beyond this before the press is long enough is a scroll, not a lift. */
const SLOP_PX = 8

export function outlinerView(d: OutlinerDeps): HTMLElement {
  const root = el('div', { class: 'ppl outliner' })
  let layout = loadLayout()
  const draw = (): void => root.replaceChildren(...[...d.people].sort(d.order).map(person))

  const input = (p: Person, x: Slot): HTMLElement => {
    const commit = (v: string): void => { setValue(p, x.id, v); d.save() }
    if (x.kind === 'ring') return el('button', { class: 'ofield-ring shield ring-' + p.ring, onclick: () => d.pickRing(p) }, [S.ringLabel[p.ring]])
    if (x.kind === 'checkbox') return el('input', { type: 'checkbox', 'aria-label': x.label, checked: value(p, x.id) === 'true', onchange: (e) => commit((e.target as HTMLInputElement).checked ? 'true' : '') })
    if (x.kind === 'options') {
      const sel = el('select', { class: 'field', 'aria-label': x.label, onchange: () => { commit(sel.value); draw() } }, [el('option', { value: '' }, ['—']), ...(x.options ?? []).map((o) => el('option', { value: o.id }, [o.label]))])
      sel.value = value(p, x.id)
      return sel
    }
    return el('input', { class: 'field', 'aria-label': x.label, value: value(p, x.id), maxlength: '500', autocomplete: 'off', onchange: (e) => commit((e.target as HTMLInputElement).value) })
  }

  const field = (p: Person, id: string): HTMLElement | null => {
    const x = slotOf(id)
    return x ? el('div', { class: 'ofield', 'data-field': id }, [el('label', { class: 'olabel', 'data-grip': '' }, [x.label]), input(p, x)]) : null
  }

  const section = (p: Person, name: keyof Layout, ids: string[]): HTMLElement =>
    el('div', { class: 'osection', 'data-section': name }, ids.map((id) => field(p, id)))

  const person = (p: Person): HTMLElement => {
    const mode = opened.get(p.id)
    const tw = presence(d.s, p, Date.now())
    const fav = favouriteLink(p)
    const toggle = (): void => { if (mode) opened.delete(p.id); else opened.set(p.id, 'simple'); draw() }
    const head = el('div', { class: 'prow' }, [
      el('button', { class: 'who', 'aria-expanded': String(!!mode), onclick: toggle }, [
        el('b', {}, [p.name]),
        el('i', {}, [p.context || (p.ring === Ring.Intending ? S.olNoContext : '')]),
      ]),
      tw ? el('span', { class: 'otw ' + tw, role: 'img', 'aria-label': tw === Presence.Active ? S.olTwActive : S.olTwQuiet }) : null,
      fav ? el('a', { class: 'ofav', href: fav.href, 'aria-label': fav.label, title: fav.label }, [fav.glyph]) : null,
    ])
    if (!mode) return el('div', { class: 'operson' }, [head])
    const sec = sections(p, layout)
    const body = el('div', { class: 'obody' }, [
      section(p, 'simple', sec.simple),
      mode === 'advanced' ? el('h4', { class: 'oadv' }, [S.olAdvanced]) : null,
      mode === 'advanced' ? section(p, 'advanced', sec.advanced) : null,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { opened.set(p.id, mode === 'simple' ? 'advanced' : 'simple'); draw() } }, [mode === 'simple' ? S.olMore : S.olLess]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => d.openCard(p) }, [S.olOpenCard]),
    ])
    body.addEventListener('pointerdown', (e) => lift(e, body))
    return el('div', { class: 'operson open' }, [head, body])
  }

  /** Long press on a field's label lifts it; the drop target is read from what is under the finger. */
  const lift = (down: PointerEvent, body: HTMLElement): void => {
    const row = (down.target as HTMLElement).closest<HTMLElement>('[data-grip]')?.closest<HTMLElement>('[data-field]')
    if (!row) return
    const id = row.dataset.field as string
    let lifted = false
    const stop = (): void => {
      clearTimeout(timer)
      body.removeEventListener('pointermove', move)
      body.removeEventListener('pointerup', up)
      body.removeEventListener('pointercancel', cancel)
      body.removeEventListener('touchmove', block)
      body.querySelector('.drop-before')?.classList.remove('drop-before')
      row.classList.remove('lifted')
    }
    const target = (e: PointerEvent): { to: keyof Layout; before: string | null; mark: HTMLElement | null } | null => {
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-field],[data-section]')
      if (!under || !body.contains(under)) return null
      const sect = under.closest<HTMLElement>('[data-section]')
      if (!sect) return null
      const to = sect.dataset.section as keyof Layout
      if (!under.dataset.field) return { to, before: null, mark: null }
      const r = under.getBoundingClientRect()
      const next = under.nextElementSibling as HTMLElement | null
      return e.clientY < r.top + r.height / 2 ? { to, before: under.dataset.field, mark: under } : { to, before: next?.dataset.field ?? null, mark: next }
    }
    const move = (e: PointerEvent): void => {
      if (!lifted) { if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > SLOP_PX) stop(); return }
      body.querySelector('.drop-before')?.classList.remove('drop-before')
      target(e)?.mark?.classList.add('drop-before')
    }
    const up = (e: PointerEvent): void => {
      const t = lifted ? target(e) : null
      stop()
      if (!t || t.before === id) return
      layout = moveField(layout, id, t.to, t.before)
      saveLayout(layout)
      draw()
    }
    const cancel = (): void => stop()
    const block = (e: Event): void => { if (lifted) e.preventDefault() }
    const timer = setTimeout(() => { lifted = true; row.classList.add('lifted'); navigator.vibrate?.(15) }, LONG_PRESS_MS)
    body.addEventListener('pointermove', move)
    body.addEventListener('pointerup', up)
    body.addEventListener('pointercancel', cancel)
    body.addEventListener('touchmove', block, { passive: false })
  }

  draw()
  return root
}

