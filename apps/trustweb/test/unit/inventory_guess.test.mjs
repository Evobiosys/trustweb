// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 wabridge-ingest: item guesses from simple verb-object patterns, on invented sentences. */
import { guessItems } from '../../src/inventory_guess.ts'

const titles = (texts) => guessItems(texts).map((g) => `${g.need ? 'need' : 'offer'}:${g.title}`)

describe('guessItems (de)', () => {
  it('kann ich dir ... leihen / verleihe -> offer', () => {
    expect(titles(['Kann ich dir den Bohrer leihen?'])).toEqual(['offer:Bohrer'])
    expect(titles(['Ich verleihe meine Leiter gern.'])).toEqual(['offer:meine Leiter gern'])
  })
  it('hast du ein / brauche / suche -> need', () => {
    expect(titles(['Hast du eine Schubkarre?'])).toEqual(['need:Schubkarre'])
    expect(titles(['Ich brauche einen Hänger am Samstag'])).toEqual(['need:Hänger am Samstag'])
    expect(titles(['Suche Anhängerkupplung für Sonntag, danke'])).toEqual(['need:Anhängerkupplung für Sonntag'])
  })
})

describe('guessItems (en)', () => {
  it('I can lend -> offer; do you have / looking for / need a -> need', () => {
    expect(titles(['I can lend you a ladder.'])).toEqual(['offer:ladder'])
    expect(titles(['Do you have a tent?'])).toEqual(['need:tent'])
    expect(titles(['looking for a roof box, any idea?'])).toEqual(['need:roof box'])
    expect(titles(['I need a van next week'])).toEqual(['need:van next week'])
  })
})

describe('guessItems (limits)', () => {
  it('finds nothing in plain talk, empty text or empty list', () => {
    expect(guessItems(['Wie geht es dir?', '', 'See you at 8'])).toEqual([])
    expect(guessItems([])).toEqual([])
  })
  it('keeps each title short and drops repeats', () => {
    const g = guessItems(['Hast du eine Bohrmaschine?', 'hast du eine bohrmaschine?', 'I need a ' + 'very '.repeat(30) + 'long thing'])
    expect(g.filter((x) => x.title.toLowerCase() === 'bohrmaschine')).toHaveLength(1)
    for (const x of g) expect(x.title.length).toBeLessThanOrEqual(40)
  })
})
