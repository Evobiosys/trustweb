// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (zone-share-link): a named link per zone, the items that zone sees, the parser, revoke and expiry. */
import { highestZone, newZoneLink, parseZoneShare, revokeZoneLink, zoneItems, zoneLinkLive, zoneShareLink } from '../../src/zone_share_link.ts'
import { appendShare } from '../../src/share_sink/share_lines.ts'
import { Zone } from '../../src/share_sink/zones.ts'
import { Channel } from '../../src/model.ts'

const CONNECT = 'https://app.trustweb.one/?connect=abc123'
const NOW = new Date('2026-11-04T12:00:00Z')
const MINE = { [Channel.Signal]: 'https://signal.me/#eu/abcDEF123_-xyz' }
const TICKS = { shareOnConnect: { [Channel.Signal]: true } }

const shares = (...pairs) => pairs.reduce((l, [id, zone]) => appendShare(l, { id: `item:${id}`, scope: { zone, include: [], exclude: [] }, to: `zone:${zone}`, ts: NOW.toISOString() }), [])
const basis = (s) => ({ people: [], tags: [], shares: s })

describe('zoneItems', () => {
  const b = basis(shares(['ladder', Zone.Friend], ['bike', Zone.Acquaintance], ['boat', Zone.Close], ['all', Zone.Public]))
  it('lists what the zone sees: that zone and every outer one', () => {
    expect(zoneItems(b, [Zone.Friend], NOW).sort()).toEqual(['all', 'bike', 'ladder'])
  })
  it('several zones: the union', () => {
    expect(zoneItems(b, [Zone.Acquaintance, Zone.Close], NOW).sort()).toEqual(['all', 'bike', 'boat', 'ladder'])
  })
  it('nothing shared: nothing listed', () => {
    expect(zoneItems(basis([]), [Zone.Friend], NOW)).toEqual([])
  })
})

describe('highestZone', () => {
  it('the most intimate named', () => {
    expect(highestZone([Zone.Friend, Zone.Community, Zone.Close])).toBe(Zone.Close)
    expect(highestZone([Zone.Community])).toBe(Zone.Community)
  })
})

describe('zoneShareLink + parseZoneShare', () => {
  const link = newZoneLink('Friends link', [Zone.Friend, Zone.Community], NOW.getTime(), 'id1')
  it('round trip: zone (highest), name, items, contact, hint', () => {
    const url = zoneShareLink(CONNECT, MINE, TICKS, link, ['Ladder', 'Bike'])
    const got = parseZoneShare(new URL(url).hash, NOW.getTime())
    expect(got.zone).toBe(Zone.Friend)
    expect(got.name).toBe('Friends link')
    expect(got.items).toEqual(['Ladder', 'Bike'])
    expect(got.contact.channels[Channel.Signal]).toBe(MINE[Channel.Signal])
  })
  it('keeps the connect link in front', () => {
    expect(zoneShareLink(CONNECT, MINE, TICKS, link, []).startsWith(`${CONNECT}#`)).toBe(true)
  })
  it('a link without a zone key is no zone link; a bad zone neither; self is refused', () => {
    expect(parseZoneShare('', NOW.getTime())).toBeNull()
    expect(parseZoneShare('#si=a', NOW.getTime())).toBeNull()
    expect(parseZoneShare('#zl=nonsense', NOW.getTime())).toBeNull()
    expect(parseZoneShare('#zl=self', NOW.getTime())).toBeNull()
  })
  it('expired links parse to null', () => {
    const url = zoneShareLink(CONNECT, MINE, TICKS, link, ['x'])
    expect(parseZoneShare(new URL(url).hash, NOW.getTime() + 366 * 86_400_000)).toBeNull()
  })
  it('the name is cleaned and bounded', () => {
    const l = newZoneLink('a\u202eb' + 'x'.repeat(100), [Zone.Friend], NOW.getTime(), 'id2')
    const got = parseZoneShare(new URL(zoneShareLink(CONNECT, MINE, TICKS, l, [])).hash, NOW.getTime())
    expect(got.name).not.toMatch(/\u202e/)
    expect(got.name.length).toBeLessThanOrEqual(40)
  })
})

describe('revoke and expiry', () => {
  it('a new link lives a year; revoke ends it; the entry stays listed', () => {
    const l = newZoneLink('F', [Zone.Friend], NOW.getTime(), 'id3')
    expect(zoneLinkLive(l, NOW.getTime())).toBe(true)
    expect(zoneLinkLive(l, NOW.getTime() + 366 * 86_400_000)).toBe(false)
    const r = revokeZoneLink([l], 'id3', NOW.getTime())
    expect(r).toHaveLength(1)
    expect(zoneLinkLive(r[0], NOW.getTime())).toBe(false)
  })
  it('revoke of an unknown id changes nothing', () => {
    const l = newZoneLink('F', [Zone.Friend], NOW.getTime(), 'id3')
    expect(revokeZoneLink([l], 'nope', NOW.getTime())).toEqual([l])
  })
})
