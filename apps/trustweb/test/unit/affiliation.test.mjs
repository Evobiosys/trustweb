// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave44 home-dashboard: affiliations (community, other group, event, tag), their dashboards, managed-at-creation, the live-now flash. Synthetic data only. */
import { eventTagSlug as eventTag } from '../../src/event_tag.ts'
import { affiliationById, dashboardOf, createFlash, kindChoiceOnCreate, listAffiliations, managedSettingScope } from '../../src/affiliation.ts'

const tags = [
  { id: 'iyg', colour: '#111', label: 'IYG', community: true },
  { id: 'family', colour: '#222', label: 'family' },
  { id: 'garden', colour: '#333', label: 'Garden' },
]
const people = [
  { id: 'p1', name: 'Ana', peerId: 'x', fields: { iyg: 'true', family: 'true', event_Winter: 'true' } },
  { id: 'p2', name: 'Ben', fields: { iyg: 'true' } },
  { id: 'p3', name: 'Gone', fields: { iyg: 'true' }, deleted_at: 5 },
]
const events = [{ id: 'e1', name: 'Winter', from: '2026-11-16', where: 'Vienna', attended: true }, { id: 'e2', name: 'Spring', from: '2027-03-01', where: '', attended: false }]
const data = { meta: { iyg: { kind: 'managed', organizers: ['me'] }, family: { kind: 'informal', organizers: [], group: 'otherGroup' } } }
const NOW = new Date(2026, 10, 16, 12).getTime()

describe('listAffiliations', () => {
  const list = listAffiliations({ eventTag, data, tags, events, people })
  it('has the four kinds with stable ids', () => {
    expect(list.map((a) => a.id)).toEqual(['community:iyg', 'group:family', 'event:e1', 'event:e2', 'tag:garden'])
    expect(list.map((a) => a.kind)).toEqual(['community', 'otherGroup', 'event', 'event', 'tag'])
  })
  it('counts live members only', () => { expect(list[0].members).toBe(2); expect(list[1].members).toBe(1); expect(list[2].members).toBe(1) })
  it('affiliationById', () => { expect(affiliationById(list, 'event:e1').name).toBe('Winter'); expect(affiliationById(list, 'nope')).toBeUndefined() })
})

describe('dashboardOf', () => {
  const list = listAffiliations({ eventTag, data, tags, events, people })
  it('members, requests and live now for a community; no feed tile unless offered', () => {
    const d = dashboardOf(list[0], { eventTag, people, events, awayAsks: [{ id: 'a', at: 1, peerId: 'x', from: 'Ana', text: 'ladder?' }], now: NOW, feed: false })
    expect(d.tiles).toEqual(['members', 'requests', 'live'])
    expect(d.members).toBe(2)
    expect(d.requests).toBe(1)
  })
  it('adds the feed tile when the scope offers a feed', () => { expect(dashboardOf(list[0], { eventTag, people, events, now: NOW, feed: true }).tiles).toEqual(['members', 'requests', 'live', 'feed']) })
  it('an event counts itself live while it is on', () => {
    expect(dashboardOf(list[2], { eventTag, people, events, now: NOW, feed: false }).live).toBe(1)
    expect(dashboardOf(list[3], { eventTag, people, events, now: NOW, feed: false }).live).toBe(0)
  })
})

describe('managed or unmanaged', () => {
  it('is chosen at creation for a community and other group only', () => {
    expect(kindChoiceOnCreate('community')).toBe(true)
    expect(kindChoiceOnCreate('otherGroup')).toBe(true)
    expect(kindChoiceOnCreate('event')).toBe(false)
    expect(kindChoiceOnCreate('tag')).toBe(false)
  })
  it('afterwards it lives only in the settings of that affiliation', () => {
    expect(managedSettingScope('community')).toBe('settings')
    expect(managedSettingScope('event')).toBeNull()
  })
})

describe('live-now flash', () => {
  it('flashes once when the screen opens, then stays static', () => {
    const f = createFlash()
    expect(f.on).toBe(true)
    f.ended()
    expect(f.on).toBe(false)
    f.ended()
    expect(f.on).toBe(false)
  })
  it('a refresh press replays it', () => { const f = createFlash(); f.ended(); f.replay(); expect(f.on).toBe(true); f.ended(); expect(f.on).toBe(false) })
})

import { createCommunity, metaOf } from '../../src/ext/community-mighty/community_data.ts'
describe('creating an other group', () => {
  it('flags the group in the settings and keeps managed/unmanaged as the creation choice', () => {
    const out = createCommunity({}, [], 'Family', 'informal', 'otherGroup')
    expect(out.data.meta[out.id].group).toBe('otherGroup')
    expect(metaOf(out.data, out.id).kind).toBe('informal')
    expect(createCommunity({}, [], 'IYG', 'managed').data.meta.iyg.group).toBeUndefined()
  })
})
