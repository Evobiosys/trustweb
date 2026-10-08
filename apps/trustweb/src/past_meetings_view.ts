/**
 * Past meetings on screen (round 1458, extended in wave 1733): the list, one
 * meeting with its notes and transcript (opened at a line, highlighted), the
 * search panel behind the magnifier on Record and Meeting, and the recording
 * kept with it (audio_store.ts) played from any line (audio_player.ts).
 * Moved out of main.ts, which keeps thin hooks only.
 */
import { el } from '../../demo/src/ui/dom'
import { AudioStore } from './audio_store'
import type { StoredTake } from './audio_store'
import { mountPlayer } from './audio_player'
import type { PlayerHandle } from './audio_player'
import { meetingSearchPanel } from './meeting_search_view'
import { generalNoteMatches, generalNoteOf } from './general_notes'
import { lineIsCurrent, personNotes, transcriptPending } from './person_notes'
import type { Segment } from './meeting_transcriber'
import { isDemoPerson, pastMeetings } from './model'
import type { AppState, ItemSource, PastMeeting, Tag, TranscriptLine } from './model'
import type { SourceFocus } from './provenance'
import { clock } from './recorder'
import type { Recording } from './recorder'
import { isoDateLabels, SearchField } from './search'
import { S } from './strings'
import { cleanGeneralNotes } from './note_fields'
import { withDuration } from './webm_duration'

/** At most this many stored meetings; the audio of any that fall off goes with them. */
export const MEETINGS_MAX = 200

/** A line to open a past meeting at: a note, or a transcript line (highlighted and scrolled to). */
export type PastFocus = SourceFocus

/** Where the back link of an opened meeting goes (default: the list of past meetings). */
export interface PastBack {
  label: string
  go: () => void
}

export interface PastMeetingsHooks {
  state: () => AppState
  save: () => void
  sheet: HTMLElement
  openSheet: (children: (Node | null)[]) => void
  toast: (msg: string) => void
  audio: AudioStore
  personSheet: (personId: string) => void
  tagChip: (tag: Tag) => HTMLElement
  dummyChip: () => HTMLElement
  transcriptRow: (seg: Segment) => HTMLElement
  icon: (name: string) => string
  /** "00:01:05", the transcript's own clock. */
  clockLong: (ms: number) => string
  /** More lines under the transcript (wave 1733 round B: the server job, packs sent early). */
  extra?: (m: PastMeeting) => (Node | null)[]
  /** The meeting was opened (round B: a kept meeting looks for its late transcript). */
  opened?: (m: PastMeeting) => void
  /** The meeting was deleted on this phone (round B: its hosted copy goes too). */
  removed?: (m: PastMeeting) => void
}

export interface PastMeetings {
  link(): HTMLElement
  listSheet(): void
  open(m: PastMeeting, focus?: PastFocus, from?: ItemSource, back?: PastBack): void
  /** A person's card section "Notes": their note lines and past meetings per day, searchable (person_notes.ts). */
  personSection(personId: string, back: PastBack): HTMLElement
  searchView(query: string, onQuery: (q: string) => void, onClose: () => void): HTMLElement
  keepAudio(meetingId: string, recorded: readonly Recording[]): Promise<void>
  cap(list: PastMeeting[]): PastMeeting[]
  stopPlayer(): void
  transcriptView(lines: readonly TranscriptLine[], prefix: string): HTMLElement
  /** Redraws the meeting's sheet if it is the one on screen (its transcript or job changed). */
  refresh(m: PastMeeting): void
}

