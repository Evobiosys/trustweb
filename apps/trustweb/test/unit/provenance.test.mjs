/**
 * The chain of proof (src/provenance.ts, src/model.ts; wave 1733 item 4a):
 * lines picked from a transcript keep their moment; saved items get a source;
 * older records migrate once (typed / demo / recorded), idempotently; a source
 * opens its meeting at the right line; and NOTHING of a source reaches an asker.
 */
import { AboutKind, Audience, LineStatus, Provenance, Ring, Tag, sharedItems, threadsForRing } from '../../src/model.ts'
import { focusFor, linesFromTranscript, markDemo, migrateSources, recordedSource, transcriptIndexAt } from '../../src/provenance.ts'

const seg = (id, atMs, text, final = true) => ({ id, speaker: 1, atMs, text, final })

describe('linesFromTranscript', () => {
  it('each picked line keeps its utterance\'s offset and index', () => {
    const segs = [seg('a', 0, 'Okay we are recording now'), seg('b', 12_000, 'Anna is looking for a flat in Graz. She also has a spare ladder.'), seg('c', 30_000, 'not yet final', false)]
    const lines = linesFromTranscript(segs)
    expect(lines.map((l) => [l.text, l.atMs, l.line])).toEqual([
      ['Okay we are recording now', 0, 0],
      ['Anna is looking for a flat in Graz', 12_000, 1],
      ['She also has a spare ladder', 12_000, 1],
    ])
    expect(lines[1].tag).toBe(Tag.Looking)
  })
  it('an empty transcript gives nothing', () => expect(linesFromTranscript([])).toEqual([]))
})

describe('recordedSource', () => {
  it('meeting or memo, with the meeting and the moment when known', () => {
    expect(recordedSource(true, 'm1', { atMs: 1234.4, line: 3 })).toEqual({ kind: Provenance.RecordedMeeting, meetingId: 'm1', atMs: 1234, line: 3 })
    expect(recordedSource(false, undefined, {})).toEqual({ kind: Provenance.RecordedSolo })
  })
})

const NOW = 1_760_000_000_000
const note = (id, text, extra = {}) => ({ id, text, tag: Tag.Note, audience: Audience.FriendsOfFriends, status: LineStatus.Current, notedAt: NOW, checkedAt: NOW, ...extra })
const meetingM1 = {
  id: 'm1', about: 'Max', kind: AboutKind.Who, personId: 'max', where: 'Café', startedAt: NOW, endedAt: NOW, durationMs: 60_000, meeting: true,
  lines: [{ text: 'Knows a 3D printer', tag: Tag.Offer, atMs: 20_000, line: 2 }],
  transcript: [{ speaker: 1, atMs: 0, text: 'hello' }, { speaker: 2, atMs: 10_000, text: 'so' }, { speaker: 2, atMs: 20_000, text: 'I know a 3D printer' }, { speaker: 1, atMs: 40_000, text: 'nice' }],
}
const oldState = () => ({
  v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], notificationsOn: false,
  people: [
    { id: 'max', name: 'Max', context: 'Café', ring: Ring.Friend, metAt: NOW, lines: [note('l1', 'Knows a 3D printer'), note('l2', 'Typed by hand')] },
    { id: 'anna', name: 'Anna', context: '', ring: Ring.Friend, metAt: NOW, lines: [note('l3', 'Dummy note')] },
  ],
  inventory: [
    { id: 'i1', text: 'Motorbike', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW },
    { id: 'i2', text: 'Ladder', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW },
  ],
  demo: { people: ['anna'], inventory: ['i2'] },
  meetings: [meetingM1],
})

