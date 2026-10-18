/**
 * The person's timeline (src/timeline.ts, wave 7): what is stored, the import shape, duplicates, TrustWeb's own events, day grouping,
 * and the PRIVACY guard: an ask never sees Person.timeline.
 */
import { addEntries, byDay, cleanEntry, ownEvents, parseTimelineImport, timelineOf, TIMELINE_MAX, SUMMARY_MAX, TlChannel, TlDirection, TlSource } from '../../src/timeline.ts'
import { askSources } from '../../src/cascade.ts'
import { Ring } from '../../src/model.ts'

const person = (over = {}) => ({ id: 'p1', name: 'Anna', context: 'the garden', ring: Ring.Friends, metAt: 1_000, lines: [], ...over })
const state = (p, over = {}) => ({ people: [p], peers: [], log: [], inventory: [], ...over })
const good = { at: 5_000, channel: 'email', direction: 'in', summary: 'Re: the  garden\n plan', ref: 'msg-1' }

describe('cleanEntry', () => {
  it('keeps a good entry on one line and stamps the source', () => {
    expect(cleanEntry(good, TlSource.Manual)).toEqual({ at: 5000, channel: 'email', direction: 'in', summary: 'Re: the garden plan', ref: 'msg-1', source: 'manual' })
  })
  it('drops unusable ones', () => {
    for (const bad of [null, 'x', {}, { ...good, channel: 'fax' }, { ...good, direction: 'up' }, { ...good, summary: '  ' }, { ...good, at: 'now' }, { ...good, at: -1 }, { ...good, at: NaN }])
      expect(cleanEntry(bad, TlSource.Import)).toBeNull()
  })
  it('cuts long text and omits an empty ref', () => {
    const e = cleanEntry({ ...good, summary: 'x'.repeat(999), ref: '' }, TlSource.Import)
    expect(e.summary.length).toBe(SUMMARY_MAX)
    expect('ref' in e).toBe(false)
  })
})

describe('import', () => {
  it('reads an array or {entries}, forces the source, counts skipped', () => {
    const r = parseTimelineImport(JSON.stringify({ entries: [{ ...good, source: 'manual' }, { nope: 1 }] }))
    expect(r.unreadable).toBe(false)
    expect(r.skipped).toBe(1)
    expect(r.entries.map((e) => e.source)).toEqual(['import'])
    expect(parseTimelineImport(JSON.stringify([good])).entries.length).toBe(1)
  })
  it('reports unreadable files', () => {
    expect(parseTimelineImport('not json').unreadable).toBe(true)
    expect(parseTimelineImport('{"a":1}').unreadable).toBe(true)
    expect(parseTimelineImport('null').unreadable).toBe(true)
  })
  it('importing the same file twice adds nothing the second time', () => {
    const p = person()
    const { entries } = parseTimelineImport(JSON.stringify([good, { ...good, at: 6000 }]))
    expect(addEntries(p, entries)).toBe(2)
    expect(addEntries(p, entries)).toBe(0)
    expect(p.timeline.length).toBe(2)
  })
  it('stops at the cap', () => {
    const p = person()
    const many = Array.from({ length: TIMELINE_MAX + 5 }, (_, i) => cleanEntry({ ...good, at: i + 1 }, TlSource.Import))
    expect(addEntries(p, many)).toBe(TIMELINE_MAX)
  })
})

describe("TrustWeb's own events", () => {
  it('met, connected, asked, noted, recorded: all read-only with source trustweb', () => {
    const p = person({ peerId: 'q1', lines: [{ id: 'l', text: 'likes bees', notedAt: 2_000 }] })
    const s = state(p, {
      peers: [{ id: 'q1', connectedAt: 3_000 }],
      log: [{ at: 4_000, peerId: 'q1', text: 'a ladder?' }, { at: 4_500, peerId: 'q1', text: 'late', away: true }, { at: 4_600, peerId: 'other', text: 'x' }],
      meetings: [{ id: 'm1', personId: 'p1' }, { id: 'm2', personId: 'zz' }],
      hosting: { recs: [{ meetingId: 'm1', at: 7_000, seconds: 300 }, { meetingId: 'm2', at: 8_000, seconds: 60 }, { meetingId: 'm1', at: 9_000, seconds: 1, pending: true }] },
    })
    const ev = ownEvents(s, p)
    expect(ev.every((e) => e.source === TlSource.TrustWeb)).toBe(true)
    expect(ev.map((e) => e.at).sort((a, b) => a - b)).toEqual([1000, 2000, 3000, 4000, 7000])
    expect(ev.find((e) => e.at === 4000).direction).toBe(TlDirection.In)
    expect(ev.find((e) => e.at === 2000).channel).toBe(TlChannel.Note)
  })
  it('a person with nothing connected has only the meeting and notes', () => {
    expect(ownEvents(state(person()), person()).length).toBe(1)
  })
})

describe('order and days', () => {
  it('newest first across typed and own events; grouped by local day', () => {
    const p = person({ timeline: [cleanEntry({ ...good, at: 86_400_000 * 3 }, TlSource.Manual)] })
    const all = timelineOf(state(p), p)
    expect(all.map((e) => e.at)).toEqual([86_400_000 * 3, 1000])
    expect(byDay(all).length).toBe(2)
    expect(byDay([]).length).toBe(0)
  })
})

describe('privacy', () => {
  it('an ask never sees the timeline', () => {
    const p = person({ timeline: [cleanEntry(good, TlSource.Manual)] })
    const { threads } = askSources(state(p), Ring.Friends, 0)
    expect(JSON.stringify(threads)).not.toContain('garden plan')
  })
})
