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
import type { Segment } from './meeting_transcriber'
import { isDemoPerson, pastMeetings } from './model'
import type { AppState, ItemSource, PastMeeting, Tag, TranscriptLine } from './model'
import type { SourceFocus } from './provenance'
import { clock } from './recorder'
import type { Recording } from './recorder'
import { isoDateLabels, SearchField } from './search'
import { S } from './strings'
import { withDuration } from './webm_duration'

/** At most this many stored meetings; the audio of any that fall off goes with them. */
export const MEETINGS_MAX = 200

/** A line to open a past meeting at: a note, or a transcript line (highlighted and scrolled to). */
export type PastFocus = SourceFocus

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
}

export interface PastMeetings {
  link(): HTMLElement
  listSheet(): void
  open(m: PastMeeting, focus?: PastFocus, from?: ItemSource): void
  searchView(query: string, onQuery: (q: string) => void, onClose: () => void): HTMLElement
  keepAudio(meetingId: string, recorded: readonly Recording[]): Promise<void>
  cap(list: PastMeeting[]): PastMeeting[]
  stopPlayer(): void
  transcriptView(lines: readonly TranscriptLine[], prefix: string): HTMLElement
}

export function whenLabel(at: number): string {
  return new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function pastMeta(m: PastMeeting): string {
  const kind = m.fromName ? S.pastFrom(m.fromName) : m.meeting ? S.pastKindMeeting : m.transcript.length || m.durationMs ? S.pastKindMemo : S.pastKindNotes
  return [kind, whenLabel(m.startedAt), m.where ? S.pastWhere(m.where) : '', m.durationMs ? clock(m.durationMs) : '', S.pastCounts(m.lines.length, m.transcript.length)]
    .filter(Boolean).join(' · ')
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
      ...list.map((m) => el('button', { class: 'pm-row', onclick: () => open(m) }, [el('b', {}, [m.about, dummyFor(m)]), el('i', {}, [pastMeta(m)])])),
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
    h.toast(S.pastDeleted)
    listSheet()
  }

  function open(m: PastMeeting, focus?: PastFocus, from?: ItemSource): void {
    const person = m.personId ? h.state().people.find((p) => p.id === m.personId) : undefined
    h.openSheet([
      el('button', { class: 'back-link', onclick: listSheet }, ['‹ ' + S.pastTitle]),
      el('h3', {}, [m.about, dummyFor(m)]),
      el('p', { class: 'meta' }, [pastMeta(m)]),
      el('h4', { class: 'eyebrow' }, [S.pastNotes]),
      m.lines.length
        ? el('div', { class: 'sheet-lines' }, m.lines.map((l, i) => el('div', { class: 'sline', 'data-pm-note': String(i) }, [h.tagChip(l.tag), el('span', {}, [l.text])])))
        : el('p', { class: 'meta' }, [S.pastNoNotes]),
      el('h4', { class: 'eyebrow' }, [S.pastTranscript]),
      el('div', { id: 'pm-player-slot' }),
      m.transcript.length ? transcriptView(m.transcript, m.id + ':') : el('p', { class: 'meta' }, [S.pastNoTranscript]),
      person ? el('button', { class: 'btn btn-ghost', onclick: () => h.personSheet(person.id) }, [S.pastOpenPerson(person.name)]) : null,
      isStored(m) ? el('button', { class: 'btn btn-ghost pm-delete', onclick: () => void remove(m) }, [S.pastDelete]) : null,
    ])
    sheet.dataset.meeting = m.id
    if (focus) highlight(m, focus)
    void attachPlayer(m, from)
  }

  return {
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
  }
}
