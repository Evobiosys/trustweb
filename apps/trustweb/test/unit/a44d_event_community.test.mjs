// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 4 (Jakob's Tana memo "Improve community event sharing and participant visibility"): the pure rules. Intimate communities
 * (<= 30 members by default, editable), the event's share audience (community events: joiners become acquainted community members, or Choose later),
 * who joins, hosted by, the first sentence, a joined acceptance on the host's device, and the Web's event mode for an intimate community. Fake data.
 */
import { INTIMATE_MAX, isIntimate, setIntimate, shareAudienceOf, setShareAudience, hostedBy, joiningOf, communityRowOf, firstSentence, applyJoined, intimateEventChips, everyoneAt } from '../../src/event_community.ts'
import { eventModeShow } from '../../src/event_filter_mode.ts'
import { parseCommunity } from '../../src/ext/community-mighty/community_data.ts'

const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], context: '', metAt: 1, ...over })
const members = (n, tag = 'iyg') => Array.from({ length: n }, (_, i) => P(`m${i}`, `Member ${i}`, { fields: { [tag]: 'true' }, peerId: `peer-m${i}` }))
const EV = { id: 'e1', name: 'Winter OG', from: '2026-12-30', where: '', createdAt: 1, attended: true, hosts: ['Ana', 'Ben'], communityId: 'iyg', docs: { description: 'Three days in the snow. Bring boots.' } }
const rec = (people, meta = {}) => ({ me: { id: 'me', displayName: 'Ana' }, people, events: [EV], extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [], ...meta } } } } })

describe('intimate communities', () => {
  it('<= 30 members are intimate by default; more are not; the flag overrides', () => {
    expect(INTIMATE_MAX).toBe(30)
    expect(isIntimate(rec(members(30)), 'iyg')).toBe(true)
    expect(isIntimate(rec(members(31)), 'iyg')).toBe(false)
    expect(isIntimate(rec(members(31), { intimate: true }), 'iyg')).toBe(true)
    expect(isIntimate(rec(members(3), { intimate: false }), 'iyg')).toBe(false)
  })
  it('setIntimate stores the flag in the community settings (it survives parseCommunity)', () => {
    const r = rec(members(40))
    setIntimate(r, 'iyg', true)
    expect(parseCommunity(r.extData['community-mighty']).meta.iyg.intimate).toBe(true)
    expect(isIntimate(r, 'iyg')).toBe(true)
  })
})

describe('share audience (4a)', () => {
  it('a community event defaults to community; a personal one has none; Choose later is stored', () => {
    expect(shareAudienceOf(EV)).toBe('community')
    expect(shareAudienceOf({ ...EV, communityId: undefined })).toBeNull()
    const ev = { ...EV }
    setShareAudience(ev, 'later')
    expect(ev.shareAudience).toBe('later')
    setShareAudience(ev, 'community')
    expect('shareAudience' in ev).toBe(false)
  })
})

describe('the page top (4b, 4e)', () => {
  it('hosted by, joining (tagged + accepted, hosts left out), the community row only when intimate', () => {
    const people = [P('b', 'Ben', { events: ['e1'] }), P('c', 'Cleo', { events: ['e1'] }), ...members(2)]
    const r = rec(people)
    expect(hostedBy(EV)).toEqual(['Ana', 'Ben'])
    expect(joiningOf(r, EV).map((p) => p.name)).toEqual(['Cleo'])
    expect(communityRowOf(r, EV).map((p) => p.id)).toEqual(['m0', 'm1'])
    expect(communityRowOf(rec(people.concat(members(40, 'iyg'))), EV)).toEqual([])
  })
  it('the first sentence of the description', () => {
    expect(firstSentence('Three days in the snow. Bring boots.')).toBe('Three days in the snow.')
    expect(firstSentence('  No full stop here  ')).toBe('No full stop here')
    expect(firstSentence('')).toBe('')
    expect(firstSentence('x'.repeat(300)).length).toBeLessThanOrEqual(140)
  })
})

describe('a joined acceptance on my device (4c)', () => {
  it('tags the person with the event; a community event places a new one as an acquainted community member', () => {
    const r = rec([P('j', 'Jo', { ring: 'unsorted', peerId: 'peer-j' })])
    expect(applyJoined(r, 'peer-j', 'e1')).toBe(true)
    expect(r.people[0]).toMatchObject({ events: ['e1'], ring: 'acquaintance', fields: { iyg: 'true' } })
    expect(applyJoined(r, 'peer-j', 'e1')).toBe(false)
  })
  it('Choose later leaves the ring and the tags alone; an unknown sender or event changes nothing', () => {
    const r = rec([P('j', 'Jo', { ring: 'unsorted', peerId: 'peer-j' })])
    r.events[0] = { ...EV, shareAudience: 'later' }
    expect(applyJoined(r, 'peer-j', 'e1')).toBe(true)
    expect(r.people[0].ring).toBe('unsorted')
    expect(r.people[0].fields).toBeUndefined()
    expect(applyJoined(r, 'peer-x', 'e1')).toBe(false)
    expect(applyJoined(r, 'peer-j', 'nope')).toBe(false)
  })
  it('an existing ring is never lowered', () => {
    const r = rec([P('j', 'Jo', { ring: 'close', peerId: 'peer-j' })])
    applyJoined(r, 'peer-j', 'e1')
    expect(r.people[0].ring).toBe('close')
  })
})

describe('the Web in event mode (4b): an intimate community shows its members too', () => {
  it('adds the community tag chip only for an intimate community event', () => {
    const r = { ...rec(members(3)), uiRings: { eventMode: 'e1' } }
    expect(intimateEventChips(r)).toEqual(['tag:iyg'])
    expect(eventModeShow(r)).toEqual(['event:e1', 'tag:iyg'])
    const big = { ...rec(members(31)), uiRings: { eventMode: 'e1' } }
    expect(eventModeShow(big)).toEqual(['event:e1'])
  })
})

describe('Message everyone (4d)', () => {
  it('the connected joiners and hosts, once each; not connected ones are left out', () => {
    const people = [P('b', 'Ben', { events: ['e1'], peerId: 'pb' }), P('c', 'Cleo', { events: ['e1'], peerId: 'pc' }), P('d', 'Dora', { events: ['e1'] }), P('x', 'Ana', { peerId: 'pa' })]
    expect(everyoneAt(rec(people), EV).map((p) => p.id).sort()).toEqual(['b', 'c', 'x'])
  })
})
