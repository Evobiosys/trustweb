// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 feed-events: the Events view, drawn inside its own shadow root. Event cards (date block, place, host) with going / maybe kept in my
 * own slice, a button to share an event to a tag, and the events-map slot: the user pastes the map's address in Settings > Extensions > Events
 * (or here); nothing loads before a consent tap, which stays on this device (localStorage), never synced. "Open in a new tab" is always there.
 */
import { el } from '../../../../demo/src/ui/dom'
import { loadColourTags } from '../../colour_tags'
import { groupsOf } from '../../feed_sources'
import type { AppState } from '../../model'
import type { TwCtx } from '../tw_registry'
import communityCss from '../community-mighty/community.css?inline'
import css from './events.css?inline'
import { DEFAULT_MAP_URL, MODULE_ID, buildEventList, mapEmbedUrl, parseEvents, setRsvp, shareEventToTag, type EventItem, type EventsData, type Rsvp } from './events_model'

export const readEvents = (s: AppState): EventsData => parseEvents(s.extData?.[MODULE_ID])

export function writeEvents(ctx: TwCtx, d: EventsData): void {
  const s = ctx.store()
  s.extData = { ...s.extData, [MODULE_ID]: d }
  ctx.bus.emit('save')
}

const CONSENT_KEY = 'trustweb.v1.events-view.consent'
export const readMapConsent = (): boolean => { try { return localStorage.getItem(CONSENT_KEY) === '1' } catch { return false } }
export function writeMapConsent(on: boolean): void {
  try { if (on) localStorage.setItem(CONSENT_KEY, '1'); else localStorage.removeItem(CONSENT_KEY) } catch { /* not kept: the next load asks again */ }
}

type Kids = (Node | string | null | undefined)[]
const btn = (label: string, onclick: () => void, attrs: Record<string, string> = {}, cls = 'lnk'): HTMLButtonElement => el('button', { class: cls, type: 'button', ...attrs, onclick }, [label])

