/**
 * Forgiving token matching (src/fuzzy.ts, wave 6 N2): written together or
 * apart, German compounds both ways, typos, plurals, synonyms, and the
 * look-alike words that must NOT match (false positives are measured here).
 */
import {
  MATCH_THRESHOLD, MAX_EXPANDED_TERMS, MAX_LINE_NEIGHBOURS, baseForm, charNgrams, editDistance, expandAskTerms,
  lineNeighbours, ngramDice, normaliseToken, scoreTokens, singular, synonymsOf, termSimilarity, typoSimilarity, typoTolerance,
} from '../../src/fuzzy.ts'

const same = (a, b) => termSimilarity(a, b) >= MATCH_THRESHOLD

describe('token basics', () => {
  it('normalises case, umlauts and punctuation', () => {
    expect(normaliseToken('  Fahrräder! ')).toBe('fahrraeder')
    expect(normaliseToken('Community-Hof')).toBe('community hof')
  })

  it('singular is conservative', () => {
    expect(singular('bicycles')).toBe('bicycle')
    expect(singular('boxes')).toBe('box')
    expect(singular('bodies')).toBe('body')
    expect(singular('glass')).toBe('glass')
    expect(singular('bus')).toBe('bus')
    expect(singular('cat')).toBe('cat')
    expect(singular('2024s')).toBe('2024s')
  })

  it('baseForm folds the German feminine form', () => {
    expect(baseForm('steuerberaterin')).toBe('steuerberater')
    expect(baseForm('steuerberaterinnen')).toBe('steuerberater')
  })

  it('synonymsOf returns the whole group or nothing', () => {
    expect(synonymsOf('Bike')).toEqual(expect.arrayContaining(['bicycle', 'bicycles', 'fahrrad']))
    expect(synonymsOf('zebra')).toEqual([])
  })
})

