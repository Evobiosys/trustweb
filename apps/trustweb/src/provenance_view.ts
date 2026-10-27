/**
 * How an item's source shows (wave 1733, item 4a): a provenance tag, and for
 * an item noted in a recording, "From the meeting with <name>, <date>" as a
 * link that opens that past meeting at exactly that line.
 */
import { el } from '../../demo/src/ui/dom'
import type { ItemSource, PastMeeting } from './model'
import { Provenance } from './model'
import { deviceNote } from './provenance'
import { thisDevice } from './device_name'
import { S } from './strings'

export interface SourceViewOptions {
  /** The past meeting the source points at, if it is still stored on this phone. */
  meeting: PastMeeting | undefined
  /** Opens that meeting at the item's line. */
  open: () => void
  when: (at: number) => string
}

/** The provenance tag alone (lists, the person sheet's lines). */
export function provenanceChip(source: ItemSource | undefined): HTMLElement | null {
  if (!source) return null
  return el('span', { class: 'tagpill prov-chip prov-' + source.kind, 'data-provenance': source.kind }, [S.provLabel[source.kind]])
}

function linkLabel(source: ItemSource, m: PastMeeting, when: (at: number) => string): string {
  return source.kind === Provenance.RecordedMeeting ? S.provFromMeeting(m.about, when(m.startedAt)) : S.provFromMemo(m.about, when(m.startedAt))
}

/** The tag plus, where it applies, where exactly the item came from. */
export function sourceView(source: ItemSource | undefined, o: SourceViewOptions): HTMLElement | null {
  if (!source) return null
  const detail = (() => {
    if ((source.kind === Provenance.RecordedMeeting || source.kind === Provenance.RecordedSolo) && o.meeting) {
      return el('button', { class: 'src-link', 'data-source-link': o.meeting.id, onclick: o.open }, [linkLabel(source, o.meeting, o.when)])
    }
    if (source.kind === Provenance.RecordedMeeting || source.kind === Provenance.RecordedSolo) {
      return el('span', { class: 'src-note' }, [source.meetingId ? S.provMeetingGone : S.provNoRecording])
    }
    if (source.kind === Provenance.SharedByPerson && source.fromName) return el('span', { class: 'src-note' }, [S.provSharedBy(source.fromName)])
    return null
  })()
  const note = deviceNote(source, thisDevice())
  return el('div', { class: 'src' }, [provenanceChip(source), detail, note ? el('span', { class: 'src-note', 'data-device': source?.device ?? '' }, [note]) : null])
}
