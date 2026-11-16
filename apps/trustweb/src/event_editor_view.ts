// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 event-editor: the calendar-style "New event" / edit view (Jakob items 10-12, reference shot 08). Rows, top to bottom: event name;
 * starts - until, full day, does it repeat; Add guests (co-host switch at the right of each guest, the creator first: 43-D7); location with the
 * conference links at its right; description or kDrive attachment; the calendar (once I have calendars of my own); everything else under
 * "Show more features" (core time included, item 10). No reminder. Leaving with changes asks: Save draft / Discard / Keep editing.
 * The working fields live in this closure, so a redraw (or a trip to another tab) never loses what was typed.
 */
import { el } from '../../demo/src/ui/dom'
import { loadColourTags } from './colour_tags'
import { listCommunities, parseCommunity } from './ext/community-mighty/community_data'
import { CONFERENCE_PROVIDERS, REPEATS, calendarsOf, connectedProviders, dropDraft, emptyFields, isDirty, rememberRooms, saveDraft } from './event_draft'
import type { ConferenceProvider, EditorFields, EventDraft, Repeat } from './event_draft'
import { eventFromFields, fieldsOf, groupRows } from './event_editor'
import type { EditorError } from './event_editor'
import { eventAssistantRow } from './event_assistant_row'
import { eventPersonPicker } from './event_person_picker'
import { moreFeatures } from './more_features'
import { mayApprove, roleLabels, sameName } from './event_roles'
import { todayIso } from './events'
import { createPerson } from './tag_create'
import type { AppState, TwEvent } from './model'
import { S } from './strings'

export interface EditorHooks {
  state: () => AppState
  save: () => void
  header: (title: string, opts: { back?: () => void }) => HTMLElement
  redraw: () => void
  newId: () => string
}

export type EditorFocus = 'name' | 'where' | 'conditions' | 'themes' | 'organizer'

export interface EditorOpen {
  existing?: TwEvent
  draft?: EventDraft
  presetFrom?: string
  /** Wave 44 steer-ask-placement: a new event opened from a community starts in it. */
  presetCommunity?: string
  focus?: EditorFocus
  /** Saved: show the event. */
  done: (eventId: string) => void
  /** Left without saving (after the draft question, when there were changes). */
  leave: () => void
}

const ERRORS: Record<EditorError, string> = { name: S.eventsErrName, from: S.eventsErrFrom, to: S.eventsErrTo, core: S.eventsErrCore, link: S.ev44.errLink, window: S.w44os.errWindow }
const IN_MORE: readonly EditorFocus[] = ['conditions', 'themes', 'organizer']

