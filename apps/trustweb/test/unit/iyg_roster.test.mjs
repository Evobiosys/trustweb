// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave46 iyg-roster: the host's roster (names only), the tag-only community roster, its receive gate, the wire, the via rows. Fake names only. */
import { rosterNames, communityRosterNames, rosterDue } from '../../src/event_roster.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { peopleAtEvent, viaPeopleAt } from '../../src/event_people_list.ts'
import { buildViaMembers } from '../../src/ext/community-mighty/community_model.ts'
import { decodeFromQr as parse } from '../../../demo/src/wire.ts'

const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], metAt: 0, ...over })
const ev = (over = {}) => ({ id: 'e1', name: 'IYG', from: '2026-12-01', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], ...over })
const meta = (m) => ({ 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [], ...m } } } })
const rec = (people, extData) => ({ me: { id: 'm', displayName: 'Hanna' }, people, events: [], ...(extData ? { extData } : {}) })
const guests = () => [P('a', 'Anna', { events: ['e1'], eventShow: { e1: 'open' } }), P('b', 'Ben', { events: ['e1'], eventShow: { e1: 'discoverable' } }), P('c', 'Cleo', { events: ['e1'], eventShow: { e1: 'off' } }), P('d', 'Dora', { events: ['e1'], via: 'a' }), P('g', 'Gone', { events: ['e1'], deleted_at: '2026-01-01' })]

describe('rosterNames', () => {
  it('showAll: open + discoverable, never off, via, deleted', () => {
    expect(rosterNames(rec(guests()), ev({ showAll: true })).sort()).toEqual(['Anna', 'Ben'])
  })
  it('nothing for a personal event without showAll', () => {
    expect(rosterNames(rec(guests()), ev())).toEqual([])
  })
  it('intimate community event without showAll: only the open ones', () => {
    expect(rosterNames(rec(guests(), meta({ intimate: true })), ev({ communityId: 'iyg' }))).toEqual(['Anna'])
    expect(rosterNames(rec(guests(), meta({ intimate: false })), ev({ communityId: 'iyg' }))).toEqual([])
  })
  it('only the host device sends', () => {
    expect(rosterNames(rec(guests()), ev({ showAll: true, hosts: ['Somebody'], fromLink: true }))).toEqual([])
  })
  it('names are cut to 40 and each once', () => {
    const long = 'x'.repeat(60)
    expect(rosterNames(rec([P('a', long, { events: ['e1'] }), P('b', 'anna', { events: ['e1'] }), P('c', 'Anna', { events: ['e1'] })]), ev({ showAll: true }))).toEqual(['x'.repeat(40), 'anna'])
  })
})

describe('rosterDue', () => {
  it('leaves out the recipient and what was sent', () => {
    expect(rosterDue(['Ben'], ['Anna', 'Ben', 'Cleo'], 'Anna')).toEqual(['Cleo'])
    expect(rosterDue(undefined, ['Anna', 'Ben'], 'anna')).toEqual(['Ben'])
  })
})

describe('communityRosterNames', () => {
  const people = [P('a', 'Anna', { fields: { iyg: 'true' } }), P('b', 'Ben', { fields: { iyg: 'true' } }), P('z', 'Zed')]
  it('an organizer of an intimate community in mode members names its members', () => {
    expect(communityRosterNames(rec(people, meta({ intimate: true, organizers: ['me'] })), 'iyg').sort()).toEqual(['Anna', 'Ben'])
  })
  it('not an organizer, not intimate, or mode invited: nothing', () => {
    expect(communityRosterNames(rec(people, meta({ intimate: true })), 'iyg')).toEqual([])
    expect(communityRosterNames(rec(people, meta({ intimate: false, organizers: ['me'] })), 'iyg')).toEqual([])
    expect(communityRosterNames(rec(people, meta({ intimate: true, organizers: ['me'], eventAccess: 'invited' })), 'iyg')).toEqual([])
  })
})

function phone(name, people, events, extData) {
  const state = { v: 1, me: { id: 'm', displayName: name }, peers: [], people, log: [], events, ...(extData ? { extData } : {}) }
  const sent = []
  const env = createEventEnvelopes({
    state: () => state, save: () => {}, now: () => 1000, link: () => '', send: async (p, e) => { sent.push([p.id, e]) },
    recipients: (e) => state.people.filter((x) => x.peerId && x.events?.includes(e.id)).map((x) => ({ id: x.peerId })),
    members: (tag) => state.people.filter((x) => x.peerId && String(x.fields?.[tag]) === 'true').map((x) => ({ id: x.peerId })),
    pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => [],
  })
  return { state, sent, env }
}

