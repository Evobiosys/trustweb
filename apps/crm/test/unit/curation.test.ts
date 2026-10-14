import { describe, expect, it } from 'vitest'
import { DEFAULT_NETWORK, adminNetworks, effectivePlacement, networkNames } from '../../src/curation'
import { Kind, Section, emptyPlacements } from '../../src/placement'

const DAY = 86_400_000
const now = 100 * DAY
const hidden = { person: { sections: { 'tw-fav': Section.Hidden }, order: [] }, environment: { sections: {}, order: [] } }
const curation = {
  byNetwork: { event: hidden },
  admins: [{ networkId: 'event', from: now - DAY, to: now + DAY }, { networkId: 'old', from: now - 9 * DAY, to: now - 8 * DAY }, { networkId: 'other', personId: 'p', from: 0, to: now * 2 }],
}

describe('curation', () => {
  it('admins my default network always, others only inside their period and only for me', () => {
    expect(adminNetworks(undefined, now)).toEqual([DEFAULT_NETWORK])
    expect(adminNetworks(curation, now)).toEqual([DEFAULT_NETWORK, 'event'])
    expect(adminNetworks(curation, now + 5 * DAY)).toEqual([DEFAULT_NETWORK])
  })
  it('lists every network the data names', () => {
    expect(networkNames(curation)).toEqual([DEFAULT_NETWORK, 'event', 'old', 'other'])
  })
  it('applies admin placements under my own choice', () => {
    expect(effectivePlacement(Kind.Person, emptyPlacements(), curation, now).sections['tw-fav']).toBe(Section.Hidden)
    const mine = { ...emptyPlacements(), person: { sections: { 'tw-fav': Section.Simple }, order: [] } }
    expect(effectivePlacement(Kind.Person, mine, curation, now).sections['tw-fav']).toBe(Section.Simple)
    expect(effectivePlacement(Kind.Person, emptyPlacements(), curation, now + 5 * DAY).sections['tw-fav']).toBeUndefined()
  })
})
