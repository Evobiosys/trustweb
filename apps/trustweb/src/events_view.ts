/**
 * The Events screen (E1, wave 7): list, event page, add/edit form. Events and tags stay on this phone (events.ts).
 * Views are screens of their own (Screen.Events); the module keeps which one is showing.
 */
import { el } from '../../demo/src/ui/dom'
import { attendees, deleteEvent, eventMatches, eventsSorted, localSettings, newEvent, restoreEvent, splitThemes, tagLabel, tagPerson, untagPerson, whenLabel, matchPeople } from './events'
import { encodeEventLink } from './event_link'
import type { EventError, EventFields } from './events'
import type { AppState, Person, TwEvent } from './model'
import { S } from './strings'

export interface EventsViewHooks {
  state: () => AppState
  save: () => void
  header: (title: string, opts: { back: () => void }) => HTMLElement
  /** Leave the Events screen (back to Web). */
  leave: () => void
  /** Redraw the screen after a change of view. */
  redraw: () => void
  personSheet: (personId: string) => void
  avatar: (name: string, id: string) => HTMLElement
  /** A card with an Undo button. */
  undoNotice: (title: string, onUndo: () => void) => void
  newId: () => string
  /** Copies a text and says so (the app's toast, or `done` as its words). */
  copyLink: (text: string, done?: string) => void
  origin: string
}

export interface EventsView {
  /** The screen's children, for render(). */
  body: () => Node[]
  /** Show this event's page, or the list without an id (the next body() draws it). */
  open: (eventId?: string) => void
}

type View = { kind: 'list' } | { kind: 'page'; id: string } | { kind: 'form'; id?: string }

const ERRORS: Record<EventError, string> = { name: S.eventsErrName, from: S.eventsErrFrom, where: S.eventsErrWhere, to: S.eventsErrTo }

