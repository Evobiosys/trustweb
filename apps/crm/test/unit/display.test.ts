import { describe, expect, it } from 'vitest'
import { shownName } from '../../src/display'
import { favLink } from '../../src/person_view'

describe('email never shown as text', () => {
  it('shows the local part with the envelope glyph for an email or calendar id', () => {
    expect(shownName('lena@example.org')).toBe('✉ lena')
    expect(shownName('c_9f3a@group.calendar.google.com')).toBe('✉ c_9f3a')
    expect(shownName('Lena Hofbauer')).toBe('Lena Hofbauer')
  })
  it('keeps the address in the favourite link tooltip only', () => {
    const l = favLink({}, { 'tw-fav': 'email', Bxw7k4FWptqp: 'lena@example.org' })
    expect(l).toMatchObject({ symbol: '✉', title: 'lena@example.org' })
  })
})