export function whenLabel(at: number): string {
  return new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/** How much of the General notes the list row shows (characters). */
const SNIPPET_MAX = 80

export function pastMeta(m: PastMeeting): string {
  const kind = m.fromName ? S.pastFrom(m.fromName) : m.plain === true ? S.pastKindPlain : m.meeting ? S.pastKindMeeting : m.transcript.length || m.durationMs ? S.pastKindMemo : S.pastKindNotes
  return [kind, whenLabel(m.startedAt), m.where ? S.pastWhere(m.where) : '', m.durationMs ? clock(m.durationMs) : '', S.pastCounts(m.lines.length, m.transcript.length)]
    .filter(Boolean).join(' · ')
}

/** The first words of what was typed under "General notes", for the list row (wave 5); null when there is none. */
export function generalSnippet(m: PastMeeting): HTMLElement | null {
  const general = cleanGeneralNotes(m.generalNotes)
  if (!general) return null
  const flat = general.replace(/\s+/g, ' ')
  return el('em', { class: 'pm-snip', 'data-pm-snip': '1' }, [flat.length > SNIPPET_MAX ? flat.slice(0, SNIPPET_MAX).trimEnd() + '...' : flat])
}

export function createPastMeetings(h: PastMeetingsHooks): PastMeetings {
  let player: PlayerHandle | null = null
  const sheet = h.sheet

  const stopPlayer = (): void => { player?.stop(); player = null }
  const dummyFor = (m: PastMeeting): HTMLElement | null => (m.personId && isDemoPerson(h.state(), m.personId) ? h.dummyChip() : null)
  /** Meetings this phone stored (not the entries derived from older notes): they can be deleted, and may have audio. */
  const isStored = (m: PastMeeting): boolean => (h.state().meetings ?? []).some((x) => x.id === m.id)
  const row = (m: PastMeeting, i: number): HTMLElement | null => sheet.querySelector<HTMLElement>(`.tr-static [data-seg="${CSS.escape(`${m.id}:${i}`)}"]`)

  function listSheet(): void {
    const list = pastMeetings(h.state())
    h.openSheet([
      el('h3', {}, [S.pastTitle]),
      list.length === 0 ? el('p', { class: 'meta' }, [S.pastEmpty]) : null,
      ...list.map((m) => el('button', { class: 'pm-row', onclick: () => open(m) }, [el('b', {}, [m.about, dummyFor(m)]), el('i', {}, [pastMeta(m)]), generalSnippet(m)])),
      el('p', { class: 'foot' }, [S.pastFoot]),
    ])
  }

  function transcriptView(lines: readonly TranscriptLine[], prefix: string): HTMLElement {
    return el('div', { class: 'tr-list tr-static' }, lines.map((t, i) => h.transcriptRow({ id: `${prefix}${i}`, speaker: t.speaker, text: t.text, atMs: t.atMs, final: true })))
  }

  function highlight(m: PastMeeting, f: PastFocus): void {
    const target = f.field === SearchField.Note ? sheet.querySelector<HTMLElement>(`[data-pm-note="${f.index}"]`) : row(m, f.index)
    if (!target) return
    target.classList.add('pm-hit')
    requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }))
  }

  /**
   * Where the meeting's audio is kept: the player bar above the transcript, tap
   * a line to play from it, and for an item's link "Play from this moment".
   * Without audio (older meetings, on-device speech without a recording,
   * dropped audio) nothing is added: the control is absent, not broken.
   */
  async function attachPlayer(m: PastMeeting, from?: ItemSource): Promise<void> {
    const audio = isStored(m) ? await h.audio.load(m.id) : null
    const slot = sheet.querySelector<HTMLElement>('#pm-player-slot')
    if (!audio || !audio.takes.length || !slot || sheet.dataset.meeting !== m.id || !sheet.classList.contains('on')) return
    stopPlayer()
    const p = mountPlayer(audio, { transcript: m.transcript, row: (i) => row(m, i), clock, icons: { play: h.icon('play'), pause: h.icon('pause') } })
    player = p
    m.transcript.forEach((t, i) => {
      const r = row(m, i)
      if (!r) return
      r.classList.add('playable')
      r.setAttribute('role', 'button')
      r.tabIndex = 0
      r.addEventListener('click', () => void p.playFrom(t.atMs))
      r.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void p.playFrom(t.atMs) })
    })
    const moment = from?.atMs
    const fromMoment = moment === undefined
      ? null
      : el('button', { class: 'btn btn-electric btn-sm pm-from', 'data-play-from': String(moment), onclick: () => void p.playFrom(moment) }, [S.playerFromMoment(clock(moment))])
    slot.replaceChildren(...[p.bar, fromMoment].filter((n): n is HTMLElement => n !== null))
  }

  async function remove(m: PastMeeting): Promise<void> {
    if (!confirm(S.pastDeleteConfirm)) return
    const s = h.state()
    s.meetings = (s.meetings ?? []).filter((x) => x.id !== m.id)
    h.save()
    await h.audio.remove(m.id)
    h.removed?.(m)
    h.toast(S.pastDeleted)
    listSheet()
  }

  function open(m: PastMeeting, focus?: PastFocus, from?: ItemSource, back?: PastBack): void {
    const person = m.personId ? h.state().people.find((p) => p.id === m.personId) : undefined
    const general = cleanGeneralNotes(m.generalNotes)
    h.openSheet([
      el('button', { class: 'back-link', 'data-back': back ? 'person' : 'list', onclick: back ? back.go : listSheet }, ['‹ ' + (back ? back.label : S.pastTitle)]),
      el('h3', {}, [m.about, dummyFor(m)]),
      el('p', { class: 'meta' }, [pastMeta(m)]),
      general ? el('h4', { class: 'eyebrow' }, [S.pastGeneralNotes]) : null,
      general ? el('p', { class: 'pm-general', 'data-pm-general': '1' }, [general]) : null,
      el('h4', { class: 'eyebrow' }, [S.pastNotes]),
      m.lines.length
        ? el('div', { class: 'sheet-lines' }, m.lines.map((l, i) => el('div', { class: 'sline', 'data-pm-note': String(i) }, [h.tagChip(l.tag), el('span', {}, [l.text])])))
        : el('p', { class: 'meta' }, [S.pastNoNotes]),
      el('h4', { class: 'eyebrow' }, [S.pastTranscript]),
      el('div', { id: 'pm-player-slot' }),
      m.transcript.length ? transcriptView(m.transcript, m.id + ':') : el('p', { class: 'meta' }, [S.pastNoTranscript]),
      m.late ? el('p', { class: 'meta', 'data-late': '1' }, [S.pastLateWaiting]) : null,
      ...(h.extra?.(m) ?? []),
      person ? el('button', { class: 'btn btn-ghost', onclick: () => h.personSheet(person.id) }, [S.pastOpenPerson(person.name)]) : null,
      isStored(m) ? el('button', { class: 'btn btn-ghost pm-delete', onclick: () => void remove(m) }, [S.pastDelete]) : null,
    ])
    sheet.dataset.meeting = m.id
    if (focus) highlight(m, focus)
    void attachPlayer(m, from)
    h.opened?.(m)
  }

  /** The "Notes" section of a person's card: a search field, then the days with their meetings and lines. */
  function personSection(personId: string, back: PastBack): HTMLElement {
    const person = h.state().people.find((p) => p.id === personId)
    const input = el('input', {
      class: 'field search-field person-notes-field', type: 'search', placeholder: S.personNotesPh(person?.name ?? ''),
      'aria-label': S.personNotesPh(person?.name ?? ''), autocomplete: 'off',
    })
    const list = el('div', { class: 'person-notes-list', 'aria-live': 'polite' })
    // The General note (general_notes.ts) is one more entry in this list, found by the same words; it is Only me and never leaves the phone.
    const general = (): HTMLElement[] => {
      const note = person ? generalNoteOf(person) : ''
      return note && generalNoteMatches(note, input.value)
        ? [el('div', { class: 'pn-general', 'data-pn-general': '1' }, [el('h5', { class: 'eyebrow' }, [S.personNotesGeneral]), el('p', { class: 'pm-general' }, [note])])]
        : []
    }
    const fill = (): void => {
      const days = personNotes(h.state(), personId, input.value, (m) => [whenLabel(m.startedAt), ...isoDateLabels(m.startedAt)])
      if (!days.length && !general().length) {
        list.replaceChildren(el('p', { class: 'meta', 'data-person-notes-empty': '1' }, [input.value.trim() ? S.personNotesNothing(input.value.trim()) : S.personNotesNone]))
        return
      }
      list.replaceChildren(...general(), ...days.map((d) => el('div', { class: 'pn-day', 'data-pn-day': String(d.day) }, [
        el('h5', { class: 'eyebrow' }, [new Date(d.day).toLocaleDateString([], { dateStyle: 'medium' })]),
        ...d.meetings.map((m) => el('button', { class: 'pm-row', 'data-pn-meeting': m.id, onclick: () => open(m, undefined, undefined, back) }, [
          el('b', {}, [m.about]), el('i', {}, [pastMeta(m)]), generalSnippet(m),
          transcriptPending(m) ? el('span', { class: 'pm-transcribing', 'data-pn-transcribing': m.id }, [S.pastTranscribing]) : null,
        ])),
        ...d.lines.map((l) => el('div', { class: 'sline' + (lineIsCurrent(l) ? '' : ' gone'), 'data-pn-line': l.id }, [
          h.tagChip(l.tag), el('span', {}, [l.text]), lineIsCurrent(l) ? null : el('em', {}, [S.personNotesGone]),
        ])),
      ])))
    }
    input.addEventListener('input', fill)
    fill()
    return el('div', { class: 'person-notes', 'data-person-notes': '1' }, [el('h4', { class: 'eyebrow' }, [S.personNotesTitle]), input, list])
  }

  return {
    personSection,
    link: () => el('button', { class: 'past-link', onclick: listSheet }, [S.pastLink(pastMeetings(h.state()).length)]),
    listSheet,
    open,
    searchView: (query, onQuery, onClose) => meetingSearchPanel({
      meetings: () => pastMeetings(h.state()),
      query, onQuery, onClose,
      onOpen: (m, hit) => open(m, hit && (hit.field === SearchField.Note || hit.field === SearchField.Transcript) ? { field: hit.field, index: hit.index } : undefined),
      dateLabels: (m) => [whenLabel(m.startedAt), ...isoDateLabels(m.startedAt)],
      meta: pastMeta,
      dummy: dummyFor,
      clock: h.clockLong,
    }),
    /** Keeps the draft's takes with its stored meeting (Duration written into WebM takes, so they can seek). */
    keepAudio: async (meetingId, recorded) => {
      let offset = 0
      const stored: StoredTake[] = []
      for (const t of recorded) {
        stored.push({ blob: await withDuration(t.blob, t.durationMs), mimeType: t.mimeType, offsetMs: offset, durationMs: t.durationMs })
        offset += t.durationMs
      }
      await h.audio.save(meetingId, stored).catch(() => [])
    },
    cap: (list) => {
      for (const gone of list.slice(MEETINGS_MAX)) void h.audio.remove(gone.id)
      return list.slice(0, MEETINGS_MAX)
    },
    stopPlayer,
    transcriptView,
    refresh: (m) => { if (sheet.dataset.meeting === m.id && sheet.classList.contains('on')) open(m) },
  }
}
