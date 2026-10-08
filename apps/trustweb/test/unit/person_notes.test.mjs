/**
 * Wave 6 (U4 c): the notes on one person, per day (src/person_notes.ts): every card line (also the ones no longer true) and
 * every past meeting about them, newest day first, searchable by the same words rule as the past-meetings search.
 */
import { dayOf, lineIsCurrent, meetingsAbout, personNotes } from '../../src/person_notes.ts'
import { AboutKind, LineStatus, Ring, Tag, Audience } from '../../src/model.ts'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 1, 10)
const labels = () => ['October', '2026-10']

const line = (id, text, daysAgo, status = LineStatus.Current) => ({ id, text, tag: Tag.Note, audience: Audience.Friends, status, notedAt: T0 + daysAgo * DAY, checkedAt: T0 })
const meeting = (id, about, personId, daysAgo, lines = [], where = '') => ({
  id, about, kind: AboutKind.Who, personId, where, startedAt: T0 + daysAgo * DAY, endedAt: T0 + daysAgo * DAY + 1, durationMs: 1, meeting: true, lines, transcript: [],
})

function state() {
  return {
    v: 1, me: { id: 'j', displayName: 'Jakob' }, peers: [], inventory: [], log: [], notificationsOn: false,
    people: [
      { id: 'anna', name: 'Anna Berger', context: 'Café Prückel', ring: Ring.Friend, metAt: T0, lines: [
        line('a1', 'Looking for a pickleball court', 5), line('a2', 'Moved to Graz', 2, LineStatus.Gone), line('a3', 'Plays the cello', 5),
      ] },
      { id: 'ben', name: 'Ben', context: '', ring: Ring.Friend, metAt: T0, lines: [line('b1', 'Has a ladder', 5)] },
    ],
    meetings: [
      meeting('m1', 'Anna Berger', 'anna', 5, [{ text: 'Talked about the cello', tag: Tag.Note }], 'Café Prückel'),
      meeting('m2', 'Anna Berger', 'anna', 9),
      meeting('m3', 'Ben', 'ben', 5),
    ],
  }
}

describe('personNotes', () => {
  it('lists the days newest first, a meeting and the card lines of a day together, only this person', () => {
    const days = personNotes(state(), 'anna', '', labels)
    expect(days.map((d) => d.day)).toEqual([dayOf(T0 + 9 * DAY), dayOf(T0 + 5 * DAY), dayOf(T0 + 2 * DAY)])
    const fifth = days[1]
    expect(fifth.meetings.map((m) => m.id)).toEqual(['m1'])
    expect(fifth.lines.map((l) => l.id)).toEqual(['a1', 'a3'])
    expect(days[2].lines.map((l) => l.id)).toEqual(['a2'])
    expect(JSON.stringify(days)).not.toContain('Has a ladder')
  })

  it('a line that is no longer true stays listed, flagged', () => {
    const gone = personNotes(state(), 'anna', '', labels).flatMap((d) => d.lines).find((l) => l.id === 'a2')
    expect(lineIsCurrent(gone)).toBe(false)
    expect(lineIsCurrent(personNotes(state(), 'anna', '', labels)[1].lines[0])).toBe(true)
  })

  it('search: every word must appear; case, accents and the place count; lines and meetings are filtered alike', () => {
    expect(personNotes(state(), 'anna', 'pickleball', labels).flatMap((d) => d.lines.map((l) => l.id))).toEqual(['a1'])
    expect(personNotes(state(), 'anna', 'PRUCKEL cello', labels).flatMap((d) => d.meetings.map((m) => m.id))).toEqual(['m1'])
    expect(personNotes(state(), 'anna', 'cello', labels).flatMap((d) => d.lines.map((l) => l.id))).toEqual(['a3'])
    expect(personNotes(state(), 'anna', 'graz', labels).length).toBe(1)
    expect(personNotes(state(), 'anna', 'zeppelin', labels)).toEqual([])
    // (the third is the entry pastMeetings() derives for the day of the line that is no longer true)
    expect(personNotes(state(), 'anna', 'october', labels).flatMap((d) => d.meetings.map((m) => m.id))).toEqual(['m2', 'm1', `notes:anna:${Math.floor((T0 + 2 * DAY) / DAY)}`])
  })

  it('older notes without a stored meeting are listed as the meeting of their day (pastMeetings derives it)', () => {
    const s = state()
    s.meetings = []
    const days = personNotes(s, 'anna', '', labels)
    expect(days.flatMap((d) => d.meetings).every((m) => m.id.startsWith('notes:anna:'))).toBe(true)
    expect(meetingsAbout(s, 'ben').length).toBe(1)
  })

  it('an unknown person gives nothing', () => {
    expect(personNotes(state(), 'nobody', '', labels)).toEqual([])
  })
})
