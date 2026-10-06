/**
 * The search panel behind the magnifier on Record and Meeting (wave 1733,
 * item 2), in the same header slot where Web has its contact search. Filters
 * in place as you type (a re-render would wipe the typing); a result opens
 * that past meeting at the matching line (main.ts pastMeetingSheet).
 */
import { el } from '../../demo/src/ui/dom'
import type { PastMeeting } from './model'
import { searchMeetings, SearchField } from './search'
import type { SearchHit } from './search'
import { S } from './strings'

export interface MeetingSearchOptions {
  meetings: () => PastMeeting[]
  query: string
  onQuery: (q: string) => void
  onClose: () => void
  onOpen: (m: PastMeeting, hit: SearchHit | null) => void
  dateLabels: (m: PastMeeting) => readonly string[]
  meta: (m: PastMeeting) => string
  /** The "dummy" chip where a meeting is about demo content; null otherwise. */
  dummy: (m: PastMeeting) => HTMLElement | null
  clock: (ms: number) => string
}

function hitLabel(h: SearchHit, clock: (ms: number) => string): string {
  return h.field === SearchField.Transcript && h.atMs !== undefined ? `${S.searchField[h.field]} ${clock(h.atMs)}` : S.searchField[h.field]
}

function hitView(m: PastMeeting, h: SearchHit, o: MeetingSearchOptions): HTMLElement {
  return el('button', {
    class: 'ms-hit', 'data-hit': `${h.field}:${h.index}`, onclick: () => o.onOpen(m, h),
  }, [
    el('small', {}, [hitLabel(h, o.clock)]),
    el('span', {}, [h.before, el('mark', {}, [h.match]), h.after]),
  ])
}

function resultsView(o: MeetingSearchOptions, query: string): HTMLElement[] {
  const all = o.meetings()
  if (!all.length) return [el('p', { class: 'empty' }, [S.searchPastNone])]
  if (!query.trim()) return [el('p', { class: 'empty' }, [S.searchPastLead(all.length)])]
  const found = searchMeetings(all, query, o.dateLabels)
  if (!found.length) return [el('p', { class: 'empty' }, [S.searchPastNothing(query.trim())])]
  return found.map(({ meeting: m, hits }) => el('div', { class: 'ms-result', 'data-meeting': m.id }, [
    el('button', { class: 'pm-row', onclick: () => o.onOpen(m, null) }, [
      el('b', {}, [m.about, o.dummy(m)]),
      el('i', {}, [o.meta(m)]),
    ]),
    ...hits.filter((h) => h.field === SearchField.Note || h.field === SearchField.Transcript).map((h) => hitView(m, h, o)),
  ]))
}

/** The panel: the field, then live results. */
export function meetingSearchPanel(o: MeetingSearchOptions): HTMLElement {
  const input = el('input', {
    class: 'field search-field past-search-field', type: 'search', placeholder: S.searchPastPh, 'aria-label': S.searchPastPh,
    value: o.query, autocomplete: 'off',
  })
  const results = el('div', { id: 'past-search-results', 'aria-live': 'polite' })
  const fill = (): void => { results.replaceChildren(...resultsView(o, input.value)) }
  input.addEventListener('input', () => { o.onQuery(input.value); fill() })
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') o.onClose() })
  fill()
  return el('div', { class: 'scroll pad search past-search' }, [input, results])
}
