/**
 * Wave 6h: forgiving matching, Jakob's list (2026-10-08 22:59: "not just lexical search; no case sensitivity; and no spaces; and '-'
 * doesn't matter ... any other ways to make it easier before using an LLM?"). One table, through the real path an incoming ask takes
 * (cascade.ts askSources, net.ts matchAsk, apps/demo's incoming_query.ts surface rule), the same folding on both sides.
 */
import { askSources } from '../../src/cascade.ts'
import { matchAsk } from '../../src/net.ts'
import { classifyIncomingQuery } from '../../../demo/src/incoming_query.ts'
import { askTerms, foldForMatch, stripAskFrame } from '../../src/lexicon.ts'
import { Audience, LineStatus, Ring, Tag } from '../../src/model.ts'

const record = (lines) => ({
  v: 1, me: { id: 'me', displayName: 'Me' }, peers: [], people: [], log: [], notificationsOn: false,
  inventory: lines.map((text, i) => ({ id: `l${i}`, text, audience: Audience.FriendsOfFriends, included: true, createdAt: 1 })),
})
const surfaces = (line, ask) => {
  const { threads } = askSources(record([line]), Ring.Acquaintance, 0)
  return classifyIncomingQuery(matchAsk(ask, threads), false, true).surface
}

// [line, ask, should it reach the person?]
const TABLE = [
  // case
  ['Tech setup', 'tech setup', true],
  ['Tech setup', 'TECH SETUP', true],
  ['tech setup', 'Tech Setup', true],
  // spaces
  ['Tech setup', 'techsetup', true],
  ['Techsetup for a home office', 'tech setup', true],
  ['Tech setup', 'Techsetups', true],
  // hyphens
  ['Tech setup', 'tech-setup', true],
  ['Tech-Setup', 'tech setup', true],
  ['Tech-Setup', 'techsetup', true],
  ['Techsetup', 'tech-setup', true],
  // umlauts and accents
  ['Bücherregal', 'Buecherregal', true],
  ['Buecherregal', 'bücherregal', true],
  ['Café crème machine', 'cafe creme machine', true],
  ['Cafe machine', 'café', true],
  ['Ski touring gear', 'Skí', true],
  // plurals
  ['Bicycles', 'bicycle', true],
  ['Ladder', 'ladders', true],
  // phrases written together or apart
  ['Homeoffice desk', 'home office', true],
  ['Home office desk', 'homeoffice', true],
  ['Home-office desk', 'home office', true],
  // the ask's frame does not count
  ['Tax advisor in Vienna', 'Is there anyone who could recommend a tax advisor?', true],
  ['Drill', "I'm looking for a drill", true],
  ['Drill', 'Hat jemand eine Bohrmaschine?', true],
  // synonyms (grown in 6h)
  ['Laptop to lend', 'notebook computer', true],
  ['Beamer for talks', 'projector', true],
  ['Zelt für vier', 'tent', true],
  ['Tech setup for a home office', 'home office equipment', true],
  // and not too forgiving
  ['Speakers', 'sneakers', false],
  ['Tech setup', 'technique', false],
  ['Ladder', 'leather', false],
  ['Tent', 'talent', false],
  ['Tech setup', 'does anyone have something', false],
]

describe('his examples, one row each', () => {
  it.each(TABLE)('line %j, ask %j: reaches the person = %s', (line, ask, expected) => {
    expect(surfaces(line, ask)).toBe(expected)
  })
})

describe('the same folding on both sides', () => {
  it('folds case, umlauts, accents, hyphens and joins', () => {
    expect(foldForMatch('Tech-Setup')).toBe(foldForMatch('tech setup'))
    expect(foldForMatch('Bücher')).toBe('buecher')
    expect(foldForMatch('BÜCHER')).toBe('buecher')
    expect(foldForMatch('Straße')).toBe('strasse')
    expect(foldForMatch('Café Crème')).toBe('cafe creme')
    expect(foldForMatch('')).toBe('')
  })
})

describe('the ask frame', () => {
  it('drops the framing words, keeps the thing', () => {
    expect(stripAskFrame("Does anyone know a good tax advisor?")).toMatch(/tax advisor/)
    expect(stripAskFrame('Does anyone know a good tax advisor?')).not.toMatch(/anyone|know/)
    expect(stripAskFrame("I'm looking for a drill")).toBe('drill')
    expect(stripAskFrame('Kennt jemand einen Steuerberater?')).toBe('steuerberater')
    expect(stripAskFrame('drill')).toBe('drill')
  })
  it('an ask made only of its frame keeps nothing (no prompt for it)', () => {
    expect(askTerms('does anyone have something')).toEqual([])
  })
  it('two neighbouring words also count written together (phrase n-grams, fuzzy.ts joinedNeighbours; the line side pairs its words in lineNeighbours)', () => {
    expect(askTerms('home office')).toEqual(expect.arrayContaining(['home', 'office', 'homeoffice']))
  })
})

describe("a line's category as match words", () => {
  const withPerson = (text, tag) => ({
    ...record([]),
    people: [{ id: 'p1', name: 'Anna', context: '', ring: Ring.Friend, metAt: 1, lines: [{ id: 'n1', text, tag, audience: Audience.FriendsOfFriends, status: LineStatus.Current, notedAt: 1, checkedAt: 1 }] }],
  })
  const hits = (s, ask) => {
    const { threads, refs } = askSources(s, Ring.Acquaintance, 0)
    const m = matchAsk(ask, threads)
    return classifyIncomingQuery(m, false, true).surface ? m.hits.map((h) => refs.get(h.threadId)) : []
  }
  it('an opportunity line answers "any job opportunities?", and what is shared is the line alone', () => {
    const got = hits(withPerson('Studio in the 7th looks for a part-time designer', Tag.Opportunity), 'any job opportunities?')
    expect(got.map((r) => r.text)).toEqual(['Studio in the 7th looks for a part-time designer'])
  })
  it('a talent line answers "talent"', () => {
    expect(hits(withPerson('Great with kids and music', Tag.Talent), 'talent').length).toBe(1)
  })
  it('a plain note does not take a category word', () => {
    expect(hits(withPerson('Studio in the 7th', Tag.Note), 'job')).toEqual([])
  })
})
