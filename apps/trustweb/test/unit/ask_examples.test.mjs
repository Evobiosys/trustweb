// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Ask sheet example with the owner's city (wave 25); absent city = Vienna. */
import { DEFAULT_CITY, askCity, spareRoomExample } from '../../src/ask_examples.ts'
import { askWebIcon, recordIcon, recordGlyph } from '../../src/icons/ask_web.ts'

describe('ask examples', () => {
  it('defaults to Vienna when the city is absent or blank', () => {
    expect(DEFAULT_CITY).toBe('Vienna')
    expect(askCity(undefined)).toBe('Vienna')
    expect(askCity('   ')).toBe('Vienna')
  })
  it('uses the trimmed city and caps it at 40 characters', () => {
    expect(askCity('  Graz ')).toBe('Graz')
    expect(askCity('x'.repeat(60))).toHaveLength(40)
  })
  it('appends the city to the spare-room example', () => {
    expect(spareRoomExample(undefined)).toBe('Who has a spare room in Vienna?')
    expect(spareRoomExample('Linz')).toBe('Who has a spare room in Linz?')
  })
})

describe('ask and record icons', () => {
  it('rings variant adds three arcs right of the person; plain has none', () => {
    const rings = askWebIcon('rings')
    const plain = askWebIcon('plain')
    expect(rings.match(/data-ask-arc/g)).toHaveLength(3)
    expect(plain).not.toContain('data-ask-arc')
  })
  it('draws one head arc: no second person behind', () => {
    for (const v of ['rings', 'plain']) {
      const svg = askWebIcon(v)
      expect(svg.match(/<circle/g)).toHaveLength(1)
      expect(svg).not.toContain('M9.6 6.4')
    }
  })
  it('person-with-microphone glyph only while recording solo', () => {
    expect(recordGlyph(true, true)).toBe('solo')
    expect(recordGlyph(true, false)).toBe('mic')
    expect(recordGlyph(false, true)).toBe('mic')
    expect(recordGlyph(false, false)).toBe('mic')
  })
  it('both carry the question-mark badge and a 24 px grid', () => {
    for (const v of ['rings', 'plain']) {
      const svg = askWebIcon(v)
      expect(svg).toContain('viewBox="0 0 24 24"')
      expect(svg).toContain('data-ask-q')
    }
  })
  it('record icon is a person with a microphone', () => {
    const svg = recordIcon()
    expect(svg).toContain('data-rec-person')
    expect(svg).toContain('data-rec-mic')
  })
})
