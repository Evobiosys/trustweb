/**
 * The Manage outliner (wave 7): each person as one row (name, ring, TrustWeb icon, favourite way). A tap opens the person's page,
 * the Web Curator's own (main.ts personSheet).
 */
import { el } from '../../demo/src/ui/dom'
import { Presence, favouriteLink, presence } from './outliner_fields'
import { displayName } from '../../../packages/person-fields/src/display_name'
import { Ring } from './model'
import { ringChips } from './ring_chips'
import { inContact } from './rings_layout'
import type { AppState, Person } from './model'
import { S } from './strings'

export interface OutlinerDeps {
  s: AppState
  people: Person[]
  save: () => void
  /** The app's ring change for this person (it owns the ask-again rule of a tighter ring). */
  setRing: (p: Person, r: Ring) => void
  /** The person's page. */
  openCard: (p: Person) => void
  /** Row of ring, then name, as the old list ordered it. */
  order: (a: Person, b: Person) => number
}

/** The collapsed "Not in my web" group, kept across re-renders. */
let notInWebOpen = false

export function outlinerView(d: OutlinerDeps): HTMLElement {
  const root = el('div', { class: 'ppl outliner' })
  const draw = (): void => {
    const sorted = [...d.people].sort(d.order)
    const out = sorted.filter((p) => p.ring === Ring.None)
    const group = el('details', { class: 'onotweb', ontoggle: (e) => { notInWebOpen = (e.target as HTMLDetailsElement).open } }, [
      el('summary', {}, [S.olNotInWeb(out.length)]),
      ...out.map(person),
    ])
    group.open = notInWebOpen
    root.replaceChildren(...sorted.filter((p) => p.ring !== Ring.None).map(person), ...(out.length ? [group] : []))
  }

  const person = (p: Person): HTMLElement => {
    const tw = presence(d.s, p, Date.now())
    const fav = favouriteLink(p)
    const shown = displayName(p.name)
    return el('div', { class: 'operson' }, [el('div', { class: 'prow' }, [
      el('button', { class: 'who', onclick: () => d.openCard(p) }, [
        el('b', { title: shown.title }, [shown.glyph ? shown.glyph + ' ' + shown.text : shown.text]),
        el('i', {}, [[p.intending && !inContact(p, d.s.meetings) ? S.olWants(p.intending.value) : '', p.context || (p.ring === Ring.Intending ? S.olNoContext : '')].filter(Boolean).join(' · ')]),
      ]),
      ringChips(p, (r) => { d.setRing(p, r); draw() }),
      tw ? el('span', { class: 'otw ' + tw, role: 'img', 'aria-label': tw === Presence.Active ? S.olTwActive : S.olTwQuiet }) : null,
      fav ? el('a', { class: 'ofav', href: fav.href, 'aria-label': fav.label, title: fav.id === 'email' ? fav.href.replace('mailto:', '') : fav.label }, [fav.glyph]) : null,
    ])])
  }

  draw()
  return root
}