export function createEventsView(h: EventsViewHooks): EventsView {
  let view: View = { kind: 'list' }
  /** The share toggle "For the event host"; never saved, off whenever a page opens. */
  let hostLink = false
  /** Whether the Advanced disclosure stays open across redraws. */
  let advancedOpen = false
  const show = (v: View): void => { view = v; hostLink = false; advancedOpen = false; h.redraw() }
  const find = (id: string): TwEvent | undefined => h.state().events?.find((e) => e.id === id)

  function row(ev: TwEvent): HTMLElement {
    const n = attendees(h.state(), ev.id).length
    return el('button', { class: 'prow', 'data-event': ev.id, onclick: () => show({ kind: 'page', id: ev.id }) }, [
      el('span', { class: 'who' }, [el('b', {}, [ev.name]), el('i', {}, [`${whenLabel(ev)} · ${ev.where} · ${S.eventsPeople(n)}`])]),
    ])
  }

  function list(): Node[] {
    const { upcoming, past } = eventsSorted(h.state(), Date.now())
    const add = el('button', { class: 'btn btn-electric wide', 'data-event-add': '', onclick: () => show({ kind: 'form' }) }, [S.eventsAdd])
    if (!upcoming.length && !past.length) return [h.header(S.eventsTitle, { back: h.leave }), el('div', { class: 'scroll' }, [el('p', { class: 'empty' }, [S.eventsEmpty]), add])]
    const rows = el('div', {}, [])
    const draw = (q: string): void => {
      const [up, pa] = [upcoming, past].map((l) => l.filter((e) => eventMatches(e, q)))
      rows.replaceChildren(...[
        up.length ? el('h3', {}, [S.eventsUpcoming]) : null, ...up.map(row),
        pa.length ? el('h3', {}, [S.eventsPast]) : null, ...pa.map(row),
      ].filter((n): n is HTMLElement => n !== null))
    }
    draw('')
    const filter = upcoming.length + past.length > 5
      ? el('input', { class: 'field', placeholder: S.eventsFilter, 'aria-label': S.eventsFilter, 'data-event-filter': '', oninput: (e: Event) => draw((e.target as HTMLInputElement).value) })
      : null
    return [h.header(S.eventsTitle, { back: h.leave }), el('div', { class: 'scroll' }, [filter, rows, add])]
  }

  function field(label: string, input: HTMLElement): Node[] {
    return [el('label', { class: 'meta' }, [label]), input]
  }

  function form(existing?: TwEvent): Node[] {
    const text = (v = ''): HTMLInputElement => el('input', { class: 'field', value: v })
    const date = (v = ''): HTMLInputElement => el('input', { class: 'field', type: 'date', value: v })
    const name = text(existing?.name)
    const tag = text(existing?.tagName)
    const showSame = (): void => { tag.placeholder = name.value.trim() || S.eventsTagNameSame }
    name.addEventListener('input', showSame)
    showSame()
    const from = date(existing?.from)
    const to = date(existing?.to)
    const where = text(existing?.where)
    const conditions = el('textarea', { class: 'field', rows: 3 }, [existing?.conditions ?? ''])
    const themes = text(existing?.themes?.join(', '))
    const organizer = text(existing?.organizer)
    const hosts = el('div', {}, [])
    const addHost = (v = ''): void => { hosts.append(text(v)) }
    ;(existing ? existing.hosts ?? [] : [h.state().me.displayName]).forEach(addHost)
    if (!hosts.children.length) addHost()
    const error = el('p', { class: 'warn', 'data-event-error': '', hidden: true })
    const save = (): void => {
      const fields: EventFields = {
        name: name.value, from: from.value, to: to.value, where: where.value, conditions: conditions.value,
        themes: splitThemes(themes.value), organizer: organizer.value, attended: existing?.attended,
        hosts: [...hosts.querySelectorAll('input')].map((i) => i.value),
      }
      const made = newEvent(fields, existing?.id ?? h.newId(), existing?.createdAt ?? Date.now())
      if (typeof made === 'string') { error.textContent = ERRORS[made]; error.hidden = false; return }
      const ev = { ...made, ...(existing ? localSettings(existing) : {}) }
      const tagged = tag.value.trim()
      if (tagged && tagged !== made.name) { ev.tagName = tagged; ev.tagLocked = true } else { delete ev.tagName; delete ev.tagLocked }
      const s = h.state()
      s.events = [...(s.events ?? []).filter((e) => e.id !== ev.id), ev]
      h.save()
      show({ kind: 'page', id: ev.id })
    }
    const cancel = (): void => show(existing ? { kind: 'page', id: existing.id } : { kind: 'list' })
    return [h.header(existing ? S.eventsEdit : S.eventsNew, { back: cancel }), el('div', { class: 'scroll' }, [
      ...field(S.eventsName, name), ...field(S.eventsTagNameField, tag), ...field(S.eventsFrom, from), ...field(S.eventsTo, to), ...field(S.eventsWhere, where),
      ...field(S.eventsConditions, conditions), ...field(S.eventsThemes, themes), ...field(S.eventsOrganizer, organizer),
      ...field(S.eventsHost, hosts), el('button', { class: 'btn btn-ghost btn-sm', 'data-event-cohost': '', onclick: () => addHost() }, [S.eventsCoHost]),
      error,
      el('button', { class: 'btn btn-electric wide', 'data-event-save': '', onclick: save }, [S.eventsSave]),
      el('button', { class: 'btn btn-ghost wide', onclick: cancel }, [S.eventsCancel]),
    ])]
  }

  function attendeeRow(ev: TwEvent, p: Person): HTMLElement {
    return el('div', { class: 'prow', 'data-attendee': p.id }, [
      h.avatar(p.name, p.id),
      el('button', { class: 'who', onclick: () => h.personSheet(p.id) }, [el('b', {}, [p.name])]),
      el('button', {
        class: 'btn btn-ghost btn-sm', 'aria-label': S.eventsUntag(p.name),
        onclick: () => { untagPerson(h.state(), p.id, ev.id); h.save(); h.redraw() },
      }, ['×']),
    ])
  }

  function picker(ev: TwEvent): HTMLElement {
    const input = el('input', { class: 'field', placeholder: S.eventsTagSearch, 'aria-label': S.eventsTagPerson, 'data-event-tag-search': '' })
    const results = el('div', {})
    const draw = (): void => {
      const open = h.state().people.filter((p) => !p.events?.includes(ev.id))
      results.replaceChildren(...matchPeople(open, input.value).map((p) => el('button', {
        class: 'chip', 'data-tag-person': p.id,
        onclick: () => { tagPerson(h.state(), p.id, ev.id); h.save(); h.redraw() },
      }, [p.name])))
    }
    input.addEventListener('input', draw)
    draw()
    return el('div', {}, [el('h3', {}, [S.eventsTagPerson]), input, el('div', { class: 'chips' }, [results])])
  }

  function remove(ev: TwEvent): void {
    const gone = deleteEvent(h.state(), ev.id)
    if (!gone) return
    h.save()
    view = { kind: 'list' }
    h.redraw()
    h.undoNotice(S.eventsDeleted(ev.name), () => { restoreEvent(h.state(), gone); h.save(); h.redraw() })
  }

  /** Copies the link the toggle now shows; the host one says so in the toast. */
  function copyShown(ev: TwEvent): void {
    h.copyLink(encodeEventLink(ev, h.origin, hostLink ? 'host' : 'peer'), hostLink ? S.eventHostLinkCopied : undefined)
  }

  /** Switching copies the matching link at once: host link on, peer link off. */
  function hostToggle(ev: TwEvent): HTMLElement {
    return el('button', {
      class: 'chip' + (hostLink ? ' on' : ''), role: 'switch', 'aria-checked': String(hostLink), 'data-event-host-toggle': '',
      onclick: () => {
        hostLink = !hostLink
        copyShown(ev)
        h.redraw()
      },
    }, [S.eventHostLinkToggle])
  }

  /** Renaming the tag locks it against the host and copies the link now showing (host or peer) again at once with the new name. */
  function advanced(ev: TwEvent): HTMLElement {
    const name = el('input', { class: 'field', value: tagLabel(ev), 'aria-label': S.eventTagName, 'data-event-tag-name': '' })
    name.addEventListener('change', () => {
      const v = name.value.trim()
      if (!v || v === tagLabel(ev)) { name.value = tagLabel(ev); return }
      ev.tagName = v
      ev.tagLocked = true
      h.save()
      copyShown(ev)
      h.redraw()
    })
    const hostNames = el('input', { type: 'checkbox', 'data-event-host-names': '' })
    hostNames.checked = ev.hostNamesTags !== false
    hostNames.addEventListener('change', () => { ev.hostNamesTags = hostNames.checked; h.save() })
    const box = el('details', { 'data-event-advanced': '' }, [
      el('summary', {}, [S.eventAdvanced]),
      ...field(S.eventTagName, name),
      el('label', { class: 'meta' }, [hostNames, ' ', S.eventHostNamesTags]),
    ])
    box.open = advancedOpen
    box.addEventListener('toggle', () => { advancedOpen = box.open })
    return box
  }

  function page(ev: TwEvent): Node[] {
    const people = attendees(h.state(), ev.id)
    const attended = el('button', {
      class: 'chip' + (ev.attended ? ' on' : ''), role: 'switch', 'aria-checked': String(ev.attended), 'data-event-attended': '',
      onclick: () => { ev.attended = !ev.attended; h.save(); h.redraw() },
    }, [S.eventsAttended])
    return [h.header(ev.name, { back: () => show({ kind: 'list' }) }), el('div', { class: 'scroll' }, [
      el('p', {}, [el('b', {}, [whenLabel(ev)])]),
      el('p', {}, [ev.where]),
      ev.organizer ? el('p', { class: 'meta' }, [S.eventsOrganizedBy(ev.organizer)]) : null,
      ev.themes ? el('div', { class: 'chips' }, ev.themes.map((t) => el('span', { class: 'chip' }, [t]))) : null,
      ev.conditions ? el('p', {}, [ev.conditions]) : null,
      el('div', { class: 'chips' }, [attended]),
      el('button', { class: 'btn btn-ghost wide', 'data-event-share': '', onclick: () => copyShown(ev) }, [S.eventLinkShare]),
      hostToggle(ev),
      el('p', { class: 'meta' }, [S.eventLinkHint]),
      el('h3', {}, [S.eventsTagged(tagLabel(ev))]),
      people.length ? el('div', {}, people.map((p) => attendeeRow(ev, p))) : el('p', { class: 'empty' }, [S.eventsNoAttendees]),
      ev.fromLink ? el('p', { class: 'meta', 'data-event-nudge': '' }, [S.eventLinkNudge]) : null,
      picker(ev),
      advanced(ev),
      el('button', { class: 'btn btn-ghost wide', 'data-event-edit': '', onclick: () => show({ kind: 'form', id: ev.id }) }, [S.eventsEdit]),
      el('button', { class: 'btn btn-ghost wide', 'data-event-delete': '', onclick: () => remove(ev) }, [S.eventsDelete]),
    ])]
  }

  return {
    open: (id) => { view = id ? { kind: 'page', id } : { kind: 'list' } },
    body: () => {
      const ev = view.kind === 'list' ? undefined : find(view.id ?? '')
      if (view.kind === 'form') return form(ev)
      if (view.kind === 'page' && ev) return page(ev)
      view = { kind: 'list' }
      return list()
    },
  }
}
