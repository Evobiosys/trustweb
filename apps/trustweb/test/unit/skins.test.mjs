// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 network-skin: the skin registry, choosing and persisting a skin, and the rings-like dot look. */
import { DEFAULT_SKIN, SKINS, chooseSkin, skinOf, skinsFor } from '../../src/skins.ts'
import { dotLook } from '../../src/network_dots.ts'
import { Ring } from '../../src/model.ts'

describe('skins registry', () => {
  it('lists the rings-like "trustweb" (default) and "classic-network", both built in for the network', () => {
    expect(SKINS.map((k) => k.id)).toEqual(['trustweb', 'classic-network'])
    expect(DEFAULT_SKIN).toBe('trustweb')
    for (const k of SKINS) {
      expect(k.builtIn).toBe(true)
      expect(k.applies).toEqual(['network'])
      expect(k.name.length).toBeGreaterThan(0)
      expect(k.description.length).toBeGreaterThan(0)
    }
    expect(SKINS[1].name).toBe('Classic network')
  })
  it('skinsFor filters by surface', () => {
    expect(skinsFor('network')).toHaveLength(2)
    expect(skinsFor('chat')).toHaveLength(0)
  })
  it('skinOf: nothing stored = default; an unknown id falls back to the default', () => {
    expect(skinOf({}).id).toBe('trustweb')
    expect(skinOf({ skin: 'classic-network' }).id).toBe('classic-network')
    expect(skinOf({ skin: 'gone' }).id).toBe('trustweb')
  })
  it('chooseSkin stores the id under the record key skin; the default clears it; unknown ids are ignored', () => {
    const s = {}
    chooseSkin(s, 'classic-network')
    expect(s.skin).toBe('classic-network')
    chooseSkin(s, 'nope')
    expect(s.skin).toBe('classic-network')
    chooseSkin(s, 'trustweb')
    expect('skin' in s).toBe(false)
  })
})

describe('dotLook (rings-like dots)', () => {
  it('uses the ring colour, the capital initial, and dark ink on the pale rungs', () => {
    expect(dotLook('anna', Ring.Closest).fill).toBe('#A63A00')
    expect(dotLook('anna', Ring.Closest).initial).toBe('A')
    expect(dotLook('anna', Ring.Closest).ink).toBe('#fff')
    expect(dotLook('x', Ring.Intending).ink).toBe('#3a1d00')
    expect(dotLook('', Ring.Close).initial).toBe('?')
  })
  it('the centre (no tier) gets the gradient style of the you dot, and the rings dot size', () => {
    const me = dotLook('Jakob', undefined)
    expect(me.fill).toBeNull()
    expect(me.you).toBe(true)
    expect(me.radius).toBe(20)
    expect(dotLook('a', Ring.Close).radius).toBe(21)
  })
})
