/**
 * A meeting another phone sent (share.ts), on this phone: opening it, keeping
 * it in past meetings, and (wave 1733 round B, item 3) a pack whose transcript
 * is still arriving: it shows what is there, looks again cheaply while it is
 * open (If-None-Match, a 304 costs no body), and once kept takes the full
 * transcript when it comes (late_pack.ts). Moved out of main.ts (thin hooks).
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import { parseKeyText, restoreIfChanged } from './backup'
import { applyLatePack, lateStillWanted, POLL_GIVE_UP_MS, pollDelay } from './late_pack'
import { AboutKind, Audience, LineStatus, Ring, Tag } from './model'
import type { AppState, PastMeeting, ReceivedShare, TranscriptLine } from './model'
import { extractLines } from './notes'
import { sharedSource } from './provenance'
import { clock } from './recorder'
import { isMeetingPack } from './share'
import type { MeetingPack, ShareLink } from './share'
import { S } from './strings'

export interface PackViewHooks {
  state: () => AppState
  save: () => void
  sheet: HTMLElement
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  render: () => void
  /** Past meetings: the transcript as it shows there, and the 200-meeting cap. */
  transcriptView: (lines: readonly TranscriptLine[], prefix: string) => HTMLElement
  cap: (list: PastMeeting[]) => PastMeeting[]
  when: (at: number) => string
  /** A kept meeting changed (its transcript arrived): redraw it where it shows. */
  onMeetingChange: (m: PastMeeting) => void
}

export interface PackView {
  open(link: ShareLink, entry?: ReceivedShare): Promise<void>
  /** At app open: kept meetings whose transcript was still arriving look for it once. */
  checkLate(): void
  /** A kept meeting is opened: look for its transcript once (no-op when complete). */
  checkOne(m: PastMeeting): void
}

/** One read of a pack: the pack, or "unchanged", or a failure. */
type PackRead = { kind: 'pack'; pack: MeetingPack; etag: string | null } | { kind: 'same' } | { kind: 'failed' }

