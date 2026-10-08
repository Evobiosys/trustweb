/**
 * Wave 6 (U4 b): notes as a source for asks through me (src/notes_source.ts), through askSources and the real
 * matcher (net.ts matchAsk): the audience rules, "Only me" never, the card line governs its meeting copy, step 0
 * only, demo scope, the setting and its defaults, and what an answer carries.
 */
import { askSources } from '../../src/cascade.ts'
import { matchAsk } from '../../src/net.ts'
import { Audience, LineStatus, Ring, Tag, demoAccountScope, sharedItems, threadIsDemo } from '../../src/model.ts'
import { MEETING_NOTE_CONTEXT, MEETING_THREAD_PREFIX, asksMatchNotes, meetingNoteThreads, notesMatchDefault } from '../../src/notes_source.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 8)

const meeting = (id, lines, extra = {}) => ({
  id, about: 'Anna Berger', kind: 'who', where: 'Café Prückel', startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY + 1000, durationMs: 1000,
  meeting: true, lines, transcript: [{ speaker: 'A', atMs: 0, text: 'transcript words about a pickleball court' }], ...extra,
})
const nline = (text, audience, extra = {}) => ({ text, tag: Tag.Note, audience, ...extra })

function record(meetings, extra = {}) {
  return { v: 1, me: { id: 'jak', displayName: 'Jakob' }, peers: [], people: [], inventory: [], log: [], notificationsOn: false, meetings, ...extra }
}

const hits = (s, ring, hop, ask, scope) => {
  const { threads, refs } = askSources(s, ring, hop, scope)
  return matchAsk(ask, threads).hits.map((h) => refs.get(h.threadId))
}

describe('the setting and its defaults', () => {
  it('on for a personal account, off for a demo account and for a record with demo content; the choice wins', () => {
    expect(notesMatchDefault({})).toBe(true)
    expect(notesMatchDefault({ testOf: { name: 'Jakob', createdAt: 1 } })).toBe(false)
    expect(notesMatchDefault({ demo: { people: [], inventory: [] } })).toBe(false)
    expect(asksMatchNotes({})).toBe(true)
    expect(asksMatchNotes({ asksMatchNotes: false })).toBe(false)
    expect(asksMatchNotes({ asksMatchNotes: true, demo: { people: [], inventory: [] } })).toBe(true)
    expect(asksMatchNotes({ asksMatchNotes: 'yes' })).toBe(true) // a malformed value reads as the default, never as a choice
  })
})