export function mountEvents(hostEl: HTMLElement, ctx: TwCtx): () => void {
  const t = ctx.strings.eventsView
  const box = el('div', { class: 'events-host', 'data-events': '' })
  hostEl.append(box)
  const root = box.attachShadow({ mode: 'open' })
  const ui: { sharing: string | null; note: string; mapNote: string; mapEdit: boolean } = { sharing: null, note: '', mapNote: '', mapEdit: false }
  const st = (): AppState => ctx.store()
  const data = (): EventsData => readEvents(st())
  const save = (d: EventsData): void => { writeEvents(ctx, d); draw() }

  function rsvpRow(c: EventItem): HTMLElement {
    const one = (v: Rsvp, label: string): HTMLElement => btn(label, () => save(setRsvp(data(), c.id, v)), { 'aria-pressed': String(c.rsvp === v), 'data-events-rsvp': `${c.id}:${v}` })
    return el('div', { class: 'rsvp' }, [one('going', t.going), one('maybe', t.maybe)])
  }

  function shareRow(c: EventItem): Kids {
    const tags = loadColourTags()
    const mine = groupsOf(st(), tags).filter((g) => g.id.startsWith('tag:'))
    if (ui.sharing !== c.id) return [btn(t.share, () => { ui.sharing = c.id; ui.note = ''; draw() }, { 'data-events-share': c.id })]
    if (!mine.length) return [el('p', { class: 'meta' }, [t.shareNone])]
    return [el('div', { class: 'rsvp' }, [el('span', { class: 'meta' }, [t.shareTo]), ...mine.map((g) => btn(g.name, () => {
      if (shareEventToTag(st(), tags, c, g.id.slice(4), Date.now())) { ctx.bus.emit('save'); ui.note = t.shared(g.name) }
      ui.sharing = null
      draw()
    }, { 'data-events-share-to': g.id.slice(4) }))])]
  }

  function eventCard(c: EventItem): HTMLElement {
    return el('article', { class: 'card event' + (c.past ? ' past' : ''), 'data-events-card': c.id }, [
      el('div', { class: 'date', 'aria-hidden': 'true' }, [el('small', {}, [c.month]), el('b', {}, [c.day])]),
      el('div', { class: 'ev-body' }, [
        btn(c.name, () => ctx.bus.emit('open-event', c.id), { 'data-events-open': c.id }, 'lnk title'),
        el('div', { class: 'meta' }, [[c.from + (c.to && c.to !== c.from ? ` – ${c.to}` : ''), c.where].filter(Boolean).join(' · ')]),
        c.host ? el('div', { class: 'meta' }, [t.hostedBy(c.host)]) : null,
        rsvpRow(c),
        ...shareRow(c),
      ]),
    ])
  }

  /** The map slot: paste the address once (also under Settings), nothing loads before the consent tap. */
  function mapSlot(): HTMLElement {
    const d = data()
    const src = mapEmbedUrl(d.mapUrl ?? DEFAULT_MAP_URL)
    const kids: Kids = [el('h3', { class: 'eyebrow' }, [t.mapTitle])]
    // Review wave 40: Change opens the address field (deleting mapUrl only brought the default map straight back).
    const change = btn(t.mapChange, () => { ui.mapEdit = true; ui.mapNote = ''; draw() }, { 'data-events-map-change': '' })
    if (!src || ui.mapEdit) {
      const input = el('input', { type: 'url', placeholder: t.mapPh, 'aria-label': t.mapPh, 'data-events-map-url': '', value: d.mapUrl ?? '' }) as HTMLInputElement
      kids.push(src ? null : el('p', { class: 'meta' }, [t.mapNone]), input, btn(t.save, () => {
        const url = mapEmbedUrl(input.value)
        if (!url) { ui.mapNote = t.mapBad; draw(); return }
        ui.mapNote = ''
        ui.mapEdit = false
        save({ ...data(), mapUrl: url })
      }, { 'data-events-map-save': '' }, 'lnk strong'), src ? btn(t.cancel, () => { ui.mapEdit = false; ui.mapNote = ''; draw() }, { 'data-events-map-cancel': '' }) : null, ui.mapNote ? el('p', { class: 'note' }, [ui.mapNote]) : null)
    } else if (!readMapConsent()) {
      kids.push(el('p', { class: 'meta' }, [t.mapConsent]), el('div', { class: 'row wrap' }, [
        btn(t.mapLoad, () => { writeMapConsent(true); draw() }, { 'data-events-map-load': '' }, 'lnk strong'),
        el('a', { href: src, target: '_blank', rel: 'noopener noreferrer', 'data-events-map-open': '' }, [t.openNewTab]),
        change,
      ]))
    } else {
      kids.push(el('iframe', { class: 'embed', src, title: t.mapTitle, loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups', 'data-events-map-frame': '' }),
        el('div', { class: 'row wrap' }, [el('a', { href: src, target: '_blank', rel: 'noopener noreferrer', 'data-events-map-open': '' }, [t.openNewTab]), change]))
    }
    return el('div', { class: 'card map', 'data-events-map': '' }, kids)
  }

  // Kept elements: moving an iframe in the DOM reloads it, so the map holder is never re-appended; only its content changes, and only with what it shows.
  const noteEl = el('div', {})
  const mapHolder = el('div', {})
  const listEl = el('div', { class: 'events-list' })
  const main = el('main', { class: 'main events-main' }, [noteEl, mapHolder, listEl])
  const bar = el('div', { class: 'bar' }, [el('h3', { class: 'section' }, [t.viewTitle, ' ', el('sub', { class: 'alpha', 'data-events-alpha': '' }, [ctx.strings.alphaLabel])])])
  root.append(el('style', {}, [communityCss + css]), el('div', { class: 'cm' }, [bar, main]))

  let mapKey = ''
  function draw(): void {
    const cards = buildEventList(st().events, data(), Date.now())
    const past = cards.filter((c) => c.past)
    const rows: Kids = cards.length
      ? [...cards.filter((c) => !c.past).map(eventCard), past.length ? el('h4', { class: 'eyebrow' }, [t.past]) : null, ...past.map(eventCard)]
      : [el('p', { class: 'empty' }, [t.empty])]
    const key = JSON.stringify([data().mapUrl ?? '', readMapConsent(), ui.mapNote, ui.mapEdit])
    if (key !== mapKey) { mapHolder.replaceChildren(mapSlot()); mapKey = key }
    noteEl.replaceChildren(...(ui.note ? [el('p', { class: 'note', 'data-events-note': '' }, [ui.note])] : []))
    listEl.replaceChildren(...rows.filter((n): n is Node => n !== null && n !== undefined))
  }

  draw()
  return () => { root.replaceChildren(); box.remove() }
}