describe('rosterSync (host device)', () => {
  const host = () => phone('Hanna', [P('a', 'Anna', { events: ['e1'], peerId: 'pa' }), P('b', 'Ben', { events: ['e1'], peerId: 'pb' }), P('c', 'Cleo', { events: ['e1'], peerId: 'pc', eventShow: { e1: 'off' } })], [ev({ showAll: true })])
  it('each recipient gets the others, never itself, never an off person', async () => {
    const h = host()
    await h.env.rosterSync()
    const got = (id) => h.sent.filter(([p]) => p === id).map(([, e]) => e.seen.who).sort()
    expect(got('pa')).toEqual(['Ben'])
    expect(got('pb')).toEqual(['Anna'])
    expect(JSON.stringify(h.sent)).not.toContain('Cleo')
    expect(h.sent.every(([, e]) => Object.keys(e.seen).sort().join() === 'id,shown,who' && e.seen.id === 'e1' && e.seen.shown === true)).toBe(true)
  })
  it('a second run sends nothing; a new joiner goes out once, and gets the existing ones', async () => {
    const h = host()
    await h.env.rosterSync()
    h.sent.length = 0
    await h.env.rosterSync()
    expect(h.sent).toEqual([])
    h.state.people.push(P('d', 'Dora', { events: ['e1'], peerId: 'pd' }))
    await h.env.rosterSync()
    expect(h.sent.filter(([p]) => p === 'pa').map(([, e]) => e.seen.who)).toEqual(['Dora'])
    expect(h.sent.filter(([p]) => p === 'pd').map(([, e]) => e.seen.who).sort()).toEqual(['Anna', 'Ben'])
  })
  it('a personal event without showAll sends nothing', async () => {
    const h = host()
    delete h.state.events[0].showAll
    await h.env.rosterSync()
    expect(h.sent).toEqual([])
  })
  it('a community roster goes to connected members as {tag, shown, who}', async () => {
    const h = phone('Hanna', [P('a', 'Anna', { peerId: 'pa', fields: { iyg: 'true' } }), P('b', 'Ben', { peerId: 'pb', fields: { iyg: 'true' } })], [], meta({ intimate: true, organizers: ['me'] }))
    await h.env.rosterSync()
    expect(h.sent.map(([p, e]) => [p, e.seen])).toEqual(expect.arrayContaining([['pa', { tag: 'iyg', shown: true, who: 'Ben' }], ['pb', { tag: 'iyg', shown: true, who: 'Anna' }]]))
    expect(h.sent).toHaveLength(2)
  })
  it('property: random modes never put an off person or the recipient in an envelope', async () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 40; i++) {
      const modes = ['open', 'discoverable', 'off']
      const people = Array.from({ length: 6 }, (_, k) => P('p' + k, 'Name' + k, { events: ['e1'], peerId: 'q' + k, eventShow: { e1: modes[Math.floor(rnd() * 3)] } }))
      const h = phone('Hanna', people, [ev({ showAll: rnd() < 0.5 })])
      await h.env.rosterSync()
      for (const [to, e] of h.sent) {
        const k = to.slice(1)
        expect(e.seen.who).not.toBe('Name' + k)
        expect(people.find((p) => p.name === e.seen.who).eventShow.e1).not.toBe('off')
      }
    }
  })
})

describe('onSeen with a tag (guest device)', () => {
  const guest = (holds = true) => phone('Anna', [P('h', 'Hanna', { peerId: 'ph', ...(holds ? { fields: { iyg: 'true' } } : {}) })], [])
  it('a tag roster from a member who holds the tag adds a via person with seen.tag', async () => {
    const g = guest()
    expect(await g.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', seen: { tag: 'iyg', shown: true, who: 'Ben' } })).toBe('filled')
    expect(g.state.people.find((p) => p.name === 'Ben')).toMatchObject({ via: 'h', seen: { tag: 'iyg' } })
  })
  it('refused: sender without the tag, a stranger, nameless', async () => {
    const g = guest(false)
    expect(await g.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', seen: { tag: 'iyg', shown: true, who: 'Ben' } })).toBe('ignored')
    expect(await guest().env.onEnvelope({ id: 'zz' }, { v: 1, t: 'event', seen: { tag: 'iyg', shown: true, who: 'Ben' } })).toBe('ignored')
    expect(await guest().env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', seen: { tag: 'iyg', shown: false } })).toBe('ignored')
  })
})

describe('wire', () => {
  it('tag-only seen parses; id or tag required; a bad tag is refused; old shape unchanged', () => {
    expect(parse(JSON.stringify({ v: 1, t: 'event', seen: { tag: 'iyg', shown: true, who: 'Ben' } }))).toEqual({ v: 1, t: 'event', seen: { tag: 'iyg', shown: true, who: 'Ben' } })
    expect(parse(JSON.stringify({ v: 1, t: 'event', seen: { shown: true, who: 'Ben' } }))).toBeNull()
    expect(parse(JSON.stringify({ v: 1, t: 'event', seen: { tag: 'bad tag!', shown: true, who: 'Ben' } }))).toBeNull()
    expect(parse(JSON.stringify({ v: 1, t: 'event', seen: { id: 'e1', shown: true, who: 'Ben' } }))).toEqual({ v: 1, t: 'event', seen: { id: 'e1', shown: true, who: 'Ben' } })
  })
})

describe('lists', () => {
  const people = [P('h', 'Hanna'), P('a', 'Anna'), P('v1', 'Ben', { via: 'h', seen: { source: 'event', at: 1, event: 'old' } }), P('v2', 'Cleo', { via: 'h', seen: { source: 'event', at: 1, event: 'other' } }), P('v3', 'Dora', { via: 'h', seen: { source: 'event', at: 1, tag: 'iyg' } }), P('v4', '', { via: 'h', anonymous: true, seen: { source: 'event', at: 1, event: 'old' } })]
  it('People at this event: via rows after the direct ones, merged ids count, no duplicate names, no nameless', () => {
    const via = viaPeopleAt(people, (e) => e === 'old')
    expect(via).toEqual([{ id: 'v1', name: 'Ben', host: false, via: 'Hanna' }])
    expect(peopleAtEvent(people, ['Hanna'], [people[1]], via).map((x) => x.name)).toEqual(['Hanna', 'Anna', 'Ben'])
    expect(peopleAtEvent(people, ['Hanna'], [people[1], P('x', 'ben')], via).map((x) => x.name)).toEqual(['Hanna', 'Anna', 'ben'])
  })
  it('Members: via people with seen.tag or an event of the community', () => {
    const events = [{ id: 'old', communityId: 'iyg' }, { id: 'other', communityId: 'zzz' }]
    expect(buildViaMembers(people, 'iyg', events, { eventMerged: {} }).map((m) => [m.name, m.via])).toEqual([['Ben', 'Hanna'], ['Dora', 'Hanna']])
  })
})
