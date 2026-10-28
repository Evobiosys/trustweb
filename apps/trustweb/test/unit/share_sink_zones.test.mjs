// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 23: the TrustZones ladder (share_sink/zones.ts). */
import { ALL_ZONES, LADDER, Zone, effectiveZone, mostIntimate, rank, zoneOfPerson } from '../../src/share_sink/zones.ts'
import { CLOSENESS_KEY, Ring } from '../../src/model.ts'

describe('share sink: zones', () => {
  it('orders the ladder outer to inner, self innermost', () => {
    expect(LADDER).toEqual(['public', 'intending', 'acquaintance', 'community', 'friend', 'close', 'closest', 'self'])
    expect(rank(Zone.Public)).toBeLessThan(rank(Zone.Intending))
    expect(rank(Zone.Closest)).toBeLessThan(rank(Zone.Self))
  })
  it('a person in several zones gets the most intimate one', () => {
    expect(mostIntimate([Zone.Community, Zone.Close])).toBe(Zone.Close)
    expect(mostIntimate([])).toBe(Zone.Public)
  })
  it('a ring switched off counts for nothing; public and self cannot be switched off', () => {
    const noClose = ALL_ZONES.filter((z) => z !== Zone.Close && z !== Zone.Public && z !== Zone.Self)
    expect(mostIntimate([Zone.Community, Zone.Close], noClose)).toBe(Zone.Community)
    expect(mostIntimate([Zone.Close], noClose)).toBe(Zone.Public)
    expect(effectiveZone(Zone.Close, noClose)).toBe(Zone.Closest)
    expect(effectiveZone(Zone.Friend, noClose)).toBe(Zone.Friend)
    expect(effectiveZone(Zone.Self, [])).toBe(Zone.Self)
  })
  it('maps the app rings onto the ladder; family by its closeness', () => {
    expect(zoneOfPerson({ ring: Ring.Close, fields: {} })).toBe(Zone.Close)
    expect(zoneOfPerson({ ring: Ring.Friend, fields: {} })).toBe(Zone.Friend)
    expect(zoneOfPerson({ ring: Ring.Acquaintance, fields: {} })).toBe(Zone.Acquaintance)
    expect(zoneOfPerson({ ring: Ring.Intending, fields: {} })).toBe(Zone.Intending)
    expect(zoneOfPerson({ ring: Ring.None, fields: {} })).toBe(Zone.Public)
    expect(zoneOfPerson({ ring: Ring.Unsorted, fields: {} })).toBe(Zone.Public)
    expect(zoneOfPerson({ ring: Ring.Family, fields: {} })).toBe(Zone.Close)
    expect(zoneOfPerson({ ring: Ring.Family, fields: { [CLOSENESS_KEY]: Ring.Acquaintance } })).toBe(Zone.Acquaintance)
  })
})
