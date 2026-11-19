// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 merge-events: the pure merge (event_merge.ts): one event keeps its id, the other's people, resources, notes and posts move over, the old id redirects. Fake data only. */
import { mergeEvents, resolveEvent, mayMerge, mergeCandidates, mergedInto } from '../../src/event_merge.ts'

const ev = (id, name, extra = {}) => ({ id, name, from: '2026-12-30', where: '', createdAt: 1, attended: true, ...extra })
const person = (id, extra = {}) => ({ id, name: `Person ${id}`, context: '', ring: 'friend', metAt: 0, lines: [], ...extra })

function rec() {
  return {
    v: 1, me: { id: 'me', displayName: 'Hanna Host' },
    events: [
      ev('keep1', 'Winter IYG', { where: 'Alm', hosts: ['Hanna Host'], resources: [{ id: 'r1', text: 'Tables' }], roles: [{ name: 'Cook' }], signup: ['me'], docs: { description: 'Snow days' }, themes: ['snow'] }),
      ev('gone1', 'IYG Winter', { to: '2027-01-02', conditions: 'Bring boots', hosts: ['Hanna Host', 'Omar Co'], resources: [{ id: 'r2', text: 'Speaker', by: 'p2' }, { id: 'r1', text: 'Tables' }], roles: [{ name: 'Cook', who: 'p2' }, { name: 'DJ' }], signup: ['p2'], docs: { description: 'Winter gathering', followup: 'Photos' }, themes: ['snow', 'yoga'], people: ['p3'], openSpace: { acts: [] } }),
    ],
    people: [
      person('p1', { events: ['keep1'] }),
      person('p2', { events: ['gone1'], eventShow: { gone1: 'open' }, lines: [{ id: 'l1', text: 'met at the hut', eventId: 'gone1' }] }),
      person('p3', { events: ['keep1', 'gone1'], seen: { source: 'event', at: 1, event: 'gone1' } }),
    ],
    inventory: [{ id: 'i1', text: 'Sled', eventId: 'gone1' }],
    feedPosts: [{ id: 'f1', text: 'hi', by: 'me', at: 1, tag: 'event_IYG_Winter', eventId: 'gone1' }],
    notifInbox: [{ id: 'n1', kind: 'event', title: 't', body: 'b', at: 1, seenAt: null, eventId: 'gone1' }],
    atEvent: { eventId: 'gone1', since: 1 },
    uiRings: { show: ['event:gone1'] },
  }
}

