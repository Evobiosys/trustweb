import { describe, expect, it } from 'vitest'
import { Ring } from '../../../trustweb/src/model'
import { OUT_OF_WEB, RING_COLORS, choiceEdits, ringColor, ringOf } from '../../src/rings'

describe('rings', () => {
  it('an unknown or older "none" ring is unsorted', () => {
    expect(ringOf('none')).toBe('unsorted')
    expect(ringOf('friend')).toBe('friend')
  })
  it('family takes its purple from the closeness, close friend by default', () => {
    expect(ringColor('family')).toBe(RING_COLORS.family.close)
    expect(ringColor('family', { 'tw-closeness': 'friend' })).toBe(RING_COLORS.family.friend)
    expect(ringColor('close')).toBe(RING_COLORS.close)
  })
  it('a choice sets the ring and the checkboxes that follow it, only where they change', () => {
    expect(choiceEdits('family', {})).toEqual([['tw-ring', 'family'], ['LNlpliq4GdNI', true], ['tw-closeness', 'close']])
    expect(choiceEdits(Ring.Friend, { LNlpliq4GdNI: true, 'tw-closeness': 'friend' })).toEqual([['tw-ring', 'friend'], ['LNlpliq4GdNI', false]])
    expect(choiceEdits(Ring.Intending, {})).toEqual([['tw-ring', 'intending'], ['FcZJGS5EH2on', true]])
    expect(choiceEdits(OUT_OF_WEB, {})).toEqual([['tw-ring', 'unsorted'], ['6QzDHIfrlmSz', true]])
  })
})