export function createEventEditor(h: EditorHooks, o: EditorOpen): { body: () => Node[] } {
  const me = (): string => h.state().me.displayName
  const f: EditorFields = o.draft ? structuredClone(o.draft.fields) : o.existing ? fieldsOf(h.state(), o.existing) : emptyFields(o.presetFrom ?? todayIso(new Date()), me())
  if (!o.existing && !o.draft && o.presetCommunity) f.communityId = o.presetCommunity
  /** What opened (the draft, the event, or the empty form): leaving unchanged asks nothing. */
  const start: EditorFields = structuredClone(f)
  const eventId = o.existing?.id ?? o.draft?.eventId ?? h.newId()
  let draftId = o.draft?.id
  let moreOpen = !!o.focus && IN_MORE.includes(o.focus)
  let confOpen = f.conference.length > 0
  let focusNext: string | undefined = o.focus ? `[data-editor-${o.focus}]` : undefined
  let error: EditorError | undefined
  /** 43-D7: technical support sees the guests but changes them only once a host lets them take over. A new event is mine. */
  const canApprove = (): boolean => !o.existing || mayApprove(o.existing, me(), h.state().people)

  const redraw = (refocus?: string): void => { focusNext = refocus; h.redraw() }
  const label = (ref: string): string => roleLabels(h.state(), [ref])[0]
  const optional = (node: HTMLElement): HTMLElement => { node.classList.add('opt-min'); return node }

  const text = (key: 'name' | 'where' | 'tagName' | 'themes' | 'attachment', attrs: Record<string, string>): HTMLInputElement => {
    const input = el('input', { class: 'field', value: f[key], ...attrs }) as HTMLInputElement
    input.addEventListener('input', () => { f[key] = input.value })
    return input
  }
  const area = (key: 'description' | 'conditions', attrs: Record<string, string>): HTMLTextAreaElement => {
    const t = el('textarea', { class: 'field', rows: '2', ...attrs }, [f[key]]) as HTMLTextAreaElement
    t.addEventListener('input', () => { f[key] = t.value })
    return t
  }
  const chip = (on: boolean, text_: string, attrs: Record<string, string>, onclick: () => void, disabled = false): HTMLElement =>
    el('button', { class: 'chip' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), ...attrs, ...(disabled ? { disabled: '' } : {}), onclick }, [text_])

  /** Wave 44 steer-open-space: the type of the event. An open space has a day with a start and an end time; it stays one once it holds activities. */
  function typeRow(): HTMLElement {
    const locked = !!o.existing?.openSpace?.acts.length
    const set = (open: boolean): void => {
      f.openSpace = open
      if (open) {   // the window needs times: a full-day event gets 09:00 to 17:00
        if (f.from.length <= 10) f.from = `${f.from}T09:00`
        if (f.to.length <= 10) f.to = `${f.to || f.from.slice(0, 10)}T17:00`
      }
      redraw()
    }
    return el('div', { class: 'ev-row', 'data-editor-type-row': '' }, [
      el('div', { class: 'chips', role: 'group', 'aria-label': S.w44os.typeLabel }, [
        chip(!f.openSpace, S.w44os.typeEvent, { 'data-editor-type': 'event' }, () => set(false), locked),
        chip(!!f.openSpace, S.w44os.typeOpenSpace, { 'data-editor-type': 'open-space' }, () => set(true)),
      ]),
      el('p', { class: 'meta opt-min' }, [locked ? S.w44os.typeLocked : f.openSpace ? S.w44os.typeHint : '']),
    ])
  }

  function timeRow(): HTMLElement {
    const allDay = f.from.length <= 10
    const date = (key: 'from' | 'to', aria: string): HTMLInputElement => {
      const input = el('input', { class: 'field', type: allDay ? 'date' : 'datetime-local', value: f[key], 'aria-label': aria, [`data-editor-${key}`]: '' }) as HTMLInputElement
      input.addEventListener('input', () => { f[key] = input.value })
      return input
    }
    const repeat = el('select', { class: 'field', 'aria-label': S.ev44.repeatLabel, 'data-editor-repeat': '' }, REPEATS.map((r) => el('option', { value: r, ...(r === f.repeat ? { selected: '' } : {}) }, [S.ev44.repeat[r]]))) as HTMLSelectElement
    repeat.addEventListener('change', () => { f.repeat = repeat.value as Repeat })
    const flip = (): void => {
      const conv = (v: string): string => (!v ? v : allDay ? `${v.slice(0, 10)}T09:00` : v.slice(0, 10))
      f.from = conv(f.from); f.to = conv(f.to)
      redraw()
    }
    return el('div', { class: 'ev-row ev-time', 'data-editor-row': 'time' }, [
      el('div', { class: 'ev-span' }, [date('from', S.ev44.starts), el('span', { 'aria-hidden': 'true' }, ['–']), date('to', S.ev44.until)]),
      el('div', { class: 'ev-span' }, [...(f.openSpace ? [] : [chip(allDay, S.ev44.fullDay, { 'data-editor-fullday': '' }, flip)]), repeat]),
    ])
  }

  function guestRow(ref: string, cohost: boolean): HTMLElement {
    const ok = canApprove()
    const toggle = (): void => {
      if (cohost) { f.cohosts = f.cohosts.filter((r) => r !== ref); if (h.state().people.some((p) => p.id === ref) && !f.guests.includes(ref)) f.guests.push(ref) } else { f.cohosts.push(ref); f.guests = f.guests.filter((r) => r !== ref) }
      redraw()
    }
    const remove = (): void => { f.cohosts = f.cohosts.filter((r) => r !== ref); f.guests = f.guests.filter((r) => r !== ref); redraw() }
    return el('div', { class: 'prow ev-guest', 'data-editor-guest': ref }, [
      el('span', { class: 'who' }, [el('b', {}, [label(ref)])]),
      chip(cohost, S.ev44.cohost, { 'data-editor-cohost': ref }, toggle, !ok),
      ok ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': S.ev44.remove(label(ref)), 'data-editor-guest-remove': ref, onclick: remove }, ['×']) : null,
    ])
  }

  /** 43-D7: the creator first, a co-host by default; "Technical support only" makes me see without approving. */
  function meRow(): HTMLElement {
    const tech = f.meRole === 'tech'
    const ok = canApprove()
    return el('div', { class: 'prow ev-guest', 'data-editor-me': f.meRole }, [
      el('span', { class: 'who' }, [el('b', {}, [me()]), ' ', el('i', { class: 'meta' }, [S.ev44.you])]),
      chip(!tech, S.ev44.cohost, { 'data-editor-me-cohost': '' }, () => { f.meRole = 'cohost'; redraw() }, !ok),
      chip(tech, S.ev44.techOnly, { 'data-editor-me-tech': '' }, () => { f.meRole = tech ? 'cohost' : 'tech'; redraw() }, !ok),
    ])
  }

  /** The shared picker (event_person_picker.ts) with @ / # (item 11). */
  function picker(chosen: string[], attr: string, aria: string, add: (ids: string[]) => void, create: (name: string) => void): HTMLElement {
    return eventPersonPicker(h, eventId, {
      exclude: chosen, quietWhenEmpty: true, placeholder: S.ev44.guestsPh, ariaLabel: aria, inputAttr: attr, personAttr: `${attr}-pick`,
      tags: loadColourTags, onPickMany: (ids) => { add(ids); redraw(`[${attr}]`) },
      onPick: (id) => { add([id]); redraw(`[${attr}]`) },
      onCreate: (name) => { create(name); redraw(`[${attr}]`) },
    })
  }

  function guestsRow(): HTMLElement {
    const mine = (r: string): boolean => sameName(label(r), me())
    const ok = canApprove()
    const all = [...f.cohosts.filter((r) => !mine(r)), ...f.guests]
    const add = (ids: string[]): void => { for (const id of ids) if (!all.includes(id)) f.guests.push(id) }
    const create = (name: string): void => { const p = createPerson(h.state().people, name, h.newId(), Date.now()); h.save(); f.guests.push(p.id) }
    return el('div', { class: 'ev-row', 'data-editor-row': 'guests' }, [
      el('label', { class: 'meta' }, [S.ev44.guests]),
      meRow(),
      ...f.cohosts.filter((r) => !mine(r)).map((r) => guestRow(r, true)),
      ...f.guests.map((r) => guestRow(r, false)),
      ok ? picker(all, 'data-editor-guests', S.ev44.guests, add, create) : el('p', { class: 'meta', 'data-editor-tech-sees': '' }, [S.ev44.techSees]),
    ])
  }

  function locationRow(): HTMLElement {
    const connected = connectedProviders(h.state())
    const rooms = h.state().calendars?.rooms ?? {}
    const has = (p: ConferenceProvider): boolean => f.conference.some((c) => c.provider === p)
    const flip = (p: ConferenceProvider): void => {
      f.conference = has(p) ? f.conference.filter((c) => c.provider !== p) : [...f.conference, { provider: p, url: rooms[p] ?? '' }]
      redraw(has(p) ? `[data-editor-conf-url="${p}"]` : undefined)
    }
    const urls = f.conference.map((c) => {
      const input = el('input', { class: 'field', type: 'url', value: c.url, placeholder: S.ev44.roomPh(S.ev44.providers[c.provider]), 'aria-label': S.ev44.roomPh(S.ev44.providers[c.provider]), 'data-editor-conf-url': c.provider }) as HTMLInputElement
      input.addEventListener('input', () => { c.url = input.value })
      return input
    })
    const confToggle = el('button', { class: 'btn btn-ghost btn-sm ev-conf-btn', type: 'button', 'aria-expanded': String(confOpen), 'data-editor-conference-toggle': '', onclick: () => { confOpen = !confOpen; redraw() } }, [S.ev44.conference + (f.conference.length ? ` (${f.conference.length})` : '') + (confOpen ? ' ▴' : ' ▾')])
    return el('div', { class: 'ev-row', 'data-editor-row': 'location' }, [
      el('div', { class: 'ev-loc' }, [text('where', { placeholder: S.ev44.where, 'aria-label': S.ev44.where, 'data-editor-where': '' }), confToggle]),
      confOpen ? el('div', { class: 'chips', 'data-editor-conf-list': '' }, CONFERENCE_PROVIDERS.map((p) => {
        const c = chip(has(p), S.ev44.providers[p], { 'data-editor-conf': p, 'data-connected': String(connected.includes(p)) }, () => flip(p))
        return connected.includes(p) || has(p) ? c : optional(c)
      })) : null,
      confOpen && !connected.length ? el('p', { class: 'meta opt-min' }, [S.ev44.notConnected]) : null,
      ...urls,
    ])
  }

  function descriptionRow(): HTMLElement {
    return el('div', { class: 'ev-row', 'data-editor-row': 'description' }, [
      area('description', { placeholder: S.ev44.description, 'aria-label': S.ev44.description, 'data-editor-description': '' }),
      optional(text('attachment', { type: 'url', placeholder: S.ev44.attachmentPh, 'aria-label': S.ev44.attachmentPh, 'data-editor-attachment': '' })),
    ])
  }

  /** Item 12: once there are calendars of my own, the calendar choice sits here. */
  function calendarRow(): HTMLElement | null {
    const cals = calendarsOf(h.state()).filter((c) => c.id !== 'shared')
    if (cals.length < 2) return null
    const pick = el('select', { class: 'field', 'aria-label': S.ev44.calendar, 'data-editor-calendar': '' }, cals.map((c) => el('option', { value: c.id, ...(c.id === f.calendar ? { selected: '' } : {}) }, [S.ev44.calNames[c.id] ?? c.name]))) as HTMLSelectElement
    pick.addEventListener('change', () => { f.calendar = pick.value })
    return el('div', { class: 'ev-row', 'data-editor-row': 'calendar' }, [el('label', { class: 'meta' }, [S.ev44.calendar]), pick])
  }

  function rolePicker(key: 'organizers' | 'techSupport', title: string, attr: string): HTMLElement {
    const add = (ids: string[]): void => { for (const id of ids) if (!f[key].includes(id)) f[key].push(id) }
    return el('div', { 'data-editor-role': key }, [
      el('label', { class: 'meta' }, [title]),
      f[key].length ? el('div', { class: 'role-chips' }, f[key].map((ref) => el('span', { class: 'chip' }, [label(ref), ' ', el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': S.ev44.remove(label(ref)), onclick: () => { f[key] = f[key].filter((r) => r !== ref); redraw() } }, ['×'])]))) : null,
      // A name nobody carries stays a free name (as the old organizer field did), no new card.
      picker(f[key], attr, title, add, (name) => add([name.trim()])),
    ])
  }

  /** Item 11: "Part of a community" as a minuscule optional box; Family sits under Other groups, never under Communities. */
  function groupPick(): HTMLElement {
    const st = h.state()
    const rows = listCommunities(parseCommunity(st.extData?.['community-mighty']), loadColourTags(), st.people)
    const { communities, others } = groupRows(rows)
    const known = f.communityId && !rows.some((r) => r.id === f.communityId) ? [{ id: f.communityId, name: f.communityId }] : []
    const opt = (r: { id: string; name: string }): HTMLElement => el('option', { value: r.id, ...(r.id === f.communityId ? { selected: '' } : {}) }, [r.name])
    const pick = el('select', { class: 'field opt-min', 'aria-label': S.ev44.group, 'data-event-community': '' }, [
      el('option', { value: '' }, [S.w43answers.communityNone]),
      communities.length || known.length ? el('optgroup', { label: S.ev44.groupCommunities }, [...communities, ...known].map(opt)) : null,
      others.length ? el('optgroup', { label: S.ev44.groupOthers, 'data-editor-other-groups': '' }, others.map(opt)) : null,
    ]) as HTMLSelectElement
    pick.addEventListener('change', () => { f.communityId = pick.value })
    return el('div', {}, [el('label', { class: 'meta opt-min' }, [S.ev44.group]), pick])
  }

  function more(): HTMLElement {
    const date = (key: 'coreFrom' | 'coreTo', aria: string): HTMLInputElement => {
      const input = el('input', { class: 'field', type: 'date', value: f[key], 'aria-label': aria, [`data-editor-${key}`]: '' }) as HTMLInputElement
      input.addEventListener('input', () => { f[key] = input.value })
      return input
    }
    const host = canApprove() && f.meRole === 'cohost'
    return moreFeatures({ open: moreOpen, onToggle: (v) => { moreOpen = v }, attr: 'data-editor-more' }, [
      el('label', { class: 'meta' }, [S.eventsTagNameField]), text('tagName', { placeholder: f.name || S.eventsTagNameSame, 'aria-label': S.eventsTagNameField, 'data-editor-tagname': '' }),
      el('label', { class: 'meta' }, [S.eventsCoreFrom]), date('coreFrom', S.eventsCoreFrom), el('label', { class: 'meta' }, [S.eventsCoreTo]), date('coreTo', S.eventsCoreTo),
      el('label', { class: 'meta' }, [S.eventsConditions]), area('conditions', { 'aria-label': S.eventsConditions, 'data-editor-conditions': '' }),
      el('label', { class: 'meta' }, [S.eventsThemes]), text('themes', { 'aria-label': S.eventsThemes, 'data-editor-themes': '' }),
      rolePicker('organizers', S.ev44.organizers, 'data-editor-organizer'),
      rolePicker('techSupport', S.eventsRoleTech, 'data-editor-tech'),
      host && (f.techSupport.length || f.techTakeover) ? el('div', { 'data-editor-takeover': String(f.techTakeover) }, [
        chip(f.techTakeover, S.ev44.takeover, { 'data-editor-takeover-toggle': '' }, () => { f.techTakeover = !f.techTakeover; redraw() }),
        el('p', { class: 'meta' }, [S.ev44.takeoverHint]),
      ]) : null,
      host ? el('div', { 'data-editor-show-all': String(!!f.showAll) }, [
        chip(!!f.showAll, S.w44os.showAll, { 'data-editor-show-all-toggle': '' }, () => { f.showAll = !f.showAll; redraw() }),
        el('p', { class: 'meta' }, [S.w44os.showAllHint]),
      ]) : null,
      groupPick(),
    ])
  }

  function closeDialog(box: HTMLElement): void { box.remove() }

  /** Item 11: leaving with changes asks first; the draft waits in Events with a Draft pill. */
  function askDraft(): void {
    document.querySelector('[data-draft-dialog]')?.remove()
    const box = el('div', { class: 'wt-modal ev-draft-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ev-draft-title', 'data-draft-dialog': '' }, [
      el('div', { class: 'ev-draft-card' }, [
        el('h3', { id: 'ev-draft-title' }, [S.ev44.draftTitle]),
        el('p', {}, [S.ev44.draftBody]),
        el('button', { class: 'btn btn-electric wide', type: 'button', 'data-draft-save': '', onclick: () => {
          draftId = saveDraft(h.state(), f, Date.now(), draftId ?? h.newId(), o.existing?.id)
          h.save(); closeDialog(box); o.leave()
        } }, [S.ev44.draftSave]),
        el('button', { class: 'btn btn-ghost wide', type: 'button', 'data-draft-discard': '', onclick: () => { closeDialog(box); o.leave() } }, [S.ev44.draftDiscard]),
        el('button', { class: 'btn btn-ghost wide', type: 'button', 'data-draft-keep': '', onclick: () => closeDialog(box) }, [S.ev44.draftKeep]),
      ]),
    ])
    document.body.append(box)
    box.querySelector<HTMLButtonElement>('[data-draft-save]')?.focus()
  }

  const tryLeave = (): void => { if (isDirty(start, f)) askDraft(); else o.leave() }

  function save(): void {
    const s = h.state()
    const made = eventFromFields(s, f, { id: eventId, now: Date.now(), ...(o.existing ? { existing: o.existing } : {}) })
    if (typeof made === 'string') { error = made; redraw(); return }
    rememberRooms(s, made.conference ?? [])
    s.events = [...(s.events ?? []).filter((e) => e.id !== made.id), made]
    if (draftId) dropDraft(s, draftId)
    h.save()
    o.done(made.id)
  }

  return {
    body: () => {
      const view = [h.header(o.existing ? S.eventsEdit : S.eventsNew, { back: tryLeave }), el('div', { class: 'scroll ev-editor', 'data-event-editor': '' }, [
        el('div', { class: 'ev-row', 'data-editor-row': 'name' }, [
          text('name', { class: 'field ev-name', placeholder: S.ev44.namePh, 'aria-label': S.ev44.namePh, 'data-editor-name': '' }),
          el('p', { class: 'meta opt-min' }, [S.ev44.nameCaption]),
        ]),
        typeRow(),
        timeRow(),
        guestsRow(),
        locationRow(),
        descriptionRow(),
        eventAssistantRow(f),
        calendarRow(),
        el('div', { 'data-editor-row': 'more' }, [more()]),
        error ? el('p', { class: 'warn', 'data-event-error': '' }, [ERRORS[error]]) : null,
        el('button', { class: 'btn btn-electric wide', type: 'button', 'data-event-save': '', onclick: save }, [S.eventsSave]),
        el('button', { class: 'btn btn-ghost wide', type: 'button', 'data-event-cancel': '', onclick: tryLeave }, [S.eventsCancel]),
      ])]
      const sel = focusNext
      focusNext = undefined
      if (sel) setTimeout(() => document.querySelector<HTMLElement>(sel)?.focus())
      return view
    },
  }
}
