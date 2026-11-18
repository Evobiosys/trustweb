// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c seen-through: the three sources of Person.via (event introductions, intro asks, resource asks), their consent flags, the wire and the MCP list. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addSeenThrough, INTRO_CONTEXT, readSeen, seenFromItems, seenItem, seenThroughList, SEEN_WHO_MAX } from '../../src/seen_through.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { liveHeldAsks } from '../../src/held_asks.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const P = (id, name, extra = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...extra })
const rec = () => ({ people: [P('lena', 'Lena', { peerId: 'peer-lena' }), P('omar-own', 'Omar Known')] })

describe('seenItem / readSeen: the consent flag is the only new thing on an item', () => {
  it('a yes carries the name, a no never does', () => {
    expect(seenItem('Ladder in the shed', 'A tip', 'just now', 'Omar', true)).toEqual({ text: 'Ladder in the shed', context: 'A tip', when: 'just now', shown: true, who: 'Omar' })
    expect(seenItem('Ladder in the shed', 'A tip', 'just now', 'Omar', false)).toEqual({ text: 'Ladder in the shed', context: 'A tip', when: 'just now', shown: false })
  })
  it('readSeen drops a name without a yes, clips it, ignores items without the flag', () => {
    expect(readSeen({ text: 'x', context: 'A tip', when: '', shown: false, who: 'Omar' })).toEqual({ text: 'x', context: 'A tip', shown: false })
    expect(readSeen({ text: 'x', context: 'A tip', when: '', shown: true, who: 'O'.repeat(90) }).who).toHaveLength(SEEN_WHO_MAX)
    expect(readSeen({ text: 'x', context: 'A tip', when: '' })).toBeNull()
    expect(readSeen({ text: 'x', shown: 'yes' })).toBeNull()
    expect(readSeen(null)).toBeNull()
  })
})

describe('addSeenThrough: the record mutation', () => {
  it('named with consent: a person outside the rings via the friend', () => {
    const s = rec()
    const id = addSeenThrough(s, { via: 'lena', who: 'Omar', shown: true, source: 'ask', resource: 'Who has a ladder?', now: 5, id: 'n1' })
    expect(id).toBe('n1')
    expect(s.people.find((p) => p.id === 'n1')).toMatchObject({ name: 'Omar', via: 'lena', ring: 'none', seen: { source: 'ask', at: 5, resource: 'Who has a ladder?' } })
    expect(s.people.find((p) => p.id === 'n1').anonymous).toBeUndefined()
  })
  it('without consent: nameless, anonymous, never the name even when one is passed', () => {
    const s = rec()
    addSeenThrough(s, { via: 'lena', who: 'Omar', shown: false, source: 'ask', resource: 'ladder', now: 5, id: 'n1' })
    expect(s.people.find((p) => p.id === 'n1')).toMatchObject({ name: '', anonymous: true, via: 'lena' })
  })
  it('the same again updates, a later yes names the anonymous one', () => {
    const s = rec()
    addSeenThrough(s, { via: 'lena', shown: false, source: 'ask', resource: 'ladder', now: 5, id: 'n1' })
    expect(addSeenThrough(s, { via: 'lena', shown: false, source: 'ask', resource: 'ladder', now: 6, id: 'n2' })).toBe('n1')
    expect(addSeenThrough(s, { via: 'lena', who: 'Omar', shown: true, source: 'ask', resource: 'ladder', now: 7, id: 'n3' })).toBe('n1')
    const o = s.people.find((p) => p.id === 'n1')
    expect(o).toMatchObject({ name: 'Omar', seen: { at: 7 } })
    expect(o.anonymous).toBeUndefined()
    expect(s.people).toHaveLength(3)
  })
  it('nobody I know already, no unknown friend, never myself through a stranger', () => {
    const s = rec()
    expect(addSeenThrough(s, { via: 'lena', who: 'omar known', shown: true, source: 'intro', now: 1, id: 'n1' })).toBe('omar-own')
    expect(addSeenThrough(s, { via: 'ghost', who: 'Zed', shown: true, source: 'intro', now: 1, id: 'n2' })).toBeUndefined()
    expect(s.people).toHaveLength(2)
  })
  it('seenFromItems: only items with the flag, only from a connected friend; intro vs ask from the context', () => {
    const s = rec()
    const ids = seenFromItems(s, 'peer-lena', [{ text: 'Ladder', context: 'Lena', when: '' }, { text: 'Omar', context: INTRO_CONTEXT, when: '', shown: true, who: 'Omar' }, { text: 'tip', context: 'A tip', when: '', shown: false }], 'ladder', 3, () => 'x' + s.people.length)
    expect(ids).toHaveLength(2)
    expect(s.people.filter((p) => p.via).map((p) => p.seen.source).sort()).toEqual(['ask', 'intro'])
    expect(seenFromItems(s, 'peer-unknown', [{ text: 'tip', context: 'A tip', when: '', shown: false }], 'x', 3, () => 'y')).toEqual([])
  })
})

