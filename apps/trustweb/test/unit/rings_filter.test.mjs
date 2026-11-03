// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29: the ring filter lists every trust ring in ladder order, all shown by default; the state saves in uiRings. */
import { describe, expect, it } from 'vitest'
import { Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'
import { FILTER_RINGS, ringShown, setRingShown } from '../../src/rings_filter.ts'
import { inZones } from '../../src/trustzones.ts'

describe('rings filter', () => {
  it('lists every ring of the ladder exactly once, innermost first, with the existing labels', () => {
    expect(FILTER_RINGS).toEqual([Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted])
    expect(new Set(FILTER_RINGS).size).toBe(FILTER_RINGS.length)
    expect(FILTER_RINGS.map((r) => S.ringLabel[r])).toEqual(['Closest few', 'Close friends and allies', 'Friends & acquainted community members', 'Acquaintances', 'Intending', 'Not yet sorted'])
  })
  it('every ring is shown by default', () => {
    for (const r of FILTER_RINGS) expect(ringShown({}, r)).toBe(true)
  })
  it('unchecking saves in uiRings and hides only that ring; checking again restores it', () => {
    const s = {}
    setRingShown(s, Ring.Friend, false)
    expect(s.uiRings.hidden).toEqual([Ring.Friend])
    expect(FILTER_RINGS.filter((r) => !ringShown(s, r))).toEqual([Ring.Friend])
    setRingShown(s, Ring.Friend, false)
    expect(s.uiRings.hidden).toEqual([Ring.Friend])
    setRingShown(s, Ring.Friend, true)
    expect(ringShown(s, Ring.Friend)).toBe(true)
  })
  it('the old two checkboxes carry over: acquaintances:false hides, unsorted:false hides', () => {
    expect(ringShown({ uiRings: { acquaintances: false } }, Ring.Acquaintance)).toBe(false)
    expect(ringShown({ uiRings: { unsorted: false } }, Ring.Unsorted)).toBe(false)
    expect(ringShown({ uiRings: { unsorted: true } }, Ring.Unsorted)).toBe(true)
  })
  it('inZones drops the people of a hidden ring', () => {
    const mk = (id, ring) => ({ id, ring, fields: {} })
    const people = [mk('a', Ring.Close), mk('b', Ring.Intending)]
    const s = {}
    setRingShown(s, Ring.Intending, false)
    expect(inZones(people, s).map((p) => p.id)).toEqual(['a'])
  })
  it('the add picker hint is a string', () => {
    expect(S.addPresetHint).toContain('Preset: Acquaintances')
  })
})