describe('distances', () => {
  it('edit distance counts insert, delete, substitute and a neighbour swap', () => {
    expect(editDistance('bicycle', 'bicycle', 2)).toBe(0)
    expect(editDistance('bicycle', 'bicycl', 2)).toBe(1)
    expect(editDistance('bicycle', 'bicylce', 2)).toBe(1)
    expect(editDistance('bike', 'bake', 2)).toBe(1)
    expect(editDistance('bike', 'bicycle', 2)).toBe(3)
  })

  it('abandons early beyond the limit', () => {
    expect(editDistance('abc', 'abcdefgh', 1)).toBe(2)
    expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2)
  })

  it('tolerance grows with length', () => {
    expect([3, 4, 5, 8, 9, 14].map(typoTolerance)).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('character bigrams and their dice score', () => {
    expect(charNgrams('bike').sort()).toEqual(['bi', 'ik', 'ke'])
    expect(ngramDice('night', 'nacht')).toBeLessThan(0.5)
    expect(ngramDice('steuerberater', 'steuerberater')).toBe(1)
  })
})

describe('written together or apart (the afternoon guest)', () => {
  it('Communityhof matches Community hof, in both directions', () => {
    expect(termSimilarity('Communityhof', 'Community hof')).toBeGreaterThanOrEqual(0.95)
    expect(termSimilarity('Community hof', 'Communityhof')).toBeGreaterThanOrEqual(0.95)
    expect(termSimilarity('community-hof', 'communityhof')).toBeGreaterThanOrEqual(0.95)
  })

  it('German compounds both ways', () => {
    expect(same('Steuerberater', 'Steuer Berater')).toBe(true)
    expect(same('Steuer Berater', 'Steuerberater')).toBe(true)
    expect(same('Fahrradwerkstatt', 'Fahrrad Werkstatt')).toBe(true)
  })

  it('scoreTokens sees the joined and the split form in a line', () => {
    expect(scoreTokens(['communityhof'], ['we', 'meet', 'at', 'the', 'community', 'hof'])).toBeGreaterThanOrEqual(0.95)
    expect(scoreTokens(['community', 'hof'], ['communityhof', 'tomorrow'])).toBeGreaterThanOrEqual(0.95)
    expect(scoreTokens(['steuer', 'berater'], ['steuerberater'])).toBeGreaterThanOrEqual(0.95)
  })
})

describe('typos', () => {
  it('bycicle and acountant', () => {
    expect(same('bycicle', 'bicycle')).toBe(true)
    expect(same('acountant', 'accountant')).toBe(true)
    expect(same('accountnat', 'accountant')).toBe(true)
    expect(same('steurberater', 'steuerberater')).toBe(true)
  })

  it('a longer word forgives more than a shorter one', () => {
    expect(typoSimilarity('accountnat', 'accountant')).toBeGreaterThan(typoSimilarity('ladder', 'laddre'))
    expect(typoSimilarity('steuerberatre', 'steuerberater')).toBeGreaterThan(0)
    expect(typoSimilarity('steuerbrater', 'steuerberater')).toBeGreaterThan(0)
  })

  it('two slips need the same start and end: accountant is not accounting', () => {
    expect(typoSimilarity('accountant', 'accounting')).toBe(0)
    expect(typoSimilarity('steuerberater', 'steuerberatung')).toBe(0)
    expect(typoSimilarity('communtiyhof', 'communityhof')).toBeGreaterThan(0)
  })

  it('a first-letter slip is no typo we chase', () => {
    expect(typoSimilarity('xicycle', 'bicycle')).toBe(0)
  })

  it('a misspelt synonym reaches its group (bycicle finds bike)', () => {
    expect(same('bycicle', 'bike')).toBe(true)
    expect(same('acountant', 'tax advisor')).toBe(true)
    expect(same('acountant', 'steuerberater')).toBe(true)
  })
})

describe('plural, stem, synonym', () => {
  it('plural and feminine forms', () => {
    expect(termSimilarity('bicycles', 'bicycle')).toBeCloseTo(0.9)
    expect(termSimilarity('Steuerberaterin', 'Steuerberater')).toBeCloseTo(0.9)
    expect(same('boxes', 'box')).toBe(true)
  })

  it('bicycles rank against bike and accountant against tax advisor / Steuerberater', () => {
    expect(termSimilarity('bicycles', 'bike')).toBeCloseTo(0.75)
    expect(termSimilarity('accountant', 'tax advisor')).toBeCloseTo(0.75)
    expect(termSimilarity('accountant', 'Steuerberater')).toBeCloseTo(0.75)
    expect(termSimilarity('tax advisor', 'Steuerberater')).toBeCloseTo(0.75)
  })

  it('couch and room stay together', () => {
    expect(termSimilarity('couch', 'room')).toBeCloseTo(0.75)
    expect(termSimilarity('room', 'place to stay')).toBeCloseTo(0.75)
  })
})

describe('false positives stay out', () => {
  const LOOK_ALIKES = [
    ['bike', 'bake'], ['bike', 'bite'], ['bike', 'hike'], ['room', 'roof'], ['room', 'boom'],
    ['grand', 'grant'], ['paint', 'point'], ['table', 'tablet'], ['plan', 'plant'],
    ['ladder', 'latter'], ['ladder', 'bladder'], ['drill', 'trill'], ['couch', 'touch'], ['couch', 'coach'],
    ['garden', 'harden'], ['2024', '2025'], ['b2b', 'b2c'], ['hire', 'hare'], ['funds', 'fonds'],
    ['car', 'cat'], ['loan', 'lean'], ['piano', 'pian'], ['tax', 'tux'],
    ['sneakers', 'speakers'], ['hiking', 'hiring'], ['finding', 'funding'], ['shooter', 'scooter'], ['founder', 'funder'],
    ['wohnung', 'wohnungsamt'], ['motorbike', 'motorway'], ['accountant', 'accounting'],
  ]

  it.each(LOOK_ALIKES)('%s is not %s', (a, b) => {
    expect(termSimilarity(a, b)).toBeLessThan(MATCH_THRESHOLD)
    expect(termSimilarity(b, a)).toBeLessThan(MATCH_THRESHOLD)
  })

  it('tokens under five letters never fuzz, whatever the distance', () => {
    expect(typoSimilarity('bike', 'bikr')).toBe(0)
    expect(typoSimilarity('bike', 'bikes')).toBe(0)
  })

  it('short words forgive a swap or a doubled letter, never a substitution or another omission', () => {
    expect(typoSimilarity('ladde', 'ladder')).toBe(0) // prefix of another word
    expect(typoSimilarity('shelf', 'sehlf')).toBeGreaterThan(0) // swap
    expect(typoSimilarity('shelf', 'shalf')).toBe(0) // substitution
    expect(typoSimilarity('acount', 'account')).toBeGreaterThan(0) // doubled letter
    expect(typoSimilarity('founder', 'funder')).toBe(0) // another omission, another word
    expect(typoSimilarity('bicyle', 'bicycle')).toBe(0) // known limit: a plain omission under 8 letters
  })

  it('one substitution is a typo only from nine letters', () => {
    expect(typoSimilarity('accountent', 'accountant')).toBeGreaterThan(0)
    expect(typoSimilarity('speakers', 'sneakers')).toBe(0)
  })

  it('measured: no unrelated ask word matches any unrelated line word', () => {
    const ask = ['bicycle', 'accountant', 'ladder', 'room', 'community', 'drill', 'piano', 'funding']
    const lines = ['table', 'garden', 'kitchen', 'speaker', 'weekend', 'translation', 'ukulele', 'bakery', 'ticket', 'tablet', 'bladder', 'broom', 'community']
    let hits = 0
    for (const a of ask) for (const l of lines) if (a !== l && same(a, l)) hits++
    expect(hits).toBe(0)
  })

  it('an unrelated line scores zero', () => {
    expect(scoreTokens(['bicycle'], ['spare', 'bake', 'oven', 'for', 'rent'])).toBe(0)
    expect(scoreTokens(['accountant'], ['accounting', 'course', 'tonight'])).toBe(0)
  })
})

describe('scoreTokens ranks', () => {
  const asked = ['bicycles']
  it('exact above plural above synonym', () => {
    const exact = scoreTokens(asked, ['bicycles'])
    const plural = scoreTokens(asked, ['bicycle'])
    const synonym = scoreTokens(asked, ['bike'])
    expect(exact).toBeGreaterThan(plural)
    expect(plural).toBeGreaterThan(synonym)
    expect(synonym).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
  })

  it('a typo scores below the exact word and a longer word forgives better', () => {
    const typo = scoreTokens(['bicycle'], ['bycicle'])
    expect(typo).toBeLessThan(scoreTokens(['bicycle'], ['bicycle']))
    expect(typo).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
    expect(scoreTokens(['accountant'], ['acountant'])).toBeGreaterThan(typo)
  })

  it('more matched terms rank higher, and a phrase counts once', () => {
    expect(scoreTokens(['bike', 'ladder'], ['bike', 'ladder'])).toBe(2)
    expect(scoreTokens(['bike', 'ladder'], ['bike'])).toBe(1)
    expect(scoreTokens(['tax', 'advisor'], ['steuerberater'])).toBeCloseTo(0.75)
    expect(scoreTokens(['tax', 'advisor'], ['tax', 'advisor'])).toBe(2)
  })

  it('empty input scores 0', () => {
    expect(scoreTokens([], ['bike'])).toBe(0)
    expect(scoreTokens(['bike'], [])).toBe(0)
  })
})

describe('expandAskTerms', () => {
  it('keeps the asker words first, then synonyms', () => {
    const out = expandAskTerms(['bicycles'])
    expect(out[0]).toBe('bicycles')
    expect(out).toEqual(expect.arrayContaining(['bike', 'fahrrad', 'bicycle']))
  })

  it('a long word is also offered as phrases split at every plausible place', () => {
    const out = expandAskTerms(['communityhof'])
    expect(out).toContain('community hof')
    expect(expandAskTerms(['steuerberater'])).toContain('steuer berater')
  })

  it('neighbouring words are also offered written together', () => {
    expect(expandAskTerms(['community', 'hof'])).toContain('communityhof')
    expect(expandAskTerms(['steuer', 'berater'])).toContain('steuerberater')
  })

  it('a phrase of two ask words reaches its synonyms', () => {
    expect(expandAskTerms(['tax', 'advisor'])).toEqual(expect.arrayContaining(['steuerberater', 'accountant']))
  })

  it('a look-alike of a synonym member does not import the group (sneakers, hiking, finding, shooter, founder)', () => {
    for (const w of ['sneakers', 'hiking', 'finding', 'shooter', 'founder']) {
      expect(expandAskTerms([w])).toEqual(expect.not.arrayContaining(['speakers', 'hiring', 'job', 'funding', 'scooter', 'funder']))
    }
  })

  it('a misspelt synonym reaches its group', () => {
    expect(expandAskTerms(['bycicle'])).toEqual(expect.arrayContaining(['bike', 'bicycle']))
    expect(expandAskTerms(['acountant'])).toEqual(expect.arrayContaining(['steuerberater', 'tax advisor']))
  })

  it('German compound parts of 6+ letters are offered', () => {
    expect(expandAskTerms(['wohnungssuche'])).toContain('wohnung')
  })

  it('is deterministic, deduplicated and bounded', () => {
    const words = ['communityhof', 'steuerberater', 'bicycles', 'accountant', 'fahrradwerkstatt', 'wohnungssuche', 'motorbike', 'loudspeakers', 'introduction', 'neighbourhood', 'apprenticeship', 'translation']
    const a = expandAskTerms(words)
    expect(a).toEqual(expandAskTerms(words))
    expect(new Set(a).size).toBe(a.length)
    expect(a.length).toBeLessThanOrEqual(MAX_EXPANDED_TERMS)
    expect(a.slice(0, words.length)).toEqual(words)
  })

  it('adds no digits-split noise and no tiny fragments', () => {
    const out = expandAskTerms(['2024plan', 'ab'])
    expect(out.filter((t) => t.includes(' '))).toEqual([])
  })
})

describe('lineNeighbours', () => {
  const lines = ['Community hof, Graz: seminar room free on Fridays', 'Steuerberater for small associations', 'Old bycicle, needs a new chain']

  it('finds the line spelling of a typo, a plural, a synonym and a split', () => {
    expect(lineNeighbours(['communityhof'], lines)).toContain('community hof')
    expect(lineNeighbours(['bicycles'], lines)).toContain('bycicle')
    expect(lineNeighbours(['accountant'], lines)).toContain('steuerberater')
    expect(lineNeighbours(['acountant'], lines)).toContain('steuerberater')
  })

  it('leaves out the ask words themselves and unrelated words', () => {
    const out = lineNeighbours(['bicycle'], lines)
    expect(out).not.toContain('bicycle')
    expect(out).not.toContain('chain')
  })

  it('is bounded', () => {
    const many = Array.from({ length: 300 }, (_, i) => `bicycles${String.fromCharCode(97 + (i % 26))}${i}`)
    expect(lineNeighbours(['bicycles'], many).length).toBeLessThanOrEqual(MAX_LINE_NEIGHBOURS)
  })
})

describe('-ing forms (Jakob 2026-10-13: "coach" finds "coaching")', () => {
  it('coach finds coaching, both ways, also through a plural', () => {
    expect(same('coach', 'coaching')).toBe(true)
    expect(same('Coaching', 'coach')).toBe(true)
    expect(same('coaches', 'coaching')).toBe(true)
    expect(termSimilarity('coach', 'coaching')).toBeLessThan(termSimilarity('coach', 'coaches'))
  })
  it('a dropped e and a doubled consonant', () => {
    expect(same('bake', 'baking')).toBe(true)
    expect(same('shop', 'shopping')).toBe(true)
    expect(same('cook', 'cooking')).toBe(true)
  })
  it('not where the base is another word, and not for short stems', () => {
    expect(same('even', 'evening')).toBe(false)
    expect(same('morn', 'morning')).toBe(false)
    expect(same('thing', 'th')).toBe(false)
    expect(same('bring', 'br')).toBe(false)
  })
  it('an ask for coach reaches a line that says coaching', () => {
    expect(lineNeighbours(['coach'], ['Coaching for founders'])).toContain('coaching')
    expect(scoreTokens(['coach'], ['coaching', 'for', 'founders'])).toBeGreaterThan(0)
  })
})
