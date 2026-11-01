/**
 * The "Timeline" section on a person's card (wave 7, timeline.ts): collapsed, the count in its header; entries newest first with a
 * channel glyph and day separators; a tap shows the whole summary and its reference; "+" writes to the person. Wave 28: on the card only the
 * last three show, with a right arrow (the whole timeline as a page) and a plus on the header's own line; Import lives on the Curate page
 * (timelineImportButton); the "Met" entry's date is editable.
 * DOM and words only: the rules (shape, duplicates, import) are timeline.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { ICONS } from './icons'
import { isSystemEvent } from './card_sections'
import { smallTimeline } from './card_small'
import { S } from './strings'
import { TL_CHANNELS, TlChannel, TlDirection, TlSource, IMPORT_MAX_BYTES, byDay, cleanEntry } from './timeline'
import type { TimelineEntry } from './timeline'

export interface TimelineHooks {
  /** All entries on the person now, newest first (typed, imported and TrustWeb's own). */
  entries: () => TimelineEntry[]
  /** Stores typed entries on the person and saves; returns how many went in. */
  add: (entries: TimelineEntry[]) => number
  /** Imports a file's text; returns the message to show. */
  importText: (text: string) => string
  /** Moves the person's met date (the "Met" entry). */
  setMet?: (at: number) => void
}

const GLYPH: Record<TlChannel, string> = {
  [TlChannel.Email]: ICONS.email, [TlChannel.Signal]: ICONS.signal, [TlChannel.WhatsApp]: ICONS.whatsapp, [TlChannel.Matrix]: ICONS.matrix,
  [TlChannel.Call]: ICONS.phone, [TlChannel.InPerson]: ICONS.inperson, [TlChannel.TrustWeb]: ICONS.web, [TlChannel.Note]: ICONS.list,
}
const ARROW: Record<TlDirection, string> = { [TlDirection.In]: '←', [TlDirection.Out]: '→', [TlDirection.Both]: '↔' }