describe('mergeEvents', () => {
  it('moves the people of the gone event onto the kept one, once each', () => {
    const s = rec()
    expect(mergeEvents(s, 'keep1', 'gone1', 10)).toMatchObject({ people: 2 })
    expect(s.people.map((p) => p.events)).toEqual([['keep1'], ['keep1'], ['keep1']])
    expect(s.people[1].eventShow).toEqual({ keep1: 'open' })
    expect(s.people[2].seen.event).toBe('keep1')
  })
  it('joins resources, roles, sign-ups, themes, hosts and docs without doubles; fills what the kept event lacks', () => {
    const s = rec()
    mergeEvents(s, 'keep1', 'gone1', 10)
    const k = s.events.find((e) => e.id === 'keep1')
    expect(k.resources.map((r) => r.text)).toEqual(['Tables', 'Speaker'])
    expect(k.roles).toEqual([{ name: 'Cook' }, { name: 'DJ' }])
    expect(k.signup).toEqual(['me', 'p2'])
    expect(k.themes).toEqual(['snow', 'yoga'])
    expect(k.hosts).toEqual(['Hanna Host', 'Omar Co'])
    expect(k.people).toEqual(['p3'])
    expect(k.docs).toEqual({ description: 'Snow days\n\nWinter gathering', followup: 'Photos' })
    expect(k).toMatchObject({ where: 'Alm', to: '2027-01-02', conditions: 'Bring boots', openSpace: { acts: [] }, name: 'Winter IYG' })
  })
  it('re-points notes, resources, feed posts, the inbox, "I am here" and the Web filter', () => {
    const s = rec()
    mergeEvents(s, 'keep1', 'gone1', 10)
    expect(s.people[1].lines[0].eventId).toBe('keep1')
    expect(s.inventory[0].eventId).toBe('keep1')
    expect(s.feedPosts[0]).toMatchObject({ eventId: 'keep1', tag: 'event_Winter_IYG' })
    expect(s.notifInbox[0].eventId).toBe('keep1')
    expect(s.atEvent.eventId).toBe('keep1')
    expect(s.uiRings.show).toEqual(['event:keep1'])
  })
  it('the gone event goes to the trash (never deleted) and its id redirects', () => {
    const s = rec()
    mergeEvents(s, 'keep1', 'gone1', Date.parse('2026-11-19T10:00:00Z'))
    expect(s.events.map((e) => e.id)).toEqual(['keep1'])
    expect(s.trash).toEqual([expect.objectContaining({ kind: 'event', id: 'gone1', item: expect.objectContaining({ name: 'IYG Winter' }) })])
    expect(s.eventMerged).toEqual({ gone1: 'keep1' })
    expect(resolveEvent(s, 'gone1')).toBe('keep1')
    expect(resolveEvent(s, 'keep1')).toBe('keep1')
    expect(resolveEvent(s, 'other')).toBe('other')
  })
  it('a chain of merges redirects to the last event; a restored event is its own again', () => {
    const s = rec()
    s.events.push(ev('third', 'Third'))
    mergeEvents(s, 'keep1', 'gone1', 10)
    mergeEvents(s, 'third', 'keep1', 11)
    expect(s.eventMerged).toEqual({ gone1: 'third', keep1: 'third' })
    expect(resolveEvent(s, 'gone1')).toBe('third')
    s.events.push(ev('gone1', 'back'))
    expect(resolveEvent(s, 'gone1')).toBe('gone1')
  })
  it('refuses the same event twice or an event it does not hold, changing nothing', () => {
    const s = rec()
    const before = JSON.stringify(s)
    expect(mergeEvents(s, 'keep1', 'keep1', 10)).toBeNull()
    expect(mergeEvents(s, 'keep1', 'nope', 10)).toBeNull()
    expect(JSON.stringify(s)).toBe(before)
  })
  it('without a kept event at all, only the redirect is written (a participant who never held it)', () => {
    const s = rec()
    expect(mergeEvents(s, 'elsewhere', 'gone1', 10)).toBeNull()
    expect(s.eventMerged).toBeUndefined()
  })
})

describe('mergedInto: an old link opens the kept event', () => {
  it('names the held event a merged id redirects to; nothing for a held, unknown or dangling id', () => {
    const s = rec()
    mergeEvents(s, 'keep1', 'gone1', 10)
    expect(mergedInto(s, 'gone1')).toBe('keep1')
    expect(mergedInto(s, 'keep1')).toBeUndefined()
    expect(mergedInto(s, 'other')).toBeUndefined()
    s.eventMerged.lost = 'nowhere'
    expect(mergedInto(s, 'lost')).toBeUndefined()
  })
})

describe('mayMerge / mergeCandidates', () => {
  it('a host of both may merge; a host of one may only ask', () => {
    const s = rec()
    s.events.push(ev('theirs', 'Theirs', { hosts: ['Omar Co'], fromLink: true }))
    expect(mayMerge(s, 'keep1', 'gone1')).toBe('now')
    expect(mayMerge(s, 'keep1', 'theirs')).toBe('ask')
    expect(mayMerge(s, 'theirs', 'keep1')).toBe('no')
    expect(mayMerge(s, 'keep1', 'keep1')).toBe('no')
  })
  it('candidates: every other event I hold, not the one itself', () => {
    const s = rec()
    expect(mergeCandidates(s, 'keep1').map((e) => e.id)).toEqual(['gone1'])
  })
})
