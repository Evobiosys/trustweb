/**
 * Forgiving matching through the REAL matcher (N2): the afternoon guest's
 * "Communityhof" / "Community hof", typos, plurals and synonyms must surface
 * the holder's consent prompt; look-alike words must stay silent. The pure
 * token tests live in apps/trustweb/test/unit/fuzzy.test.mjs.
 */
import { describe, expect, it } from 'vitest'
import { askTemplate, askTerms, forgivingAskTemplate, lineTextsOf } from '../../trustweb/src/lexicon'
import { MAX_EXPANDED_TERMS, MAX_LINE_NEIGHBOURS } from '../../trustweb/src/fuzzy'
import { Audience, LineStatus, Ring, Tag, threadsForRing } from '../../trustweb/src/model'
import type { AppState } from '../../trustweb/src/model'
import { matchTemplate } from '../src/match/lexical'
import { classifyIncomingQuery } from '../src/incoming_query'

const T0 = Date.UTC(2026, 9, 8)

function holder(...lines: string[]): AppState {
  return {
    v: 1,
    me: { id: 'maya', displayName: 'Maya' },
    peers: [],
    log: [],
    notificationsOn: false,
    inventory: lines.map((text, i) => ({ id: `i${i}`, text, audience: Audience.FriendsOfFriends, included: true, createdAt: T0 })),
    people: [],
  }
}

/** Static template: what the wire-free default gives. */
function surfaces(s: AppState, ask: string): boolean {
  const { threads } = threadsForRing(s, Ring.Friend)
  return classifyIncomingQuery(matchTemplate(askTemplate(ask), threads), false, true).surface
}

/** Template widened with the holder's own line vocabulary (the hook for net.ts / peer.ts). */
function surfacesForgiving(s: AppState, ask: string): boolean {
  const { threads } = threadsForRing(s, Ring.Friend)
  const tpl = forgivingAskTemplate(ask, lineTextsOf(threads))
  return classifyIncomingQuery(matchTemplate(tpl, threads), false, true).surface
}

describe('written together or apart', () => {
  it('"Communityhof" finds a line that says "Community hof"', () => {
    const s = holder('Seminar room at the Community hof, free on Fridays')
    expect(surfaces(s, 'Is there a room in the Communityhof?')).toBe(true)
    expect(surfaces(s, 'Communityhof')).toBe(true)
  })

  it('"Community hof" finds a line that says "Communityhof"', () => {
    const s = holder('Event space at the Communityhof in Graz')
    expect(surfaces(s, 'anything at the Community hof?')).toBe(true)
    expect(surfaces(s, 'Community-Hof')).toBe(true)
  })

  it('German compounds both ways', () => {
    expect(surfaces(holder('Ich kenne einen guten Steuerberater in Graz'), 'Kennt jemand einen Steuer Berater?')).toBe(true)
    expect(surfaces(holder('Gute Steuer Berater Adresse in Wien'), 'Steuerberater gesucht')).toBe(true)
  })
})

describe('typos, plurals, synonyms', () => {
  it('a misspelt ask word reaches the right line (bycicle, acountant)', () => {
    expect(surfaces(holder('Old bike, needs a new chain'), 'Does anyone have a bycicle?')).toBe(true)
    expect(surfaces(holder('Steuerberaterin in Graz, takes new clients'), 'I need an acountant')).toBe(true)
  })

  it('a misspelling in the holder line is met through the line vocabulary', () => {
    const s = holder('Old bycicle, needs a new chain')
    expect(surfaces(s, 'Does anyone have a bicycle?')).toBe(false)
    expect(surfacesForgiving(s, 'Does anyone have a bicycle?')).toBe(true)
  })

  it('bicycles ranks into bike, accountant into tax advisor and Steuerberater', () => {
    expect(surfaces(holder('Bike for the weekend'), 'bicycles?')).toBe(true)
    expect(surfaces(holder('Tax advisor, small associations'), 'accountant')).toBe(true)
    expect(surfaces(holder('Steuerberater in Wien'), 'accountant')).toBe(true)
    expect(surfaces(holder('Accountant for associations'), 'tax advisor')).toBe(true)
  })

  it('couch and room still find each other', () => {
    expect(surfaces(holder('Couch free in March'), 'a room for the weekend')).toBe(true)
  })
})

describe('look-alikes stay silent', () => {
  const CASES: [string, string][] = [
    ['Bake sale on Saturday, bring a cake', 'Does anyone have a bike?'],
    ['Grant writing workshop in March', 'Is there a grand piano I could use?'],
    ['Accounting course tonight', 'I need an accountant'],
    ['Plant sale in the garden', 'Does anyone have a plan for Friday?'],
    ['Latter days of the project plan', 'Can anyone lend me a ladder?'],
    ['Touch typing lessons', 'Is there a couch?'],
    ['Roof repair, Saturday', 'Is there a room?'],
  ]

  it.each(CASES)('%s  vs  %s', (line, ask) => {
    expect(surfaces(holder(line), ask)).toBe(false)
    expect(surfacesForgiving(holder(line), ask)).toBe(false)
  })
})

