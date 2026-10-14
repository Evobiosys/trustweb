import { describe, expect, it } from 'vitest'
import { parseSuggestions } from '../../src/suggestions'

describe('ring suggestions', () => {
  it('reads valid entries and gives odd fields their neutral value', () => {
    const s = parseSuggestions(JSON.stringify({
      a: { ring: 'friend', family: true, intending: 3, reason: 'met often' }, b: { ring: 'family', intending: 99 }, c: 5, d: null,
    }))
    expect(s).toEqual({
      a: { ring: 'friend', family: true, intending: 3, reason: 'met often' },
      b: { ring: 'unsorted', family: false, intending: 10, reason: '' },
    })
  })
  it('close_friend reads as close', () => {
    expect(parseSuggestions('{"a":{"ring":"close_friend"}}').a.ring).toBe('close')
  })
  it('a missing or broken file is no suggestions', () => {
    expect(parseSuggestions(null)).toEqual({})
    expect(parseSuggestions('{nope')).toEqual({})
    expect(parseSuggestions('[1]')).toEqual({})
  })
})
