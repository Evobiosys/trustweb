// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { Ring, RINGS } from '../../src/model'
import { S } from '../../src/strings'

describe('trust zones ladder', () => {
  it('orders the rings closest > close > friend > acquaintance > public', () => {
    expect(RINGS).toEqual([Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending])
  })
  it('labels the zones with the ladder words', () => {
    expect(RINGS.map((r) => S.ringLabel[r])).toEqual(['Closest', 'Close friends and allies', 'Friends and community members', 'Acquaintances', 'Public'])
    expect(S.ringHint[Ring.Closest]).toBe('the few you would call at 3 am')
    expect(S.ringHint[Ring.Intending]).toBe('not yet connected; what you share publicly')
  })
})