describe('what a meeting note answers', () => {
  const ASK = 'Do you know a good pickleball court?'
  const FRIENDS = nline('Pickleball court behind the old tram depot, bookable online', Audience.Friends)

  it('a Friends note answers a friend, not an acquaintance', () => {
    const s = record([meeting('m1', [FRIENDS])])
    expect(hits(s, Ring.Friend, 0, ASK).map((h) => h.text)).toEqual([FRIENDS.text])
    expect(hits(s, Ring.Close, 0, ASK).length).toBe(1)
    expect(hits(s, Ring.Acquaintance, 0, ASK)).toEqual([])
    expect(hits(s, Ring.Intending, 0, ASK)).toEqual([])
  })

  it('"Only me" never answers, and a line with no audience recorded (older records) does not either', () => {
    const s = record([meeting('m1', [nline('Pickleball court at the lake', Audience.OnlyMe), { text: 'Pickleball court from before audiences', tag: Tag.Note }])])
    expect(hits(s, Ring.Close, 0, ASK)).toEqual([])
    expect(hits(s, Ring.Friend, 0, ASK)).toEqual([])
  })

  it('it answers at step 0 only (like the notes about people): never an ask that reached me through somebody', () => {
    const s = record([meeting('m1', [nline('Pickleball court for everybody', Audience.FriendsOfFriends)])])
    expect(hits(s, Ring.Friend, 0, ASK).length).toBe(1)
    expect(hits(s, Ring.Friend, 1, ASK)).toEqual([])
    expect(hits(s, Ring.Close, 2, ASK)).toEqual([])
  })

  it('the setting off, or an ask scoped to demo content: no meeting note takes part', () => {
    const lines = [nline('Pickleball court for everybody', Audience.FriendsOfFriends)]
    expect(hits(record([meeting('m1', lines)], { asksMatchNotes: false }), Ring.Friend, 0, ASK)).toEqual([])
    expect(hits(record([meeting('m1', lines)], { testOf: { name: 'X', createdAt: 1 } }), Ring.Friend, 0, ASK)).toEqual([])
    const demo = record([meeting('m1', lines)], { demo: { people: [], inventory: [] }, asksMatchNotes: true })
    expect(hits(demo, Ring.Friend, 0, ASK, demoAccountScope(demo))).toEqual([])
    expect(hits(demo, Ring.Friend, 0, ASK).length).toBe(1)
  })

  it('a copy of a card line is left to the card: its audience governs, retired or narrowed or not', () => {
    const copy = nline('Pickleball court behind the depot', Audience.Friends)
    const card = (audience, status = LineStatus.Current) => ({
      id: 'p1', name: 'Anna Berger', context: '', ring: Ring.Friend, metAt: NOW, peerId: undefined,
      lines: [{ id: 'l1', text: 'Pickleball court behind the depot', tag: Tag.Note, audience, status, notedAt: NOW, checkedAt: NOW }],
    })
    const withCard = (audience, status) => record([meeting('m1', [copy])], { people: [card(audience, status)] })
    // the card line says Friends: one hit (the card's), never two
    expect(hits(withCard(Audience.Friends), Ring.Friend, 0, ASK).map((h) => h.threadId.startsWith('note:'))).toEqual([true])
    // the person narrowed the card line to Only me, or retired it: the meeting copy stays silent too
    expect(hits(withCard(Audience.OnlyMe), Ring.Friend, 0, ASK)).toEqual([])
    expect(hits(withCard(Audience.Friends, LineStatus.Gone), Ring.Friend, 0, ASK)).toEqual([])
    // a copy of an inventory item or one of its context notes is left to the item
    const item = { id: 'i1', text: 'Pickleball court behind the depot', audience: Audience.OnlyMe, included: true, createdAt: NOW }
    expect(hits(record([meeting('m1', [copy])], { inventory: [item] }), Ring.Friend, 0, ASK)).toEqual([])
  })

  it('the same note in two meetings answers once', () => {
    const s = record([meeting('m1', [FRIENDS]), meeting('m2', [{ ...FRIENDS }])])
    expect(meetingNoteThreads(s, Ring.Friend, 0).threads.length).toBe(1)
  })

  it('never the transcript, never the raw General notes, never the place or the person', () => {
    const s = record([meeting('m1', [nline('Something else entirely', Audience.FriendsOfFriends)], { generalNotes: 'Private pickleball thoughts about Anna' })])
    expect(hits(s, Ring.Close, 0, ASK)).toEqual([])
    expect(hits(s, Ring.Close, 0, 'pickleball court')).toEqual([])
  })

  it('what an answer carries: the line, a coarse date, a context without a name or a place', () => {
    const s = record([meeting('m1', [FRIENDS])])
    const refs = hits(s, Ring.Friend, 0, ASK)
    const out = sharedItems(refs)
    expect(Object.keys(out[0]).sort()).toEqual(['context', 'text', 'when'])
    expect(out[0].context).toBe(MEETING_NOTE_CONTEXT)
    expect(JSON.stringify(out)).not.toMatch(/Anna|Prückel|Berger|transcript/)
    expect(out[0].when).toBe('early October')
  })

  it('the forgiving matcher reads meeting notes too (a typo, apart or together)', () => {
    const s = record([meeting('m1', [nline('Pickle ball court behind the depot', Audience.FriendsOfFriends)])])
    expect(hits(s, Ring.Friend, 0, 'pickleball?').length).toBe(1)
  })

  it('a meeting thread is not demo content, and the record is untouched', () => {
    const s = record([meeting('m1', [FRIENDS])])
    const before = JSON.stringify(s)
    const { threads } = meetingNoteThreads(s, Ring.Friend, 0)
    expect(threads[0].id.startsWith(MEETING_THREAD_PREFIX)).toBe(true)
    expect(threadIsDemo({ demo: { people: ['m1'], inventory: ['m1'] } }, threads[0].id)).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('malformed meetings never throw', () => {
    const s = record([null, { id: 'x' }, meeting('m2', 'nope'), meeting('m3', [null, { text: 5, audience: Audience.Friends }, nline('', Audience.Friends)])].filter((m) => m !== null))
    expect(() => meetingNoteThreads(s, Ring.Friend, 0)).not.toThrow()
    expect(meetingNoteThreads(record('x'), Ring.Friend, 0).threads).toEqual([])
  })
})