async function readPack(keyText: string, etag: string | null): Promise<PackRead> {
  try {
    const r = await restoreIfChanged(parseKeyText(keyText), etag)
    if (!r.changed) return { kind: 'same' }
    return isMeetingPack(r.data) ? { kind: 'pack', pack: r.data, etag: r.etag } : { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}

export function createPackView(h: PackViewHooks): PackView {
  /** The open pack's polling: one at a time, tied to the sheet it belongs to. */
  let poll: { token: string; timer: ReturnType<typeof setTimeout> | undefined } | null = null
  const lateChecking = new Set<string>()

  const stopPoll = (): void => { if (poll) clearTimeout(poll.timer); poll = null }
  const stillShowing = (token: string): boolean => h.sheet.dataset.pack === token && h.sheet.classList.contains('on')

  async function open(link: ShareLink, entry?: ReceivedShare): Promise<void> {
    stopPoll()
    const msg = el('p', { class: 'meta' }, [S.recvOpening])
    h.openSheet([el('h3', {}, [link.title || S.pastTitle]), msg])
    const r = await readPack(link.keyText, null)
    if (r.kind !== 'pack') { msg.textContent = S.recvFailed; return }
    if (entry) {
      entry.openedAt = Date.now()
      if (r.pack.pending) entry.pending = true; else delete entry.pending
      h.save()
    }
    show(link, r.pack, r.etag, entry, Date.now())
  }

  /** Looks again after a while (and on "Check again"), only while this very pack is on screen. */
  function schedule(link: ShareLink, etag: string | null, entry: ReceivedShare | undefined, openedAt: number, token: string, attempt: number): void {
    if (Date.now() - openedAt > POLL_GIVE_UP_MS) return
    const timer = setTimeout(() => void check(link, etag, entry, openedAt, token, attempt, false), pollDelay(attempt))
    poll = { token, timer }
  }

  async function check(link: ShareLink, etag: string | null, entry: ReceivedShare | undefined, openedAt: number, token: string, attempt: number, byTap: boolean): Promise<void> {
    if (!stillShowing(token)) return
    const r = await readPack(link.keyText, etag)
    if (!stillShowing(token)) return
    if (r.kind === 'pack') {
      if (entry) { if (r.pack.pending) entry.pending = true; else delete entry.pending; h.save() }
      if (!r.pack.pending) h.toast(S.recvFilledIn)
      show(link, r.pack, r.etag, entry, openedAt, attempt + 1)
      return
    }
    if (byTap) h.toast(S.recvNothingNew)
    schedule(link, etag, entry, openedAt, token, attempt + 1)
  }

  function show(link: ShareLink, pack: MeetingPack, etag: string | null, entry: ReceivedShare | undefined, openedAt: number, attempt = 0): void {
    stopPoll()
    const token = randomId(8)
    const facts = [pack.about ? S.recvAbout(pack.about) : '', pack.where ? S.pastWhere(pack.where) : '', h.when(pack.startedAt), pack.durationMs ? clock(pack.durationMs) : '']
      .filter(Boolean).join(' · ')
    const pending = pack.pending === true
    h.openSheet([
      el('h3', {}, [S.recvHeading(pack.from)]),
      el('p', { class: 'meta' }, [S.recvLead(pack.from)]),
      el('p', { class: 'meta' }, [facts]),
      pending ? el('p', { class: 'warn', 'data-pack-pending': '1' }, [S.recvStillArriving]) : null,
      el('h4', { class: 'eyebrow' }, [S.pastNotes]),
      pack.notes.length
        ? el('div', { class: 'sheet-lines' }, pack.notes.map((t) => el('div', { class: 'sline' }, [el('span', {}, [t])])))
        : el('p', { class: 'meta' }, [S.pastNoNotes]),
      el('h4', { class: 'eyebrow' }, [S.pastTranscript]),
      pack.transcript.length ? h.transcriptView(pack.transcript, 'pk') : el('p', { class: 'meta' }, [S.pastNoTranscript]),
      pending ? el('button', { class: 'btn btn-ghost', 'data-pack-check': '1', onclick: () => { if (poll) clearTimeout(poll.timer); void check(link, etag, entry, openedAt, token, attempt, true) } }, [S.recvCheckAgain]) : null,
      el('button', { class: 'btn btn-electric', 'data-pack-keep': '1', onclick: () => { keep(pack, link, etag, entry); h.closeSheet(); h.toast(S.recvKept); h.render() } }, [pending ? S.recvKeepPending : S.recvKeep]),
      el('button', { class: 'btn btn-ghost', onclick: h.closeSheet }, [S.recvClose]),
    ])
    h.sheet.dataset.pack = token
    if (pending) schedule(link, etag, entry, openedAt, token, attempt)
  }

  /** Keeps a received meeting: its notes go to the sender's card (only me, like notes shared by a Meet code), the whole thing to past meetings. */
  function keep(pack: MeetingPack, link: ShareLink, etag: string | null, entry?: ReceivedShare): void {
    const s = h.state()
    const now = Date.now()
    let person = s.people.find((p) => p.name.toLowerCase() === pack.from.toLowerCase())
    if (!person) {
      person = { id: randomId(8), name: pack.from, context: S.notesReceivedContext(pack.from), ring: Ring.Acquaintance, metAt: pack.startedAt, lines: [] }
      s.people.push(person)
    }
    for (const text of pack.notes) {
      person.lines.push({ id: randomId(8), text, tag: extractLines(text)[0]?.tag ?? Tag.Note, audience: Audience.OnlyMe, status: LineStatus.Current, notedAt: now, checkedAt: now, source: sharedSource(pack.from) })
    }
    const m: PastMeeting = {
      id: randomId(8), about: person.name, kind: AboutKind.Who, personId: person.id, where: pack.where, startedAt: pack.startedAt,
      endedAt: pack.startedAt + pack.durationMs, durationMs: pack.durationMs, meeting: true,
      lines: pack.notes.map((t) => ({ text: t, tag: Tag.Note })), transcript: pack.transcript, fromName: pack.from,
      ...(pack.pending ? { late: { keyText: link.keyText, ...(etag ? { etag } : {}), since: now } } : {}),
    }
    s.meetings = h.cap([m, ...(s.meetings ?? [])])
    if (entry) entry.keptAs = m.id
    h.save()
  }

  /** One look for a kept meeting's full transcript; a link older than a week is dropped. */
  async function lookLate(m: PastMeeting): Promise<void> {
    const late = m.late
    if (!late || lateChecking.has(m.id)) return
    if (!lateStillWanted(late, Date.now())) { delete m.late; h.save(); return }
    lateChecking.add(m.id)
    try {
      const r = await readPack(late.keyText, late.etag ?? null)
      if (r.kind === 'pack' && applyLatePack(m, r.pack, r.etag)) {
        h.save()
        h.onMeetingChange(m)
      }
    } finally {
      lateChecking.delete(m.id)
    }
  }

  return {
    open,
    checkLate: () => { for (const m of h.state().meetings ?? []) if (m?.late) void lookLate(m) },
    checkOne: (m) => { if (m.late) void lookLate(m) },
  }
}