/** `datetime-local` wants local "YYYY-MM-DDTHH:mm". */
function localInput(at: number): string {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function glyph(ch: TlChannel): HTMLElement {
  const g = el('span', { class: 'tl-glyph', title: S.tlChannel[ch], 'aria-label': S.tlChannel[ch] })
  g.innerHTML = GLYPH[ch]
  return g
}

function select(values: readonly string[], labels: Record<string, string>, label: string, attr: string): HTMLSelectElement {
  return el('select', { class: 'field', 'aria-label': label, [attr]: '' }, values.map((v) => el('option', { value: v }, [labels[v]]))) as HTMLSelectElement
}

/** `openAll` given: the card's short form (last three, an arrow that calls it); absent: every entry (the page the arrow opens). */
export function createTimelineSection(h: TimelineHooks, toast: (msg: string) => void, startOpen = false, openAll?: () => void): HTMLElement {
  const list = el('div', { class: 'tl-list', 'aria-live': 'polite' })
  const form = el('div', { class: 'tl-form', hidden: true, 'data-tl-form': '' })
  const toggle = el('button', { class: 'btn btn-ghost btn-sm tl-toggle', type: 'button', 'data-act': 'person-timeline', 'aria-expanded': String(startOpen) })
  const panel = el('div', { class: 'tl-panel', hidden: !startOpen, 'data-tl-panel': '' })
  let open = startOpen

  const draw = (): void => {
    const all = h.entries()
    toggle.textContent = `${open ? '▾' : '▸'} ${S.tlTitle} (${all.length})`
    if (!all.length) { list.replaceChildren(el('p', { class: 'meta', 'data-tl-empty': '' }, [S.tlNone])); return }
    const { shown } = openAll ? smallTimeline(all) : { shown: all }
    list.replaceChildren(...byDay(shown).map((d) => el('div', { class: 'tl-day', 'data-tl-day': String(d.day) }, [
      el('h5', { class: 'eyebrow' }, [new Date(d.day).toLocaleDateString([], { dateStyle: 'medium' })]),
      ...d.entries.map(entryRow),
    ])))
  }

  const entryRow = (e: TimelineEntry): HTMLElement => {
    const more = el('div', { class: 'tl-more meta', hidden: true }, [
      e.summary, e.ref ? ` · ${S.tlRef(e.ref)}` : '', ` · ${S.tlSource[e.source]} · ${S.tlDirection[e.direction]}`,
    ])
    const row = el('button', { class: 'tl-entry ' + (isSystemEvent(e) ? 'tl-sys' : 'tl-human'), type: 'button', 'data-tl-entry': e.channel, 'aria-expanded': 'false' }, [
      glyph(e.channel),
      el('span', { class: 'tl-sum' }, [e.summary]),
      el('i', { class: 'tl-dir' }, [ARROW[e.direction] + ' ' + new Date(e.at).toLocaleTimeString([], { timeStyle: 'short' })]),
    ])
    row.addEventListener('click', () => { more.hidden = !more.hidden; row.setAttribute('aria-expanded', String(!more.hidden)) })
    if (e.met && h.setMet) {
      const date = el('input', { class: 'field', type: 'datetime-local', 'aria-label': S.tlMetWhen, 'data-tl-met-when': '', value: localInput(e.at) }) as HTMLInputElement
      date.addEventListener('change', () => { const at = new Date(date.value).getTime(); if (Number.isFinite(at) && at > 0) { h.setMet?.(at); draw() } })
      more.append(' ', el('label', {}, [S.tlMetWhen, ' ', date]))
    }
    return el('div', { class: 'tl-item' }, [row, more])
  }

  const channel = select(TL_CHANNELS, S.tlChannel, S.tlChannel.email, 'data-tl-channel')
  const direction = select(Object.values(TlDirection), S.tlDirection, S.tlDirection.both, 'data-tl-direction')
  const when = el('input', { class: 'field', type: 'datetime-local', 'aria-label': S.tlWhen, 'data-tl-when': '' }) as HTMLInputElement
  const summary = el('input', { class: 'field', placeholder: S.tlSummaryPh, 'aria-label': S.tlSummaryPh, maxlength: '200', autocomplete: 'off', 'data-tl-summary': '' }) as HTMLInputElement
  const save = (): void => {
    const at = when.value ? new Date(when.value).getTime() : Date.now()
    const e = cleanEntry({ at, channel: channel.value, direction: direction.value, summary: summary.value }, TlSource.Manual)
    if (!e) { summary.focus(); return }
    toast(h.add([e]) ? S.tlImported(1, 0, 0) : S.tlFull)
    summary.value = ''
    form.hidden = true
    draw()
  }
  form.append(channel, direction, when, summary,
    el('div', { class: 'tl-actions' }, [
      el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-tl-save': '', onclick: save }, [S.tlSave]),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { form.hidden = true } }, [S.tlCancel]),
    ]))

  panel.append(
    form, list,
  )
  const plus = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-tl-add': '', 'aria-label': S.tlAddAria, title: S.tlAddAria, onclick: () => {
    when.value = localInput(Date.now()); form.hidden = !form.hidden
    if (!open) { open = true; panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); draw() }
  } }, ['+'])
  const arrow = openAll ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-tl-all': '', 'aria-label': S.tlOpenAll, title: S.tlOpenAll, onclick: openAll }, ['→']) : null
  toggle.addEventListener('click', () => {
    open = !open
    panel.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    draw()
  })
  draw()
  return el('div', { class: 'person-timeline', 'data-person-timeline': '' }, [el('div', { class: 'tl-head' }, [toggle, arrow, plus]), panel])
}

/** Curate page: "Import timeline" reads a JSON file into the person (timeline.ts shape); `done` runs after the message is shown. */
export function timelineImportButton(importText: (text: string) => string, toast: (msg: string) => void, done: () => void = () => undefined): HTMLElement {
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-tl-file': '' }) as HTMLInputElement
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    if (f.size > IMPORT_MAX_BYTES) { toast(S.tlImportBig); return }
    void f.text().then((t) => { toast(importText(t)); done() }, () => toast(S.tlImportBad))
  })
  return el('div', { class: 'tl-actions' }, [
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-tl-import': '', onclick: () => file.click() }, [S.cardImportTimeline]),
    file,
  ])
}