describe('migrateSources', () => {
  it('gives every item and note a source: recorded where a stored meeting holds it, demo for dummy, else typed', () => {
    const s = oldState()
    expect(migrateSources(s)).toBe(true)
    expect(s.people[0].lines[0].source).toEqual({ kind: Provenance.RecordedMeeting, meetingId: 'm1', atMs: 20_000, line: 2 })
    expect(s.people[0].lines[1].source).toEqual({ kind: Provenance.Typed })
    expect(s.people[1].lines[0].source).toEqual({ kind: Provenance.Demo })
    expect(s.inventory[0].source).toEqual({ kind: Provenance.Typed })
    expect(s.inventory[1].source).toEqual({ kind: Provenance.Demo })
  })
  it('is idempotent and never touches a source that is there', () => {
    const s = oldState()
    s.inventory[0].source = { kind: Provenance.Tana, ref: 'qAo6KedrMFrC' }
    migrateSources(s)
    const once = JSON.stringify(s)
    expect(migrateSources(s)).toBe(false)
    expect(JSON.stringify(s)).toBe(once)
    expect(s.inventory[0].source).toEqual({ kind: Provenance.Tana, ref: 'qAo6KedrMFrC' })
  })
  it('replaces a malformed source', () => {
    const s = oldState()
    s.inventory[0].source = { kind: 'cloud' }
    migrateSources(s)
    expect(s.inventory[0].source).toEqual({ kind: Provenance.Typed })
  })
  it('markDemo marks seeded content, leaving existing sources alone', () => {
    const people = [{ id: 'p', name: 'Sam', context: '', ring: Ring.Friend, metAt: 0, lines: [note('x', 'a')] }]
    const inv = [{ id: 'i', text: 't', audience: Audience.OnlyMe, included: true, createdAt: 0, source: { kind: Provenance.Typed } }]
    markDemo(people, inv)
    expect(people[0].lines[0].source).toEqual({ kind: Provenance.Demo })
    expect(inv[0].source).toEqual({ kind: Provenance.Typed })
  })
})

describe('focusFor / transcriptIndexAt', () => {
  it('opens at the transcript line the item was picked from', () => {
    expect(focusFor(meetingM1, { kind: Provenance.RecordedMeeting, meetingId: 'm1', line: 2, atMs: 20_000 }, 'x')).toEqual({ field: 'transcript', index: 2 })
  })
  it('a line added by hand during the take opens at what was being said at that moment', () => {
    expect(focusFor(meetingM1, { kind: Provenance.RecordedMeeting, meetingId: 'm1', atMs: 35_000 }, 'x')).toEqual({ field: 'transcript', index: 2 })
    expect(transcriptIndexAt(meetingM1.transcript, 45_000)).toBe(3)
    expect(transcriptIndexAt(meetingM1.transcript, -5)).toBe(0)
    expect(transcriptIndexAt([], 10)).toBe(-1)
  })
  it('without a moment or transcript: the note itself', () => {
    const m = { ...meetingM1, transcript: [] }
    expect(focusFor(m, { kind: Provenance.RecordedMeeting, meetingId: 'm1' }, 'Knows a 3D printer')).toEqual({ field: 'note', index: 0 })
    expect(focusFor(m, { kind: Provenance.RecordedMeeting, meetingId: 'm1' }, 'Max: Knows a 3D printer')).toEqual({ field: 'note', index: 0 })
    expect(focusFor(m, { kind: Provenance.RecordedMeeting, meetingId: 'm1' }, 'something else')).toBeNull()
  })
})

describe('what an asker receives does not change (no provenance leaks)', () => {
  const SECRETS = ['m1', 'qAo6KedrMFrC', 'recorded-meeting', 'tana', 'Shared-By-Person', 'Lukas', '20000', 'meetingId', 'source', 'atMs', 'journals/2026_07_11.md', 'haiku']
  const withSources = () => {
    const s = oldState()
    migrateSources(s)
    s.inventory[0].source = { kind: Provenance.Tana, ref: 'qAo6KedrMFrC' }
    s.people[0].lines[1].source = { kind: Provenance.SharedByPerson, fromName: 'Lukas' }
    s.people[0].lines[0].source = { kind: Provenance.Local, path: 'journals/2026_07_11.md', reader: 'haiku' }
    return s
  }
  const without = () => {
    const s = oldState()
    delete s.meetings
    return s
  }
  for (const ring of [Ring.Close, Ring.Friend, Ring.Acquaintance]) {
    it(`matcher input and answer items are identical with and without sources (${ring})`, () => {
      const a = threadsForRing(withSources(), ring)
      const b = threadsForRing(without(), ring)
      expect(JSON.stringify(a.threads)).toBe(JSON.stringify(b.threads))
      expect(JSON.stringify([...a.refs.values()])).toBe(JSON.stringify([...b.refs.values()]))
      const answer = JSON.stringify(sharedItems([...a.refs.values()]))
      expect(answer).toBe(JSON.stringify(sharedItems([...b.refs.values()])))
      for (const secret of SECRETS) expect(answer.toLowerCase()).not.toContain(secret.toLowerCase())
      for (const item of JSON.parse(answer)) expect(Object.keys(item).sort()).toEqual(['context', 'text', 'when'])
    })
  }
})
