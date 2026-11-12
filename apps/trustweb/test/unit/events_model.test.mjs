// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 feed-events: the pure model of the Events view (src/ext/events/events_model.ts): RSVP, map link, share to a tag. */
import { DEFAULT_MAP_URL, parseEvents, mergeEvents, mapEmbedUrl, setRsvp, buildEventList, eventShareText, shareEventToTag } from '../../src/ext/events/events_model.ts'

const TAGS = [{ id: 'iyg', colour: '#1565c0', label: 'IYG', community: true }]
const ev = (id, from, extra = {}) => ({ id, name: `Event ${id}`, from, where: 'Vienna', createdAt: 0, attended: false, ...extra })
const NOW = new Date('2026-11-10T12:00:00').getTime()

describe('events data', () => {
  it('parses junk to {} and keeps only valid RSVPs and a valid map link', () => {
    expect(parseEvents(null)).toEqual({})
    expect(parseEvents({ mapUrl: 'https://map.example/x', rsvp: { a: 'going', b: 'maybe', c: 'no', d: 3 }, x: 1 })).toEqual({ mapUrl: 'https://map.example/x', rsvp: { a: 'going', b: 'maybe' } })
    expect(parseEvents({ mapUrl: 'javascript:alert(1)' })).toEqual({})
  })
  it('merges two devices: RSVPs join, the incoming answer wins per event', () => {
    expect(mergeEvents({ rsvp: { a: 'going', b: 'maybe' } }, { rsvp: { b: 'going', c: 'maybe' }, mapUrl: 'https://m.example/' }))
      .toEqual({ rsvp: { a: 'going', b: 'going', c: 'maybe' }, mapUrl: 'https://m.example/' })
  })
})

describe('map link', () => {
  it('accepts https only, without credentials; returns the normalised link', () => {
    expect(mapEmbedUrl(' https://map.example/events ')).toBe('https://map.example/events')
    expect(mapEmbedUrl('http://map.example/')).toBeNull()
    expect(mapEmbedUrl('https://u:p@map.example/')).toBeNull()
    expect(mapEmbedUrl('javascript:alert(1)')).toBeNull()
    expect(mapEmbedUrl('')).toBeNull()
  })
})

describe('RSVP', () => {
  it('sets going or maybe; the same answer again clears it', () => {
    let d = setRsvp({}, 'a', 'going')
    expect(d.rsvp).toEqual({ a: 'going' })
    d = setRsvp(d, 'a', 'maybe')
    expect(d.rsvp).toEqual({ a: 'maybe' })
    d = setRsvp(d, 'a', 'maybe')
    expect(d.rsvp).toEqual({ a: 'none' })   // review wave 40: cleared = a mark the sync carries
  })
  it('the list shows my answer, else "going" for an event I already attend, soonest upcoming first', () => {
    const list = buildEventList([ev('late', '2026-12-01'), ev('soon', '2026-11-12', { attended: true }), ev('old', '2026-10-01')], { rsvp: { late: 'maybe' } }, NOW)
    expect(list.map((c) => [c.id, c.rsvp, c.past])).toEqual([['soon', 'going', false], ['late', 'maybe', false], ['old', null, true]])
  })
  it('does not change the app event itself', () => {
    const events = [ev('a', '2026-11-12')]
    setRsvp({}, 'a', 'going')
    expect(events[0].attended).toBe(false)
  })
})

describe('share to a tag', () => {
  it('writes one line with name, date and place', () => {
    const [c] = buildEventList([ev('a', '2026-11-12', { to: '2026-11-13' })], {}, NOW)
    expect(eventShareText(c)).toBe('Event a · 2026-11-12 – 2026-11-13 · Vienna')
  })
  it('posts it to a tag I joined through the existing group post; false otherwise', () => {
    const s = { me: { id: 'me', displayName: 'Ana' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false, zoneTags: { self: { ids: ['iyg'], stamp: 1 } } }
    const [c] = buildEventList([ev('a', '2026-11-12')], {}, NOW)
    expect(shareEventToTag(s, TAGS, c, 'iyg', NOW)).toBe(true)
    expect(s.groupPosts[0].text).toContain('Event a')
    expect(shareEventToTag({ ...s, zoneTags: undefined, groupPosts: [] }, TAGS, c, 'iyg', NOW)).toBe(false)
  })
})

describe('default events map (wave 40 small-ui-c)', () => {
  it('is the regen events map, a valid https link', () => {
    expect(DEFAULT_MAP_URL).toBe('https://andrewalan11.github.io/regen-events-map/')
    expect(mapEmbedUrl(DEFAULT_MAP_URL)).toBe(DEFAULT_MAP_URL)
  })
})
