/**
 * Searching past meetings (src/search.ts, wave 1733 item 2): person, place,
 * date, notes and transcript text; every word must be found; case and accents
 * ignored; hits carry the line with context and, for transcripts, its offset.
 */
import { AboutKind, Audience, LineStatus, Ring, Tag, pastMeetings } from '../../src/model.ts'
import { SearchField, fold, isoDateLabels, queryWords, searchMeetings } from '../../src/search.ts'

const DAY = 86_400_000
const AT = Date.UTC(2026, 9, 6, 12, 0, 0)
const meeting = {
  id: 'm1', about: 'Max', kind: AboutKind.Who, personId: 'max', where: 'Café Prückel', startedAt: AT, endedAt: AT + 60_000,
  durationMs: 60_000, meeting: true, lines: [{ text: 'Knows a 3D printer to borrow', tag: Tag.Offer }],
  transcript: [
    { speaker: 1, atMs: 0, text: 'Okay, we are recording now.' },
    { speaker: 2, atMs: 12_500, text: 'I have been thinking about the laser cutter in the basement of the Hub for a long while now, honestly.' },
  ],
}
const memo = { id: 'm2', about: 'Cargo bike', kind: AboutKind.What, where: '', startedAt: AT - DAY, endedAt: AT - DAY, durationMs: 5_000, meeting: false, lines: [], transcript: [{ speaker: 1, atMs: 3_000, text: 'The cargo bike is free on weekends.' }] }
const labels = (m) => isoDateLabels(m.startedAt)

describe('fold / queryWords', () => {
  it('drops case and accents, keeps length', () => {
    expect(fold('Café Prückel')).toBe('cafe pruckel')
    expect(fold('Öztürk').length).toBe('Öztürk'.length)
  })
  it('splits the query into words, nothing for blanks', () => {
    expect(queryWords('  Max   prückel ')).toEqual(['max', 'pruckel'])
    expect(queryWords('   ')).toEqual([])
  })
})

describe('searchMeetings', () => {
  const list = [meeting, memo]
  it('finds the person', () => expect(searchMeetings(list, 'max', labels).map((r) => r.meeting.id)).toEqual(['m1']))
  it('finds the place, accent-free', () => {
    const r = searchMeetings(list, 'pruckel', labels)
    expect(r.map((x) => x.meeting.id)).toEqual(['m1'])
    expect(r[0].hits[0]).toMatchObject({ field: SearchField.Where, before: 'Café ', match: 'Prückel', after: '' })
  })
  it('finds a date, locale-free', () => {
    expect(searchMeetings(list, '2026-10-06', labels).map((r) => r.meeting.id)).toEqual(['m1'])
    expect(searchMeetings(list, 'october', labels).map((r) => r.meeting.id)).toEqual(['m1', 'm2'])
  })
  it('finds a note', () => {
    const r = searchMeetings(list, '3d printer', labels)
    expect(r[0].hits.find((h) => h.field === SearchField.Note)).toMatchObject({ index: 0, match: '3D' })
  })
  it('finds transcript text with the line\'s offset and context around it', () => {
    const r = searchMeetings(list, 'laser cutter', labels)
    const h = r[0].hits.find((x) => x.field === SearchField.Transcript)
    expect(h).toMatchObject({ index: 1, atMs: 12_500, match: 'laser' })
    expect(h.before).toBe('I have been thinking about the ')
    expect(h.after.startsWith(' cutter in the basement')).toBe(true)
    expect(h.after.endsWith('...')).toBe(true)
  })
  it('every word must appear somewhere in the meeting', () => {
    expect(searchMeetings(list, 'max pruckel', labels).map((r) => r.meeting.id)).toEqual(['m1'])
    expect(searchMeetings(list, 'max weekends', labels)).toEqual([])
  })
  it('an empty query and an unknown word find nothing', () => {
    expect(searchMeetings(list, '  ', labels)).toEqual([])
    expect(searchMeetings(list, 'zeppelin', labels)).toEqual([])
  })
  it('works for the older notes Past meetings lists by person and day', () => {
    const lena = { id: 'lena', name: 'Lena', context: 'former colleague', ring: Ring.Friend, metAt: 0, lines: [
      { id: 'l1', text: 'Moving to Lisbon in spring', tag: Tag.Note, audience: Audience.OnlyMe, status: LineStatus.Current, notedAt: 3 * DAY, checkedAt: 3 * DAY },
    ] }
    const derived = pastMeetings({ people: [lena] })
    const r = searchMeetings(derived, 'lisbon', labels)
    expect(r.map((x) => x.meeting.id)).toEqual(['notes:lena:3'])
    expect(r[0].hits[0]).toMatchObject({ field: SearchField.Note, index: 0, match: 'Lisbon' })
  })
})