describe('look-alikes of synonym members stay silent (the acceptance holder)', () => {
  /** The holder of trustweb_match.test.ts: a Loudspeakers line and Lena's job line. */
  function acceptanceHolder(): AppState {
    const s = holder('Loudspeakers', 'Scooter for rent, 20 euro a day', 'Grant writing workshop in March')
    s.people = [{
      id: 'p1', name: 'Lena', context: 'coffee', ring: Ring.Friend, metAt: T0,
      lines: [{ id: 'l1', text: 'We have a new position to fill: head of operations', tag: Tag.Opportunity, audience: Audience.Friends, status: LineStatus.Current, notedAt: T0, checkedAt: T0 }],
    }]
    return s
  }

  it.each([
    'Anyone selling sneakers?',
    'Anyone going hiking this weekend?',
    'Anyone good at finding mushrooms?',
    'Know a good photo shooter?',
    'Is the founder around?',
  ])('%s', (ask) => {
    expect(surfaces(acceptanceHolder(), ask)).toBe(false)
    expect(surfacesForgiving(acceptanceHolder(), ask)).toBe(false)
  })

  it('and the real ones still surface', () => {
    expect(surfaces(acceptanceHolder(), 'Anyone selling speakers?')).toBe(true)
    expect(surfaces(acceptanceHolder(), 'Anyone hiring?')).toBe(true)
    expect(surfaces(acceptanceHolder(), 'who has a bycicle or a scooter')).toBe(true)
  })
})

describe('known limits', () => {
  it('a function word reached through a plural is dropped ("news" is not "new")', () => {
    expect(askTerms('any news about the flat?')).not.toContain('new')
    expect(askTerms('goods weeks uses')).toEqual(expect.not.arrayContaining(['good', 'week', 'use']))
  })

  // The exact matcher checks a phrase with String.includes, without word boundaries, so a split
  // phrase of a long ask word ("works hop" of "workshop") also fires inside "works hopefully".
  // it.fails documents the class: when match/lexical.ts gains word-boundary phrases this test
  // starts passing the wrong way round and must be flipped to a plain expect(...).toBe(false).
  it.fails('KNOWN: a split phrase fires inside a longer word', () => {
    expect(surfaces(holder('Everything works hopefully by Friday'), 'workshop')).toBe(false)
  })

  it('splits stop after ten per word, so a late joint of a very long compound is not offered', () => {
    const phrases = askTerms('Gemeinschaftsgartenverein').filter((t) => t.includes(' '))
    expect(phrases.length).toBeLessThanOrEqual(10)
  })
})

describe('the old behaviour stays', () => {
  it('every term the exact lexicon gave is still there', () => {
    expect(askTerms('any motorcycle around?')).toEqual(expect.arrayContaining(['motorcycle', 'motorbike', 'moped']))
    expect(askTerms('Hat jemand eine Leiter?')).toEqual(expect.arrayContaining(['leiter', 'ladder']))
    expect(askTerms('Can anyone lend me a ladder?')).not.toContain('can')
  })

  it('an ask of function words still yields no terms and the shared k floor', () => {
    expect(askTerms('Can anyone help me?')).toEqual([])
    expect(askTemplate('Can anyone help me?').kThreshold).toBeGreaterThan(1)
  })

  it('stopwords never come back in as line neighbours', () => {
    const tpl = forgivingAskTemplate('bicycles', ['The bikes and the hikes'])
    expect(tpl.matchTerms).not.toContain('the')
  })
})

describe('lineTextsOf', () => {
  it('lists the text of every line of the threads, nothing else', () => {
    const { threads } = threadsForRing(holder('Bike for the weekend', 'Couch free in March'), Ring.Friend)
    expect(lineTextsOf(threads).sort()).toEqual(['Bike for the weekend', 'Couch free in March'])
    expect(lineTextsOf([])).toEqual([])
  })
})

describe('size caps', () => {
  it('the static template stays within MAX_EXPANDED_TERMS even for a long ask', () => {
    const long = 'Communityhof Steuerberater Fahrradwerkstatt Wohnungssuche Motorrad Lautsprecher Einführung Nachbarschaft Ausbildung Übersetzung Gemeinschaftsgarten Werkzeugverleih'
    expect(askTemplate(long).matchTerms.length).toBeLessThanOrEqual(MAX_EXPANDED_TERMS)
  })

  it('the line-widened template adds at most MAX_LINE_NEIGHBOURS', () => {
    const many = Array.from({ length: 200 }, (_, i) => `bicycles${String.fromCharCode(97 + (i % 26))}${i}`)
    const base = askTemplate('bicycles').matchTerms.length
    expect(forgivingAskTemplate('bicycles', many).matchTerms.length).toBeLessThanOrEqual(base + MAX_LINE_NEIGHBOURS)
  })

  it('the wire is untouched: the template id and version stay', () => {
    const t = forgivingAskTemplate('bycicle', ['bike'])
    expect(t.id).toBe(askTemplate('bycicle').id)
    expect(t.version).toBe(1)
  })
})
