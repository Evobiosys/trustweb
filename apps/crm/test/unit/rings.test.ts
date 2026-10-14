import { describe, expect, it } from 'vitest'
import { Ring } from '../../../trustweb/src/model'
import { passesFilters } from '../../src/fields'
import { OUT_OF_WEB, RING_ORDER, choiceEdits, intendingEdits, ringColor, ringOf } from '../../src/rings'

describe('rings', () => {
  it('an unknown, older "none" or "family" ring is unsorted; the order runs from the centre out', () => {
    expect(ringOf('none')).toBe('unsorted')
    expect(ringOf('family')).toBe('unsorted')
    expect(ringOf('friend')).toBe('friend')
    expect(RING_ORDER).toEqual(['close', 'friend', 'acquaintance', 'intending'])
    expect(ringColor('intending')).toBe('#a5d6a7')
  })
  it('a choice sets the ring, and the famous checkbox only where it changes', () => {
    expect(choiceEdits(Ring.Friend, {})).toEqual([['tw-ring', 'friend']])
    expect(choiceEdits(OUT_OF_WEB, {})).toEqual([['tw-ring', 'unsorted'], ['6QzDHIfrlmSz', true]])
    expect(choiceEdits(Ring.Close, { '6QzDHIfrlmSz': true })).toEqual([['tw-ring', 'close'], ['6QzDHIfrlmSz', false]])
  })
  it('out of my web keeps someone with a desire in intending; picking intending starts at 5 when no desire is set', () => {
    expect(choiceEdits(OUT_OF_WEB, { UAfC4PcYo2po: '4' })[0]).toEqual(['tw-ring', 'intending'])
    expect(choiceEdits(Ring.Intending, {}, 'd')).toEqual([['UAfC4PcYo2po', '5'], ['6A0Y1jShWqIg', 'd'], ['tw-ring', 'intending']])
    expect(choiceEdits(Ring.Intending, { UAfC4PcYo2po: '4' })).toEqual([['tw-ring', 'intending']])
  })
  it('a desire sets number, date and the intending ring unless a closer ring holds', () => {
    expect(intendingEdits(4, { 'tw-ring': 'unsorted' }, '2026-10-14')).toEqual([['UAfC4PcYo2po', '4'], ['6A0Y1jShWqIg', '2026-10-14'], ['tw-ring', 'intending']])
    expect(intendingEdits(4, { 'tw-ring': 'friend' }, '2026-10-14')).toEqual([['UAfC4PcYo2po', '4'], ['6A0Y1jShWqIg', '2026-10-14']])
    expect(intendingEdits(0, { 'tw-ring': 'intending', UAfC4PcYo2po: '4' }, '2026-10-15')).toEqual([['UAfC4PcYo2po', '0'], ['6A0Y1jShWqIg', '2026-10-15'], ['tw-ring', 'unsorted']])
    expect(intendingEdits(4, { UAfC4PcYo2po: '4' }, '2026-10-15')).toEqual([])
    expect(intendingEdits(99, {}, 'd')[0]).toEqual(['UAfC4PcYo2po', '10'])
  })
  it('a famous person with a desire to connect still shows', () => {
    const f = { hideDeceased: true, hideFamous: true, onlyConnection: false, rules: [] }
    expect(passesFilters({ '6QzDHIfrlmSz': true }, f)).toBe(false)
    expect(passesFilters({ '6QzDHIfrlmSz': true, UAfC4PcYo2po: '4' }, f)).toBe(true)
  })
})