describe('seenThroughList (MCP people_seen_through_list)', () => {
  it('lists second-hand people, nameless ones without a name', () => {
    const s = rec()
    addSeenThrough(s, { via: 'lena', who: 'Omar', shown: true, source: 'ask', resource: 'ladder', now: 1, id: 'n1' })
    addSeenThrough(s, { via: 'lena', shown: false, source: 'event', event: 'ev1', now: 2, id: 'n2' })
    expect(seenThroughList(s)).toEqual([
      { id: 'n1', name: 'Omar', anonymous: false, via: 'lena', viaName: 'Lena', source: 'ask', resource: 'ladder', at: 1 },
      { id: 'n2', name: '', anonymous: true, via: 'lena', viaName: 'Lena', source: 'event', event: 'ev1', at: 2 },
    ])
  })
  it('the MCP tool reads the record file and is listed', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'seen-mcp-')), 'rec.json')
    const s = { v: 1, ...rec() }
    addSeenThrough(s, { via: 'lena', shown: false, source: 'intro', now: 1, id: 'n1' })
    writeFileSync(file, JSON.stringify(s))
    const t = allTools({ file, write: false }).find((x) => x.name === 'people_seen_through_list')
    expect(t).toBeDefined()
    expect(t.run({})).toEqual([{ id: 'n1', name: '', anonymous: true, via: 'lena', viaName: 'Lena', source: 'intro', at: 1 }])
    expect(MCP_TOOLS).toContainEqual({ name: 'people_seen_through_list', write: false })
  })
})

describe('wire: kind show, item flags, event seen', () => {
  const q = { v: 1, t: 'query', from: { id: 'a', displayName: 'A' }, templateId: 't', templateVersion: 1, qid: 'q1', issuedAt: 1, freeText: 'x' }
  it('a show ask needs its target', () => {
    expect(decodeFromQr(encodeForQr({ ...q, kind: 'show', target: 'Anna' }))).toMatchObject({ kind: 'show', target: 'Anna' })
    expect(decodeFromQr(encodeForQr({ ...q, kind: 'show' }))).toBeNull()
  })
  it('event seen: id + flag, a name only with a yes', () => {
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', seen: { id: 'ev1', shown: true, who: 'Omar' } }))).toEqual({ v: 1, t: 'event', seen: { id: 'ev1', shown: true, who: 'Omar' } })
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', seen: { id: 'ev1', shown: false } }))).toEqual({ v: 1, t: 'event', seen: { id: 'ev1', shown: false } })
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', seen: { id: 'ev1', shown: false, who: 'Omar' } }))).toBeNull()
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', seen: { id: 'ev1', shown: true, who: 'O'.repeat(41) } }))).toBeNull()
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', seen: { id: 'ev1', shown: true }, link: 'x' }))).toBeNull()
  })
  it('a held prompt keeps show and seen', () => {
    const h = { qid: 'q', peerId: 'p', text: 't', fromName: 'A', through: [], doorName: null, relayed: false, matches: [], receivedAt: 10, deadline: 11, lateMode: true }
    expect(liveHeldAsks([{ ...h, show: 'Anna', seen: { who: 'Omar', shown: true } }], 10)).toHaveLength(1)
    expect(liveHeldAsks([{ ...h, show: 3 }], 10)).toHaveLength(0)
    expect(liveHeldAsks([{ ...h, seen: { who: 'Omar' } }], 10)).toHaveLength(0)
  })
})

