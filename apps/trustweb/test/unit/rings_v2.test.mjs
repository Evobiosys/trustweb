/** Wave 7: family (purple, with a closeness), unsorted (grey); neither is a ring a line's audience names. */
import { Audience, Ring, RING_COLORS, ringColor, ringSlot, audienceAdmits } from '../../src/model.ts'

describe('rings v2', () => {
  it('places family by its closeness, Close when unset', () => {
    expect(ringSlot({ ring: Ring.Family })).toBe(Ring.Close)
    expect(ringSlot({ ring: Ring.Family, fields: { 'tw-closeness': 'friend' } })).toBe(Ring.Friend)
    expect(ringSlot({ ring: Ring.Friend })).toBe(Ring.Friend)
  })
  it('colours: green rings, purple family, grey unsorted', () => {
    expect(ringColor({ ring: Ring.Close })).toBe(RING_COLORS.close)
    expect(ringColor({ ring: Ring.Family, fields: { 'tw-closeness': 'acquaintance' } })).toBe(RING_COLORS.family.acquaintance)
    expect(ringColor({ ring: Ring.Unsorted })).toBe(RING_COLORS.unsorted)
  })
  it('family and unsorted admit nothing (fail closed)', () => {
    for (const r of [Ring.Family, Ring.Unsorted, Ring.None]) expect(audienceAdmits(Audience.FriendsOfFriends, r)).toBe(false)
  })
})