describe('event introductions (source 1): a host introduces a person to an attendee', () => {
  function host(state, sent) {
    return createEventEnvelopes({
      state: () => state, save: () => {}, now: () => 9, link: () => 'x', changed: () => {}, later: () => {}, pending: () => null, setPending: () => {},
      send: async (peer, env) => { sent.push([peer.id, env]) },
      recipients: () => [{ id: 'peer-att' }],
    })
  }
  const ev = (extra = {}) => ({ id: 'ev1', name: 'Winter IYG', from: '2026-12-01', where: 'Wien', createdAt: 1, attended: true, ...extra })
  it('the host sends the flag to the attendees, a name only with a yes', async () => {
    const sent = []
    const h = host({ me: { id: 'me', displayName: 'Hana' }, people: [], events: [ev({ organizers: ['Hana'] })] }, sent)
    await h.introduce('ev1', 'Omar', true)
    await h.introduce('ev1', 'Omar', false)
    expect(sent).toEqual([['peer-att', { v: 1, t: 'event', seen: { id: 'ev1', shown: true, who: 'Omar' } }], ['peer-att', { v: 1, t: 'event', seen: { id: 'ev1', shown: false } }]])
  })
  it('the attendee adds them via the host; only from a host, only for an event I attend', async () => {
    const st = { me: { id: 'me', displayName: 'Anna' }, people: [P('hana', 'Hana', { peerId: 'peer-hana' }), P('ben', 'Ben', { peerId: 'peer-ben' })], events: [ev({ organizers: ['hana'] }), ev({ id: 'ev2', attended: false, organizers: ['hana'] })] }
    const h = host(st, [])
    expect(await h.onEnvelope({ id: 'peer-hana' }, { v: 1, t: 'event', seen: { id: 'ev1', shown: false } })).toBe('filled')
    expect(st.people.find((p) => p.via === 'hana')).toMatchObject({ name: '', anonymous: true, seen: { source: 'event', event: 'ev1' } })
    expect(await h.onEnvelope({ id: 'peer-hana' }, { v: 1, t: 'event', seen: { id: 'ev1', shown: true, who: 'Omar' } })).toBe('filled')
    expect(st.people.filter((p) => p.via === 'hana').map((p) => p.name)).toEqual(['Omar'])
    expect(await h.onEnvelope({ id: 'peer-ben' }, { v: 1, t: 'event', seen: { id: 'ev1', shown: true, who: 'Eve' } })).toBe('ignored')
    expect(await h.onEnvelope({ id: 'peer-hana' }, { v: 1, t: 'event', seen: { id: 'ev2', shown: true, who: 'Eve' } })).toBe('ignored')
  })
})

describe('Ask <friend> to introduce: the prefilled target', async () => {
  const { seenIntroTarget } = await import('../../src/seen_through_view.ts')
  it('the name, or for a nameless one the ask or the event', () => {
    expect(seenIntroTarget({ name: 'Omar', seen: { source: 'ask', at: 1, resource: 'ladder' } }, '')).toBe('Omar')
    expect(seenIntroTarget({ name: '', anonymous: true, seen: { source: 'ask', at: 1, resource: 'Who has a ladder?' } }, '')).toBe('the person who can help with "Who has a ladder?"')
    expect(seenIntroTarget({ name: '', anonymous: true, seen: { source: 'event', at: 1, event: 'e' } }, 'Winter IYG')).toBe('the person you introduced at Winter IYG')
    expect(seenIntroTarget({ name: '', anonymous: true }, '')).toBe('the person you told me about')
  })
})

describe('seen-through people are not my archive', async () => {
  const { archivedPeople } = await import('../../src/archived_people.ts')
  it('archivedPeople leaves out people seen only through a friend', () => {
    expect(archivedPeople([P('a', 'Arch', { ring: 'none' }), P('s', '', { ring: 'none', via: 'lena', anonymous: true })]).map((p) => p.id)).toEqual(['a'])
  })
})
