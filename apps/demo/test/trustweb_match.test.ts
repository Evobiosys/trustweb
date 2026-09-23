/**
 * apps/trustweb's matching and gating, run inside apps/demo's suite because
 * trustweb reuses this app's matcher and gate and has no toolchain of its own.
 *
 * The decision-level half of the TrustWeb acceptance test: an English
 * inventory line "motorbike" plus an English free-text ask for it surfaces the
 * holder's consent prompt; an unrelated English ask stays silent. The browser
 * half (the real screens, over a relay) is apps/trustweb/test/e2e/acceptance.mjs.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_K } from '@resource-web/network-access/anonymity'
import { askTemplate, askTerms } from '../../trustweb/src/lexicon'
import { extractLines, guessTag } from '../../trustweb/src/notes'
import {
  Audience, LineStatus, Ring, Tag, audienceAdmits, threadsForRing, ageLabel,
} from '../../trustweb/src/model'
import type { AppState } from '../../trustweb/src/model'
import { matchTemplate } from '../src/match/lexical'
import { classifyIncomingQuery } from '../src/incoming_query'

const T0 = Date.UTC(2026, 8, 1)

function holder(): AppState {
  return {
    v: 1,
    me: { id: 'maya', displayName: 'Maya' },
    peers: [],
    log: [],
    notificationsOn: false,
    inventory: [
      { id: 'i1', text: 'Motorbike (125cc), can lend it for a weekend', audience: Audience.FriendsOfFriends, included: true, createdAt: T0 },
      { id: 'i2', text: 'Spare room in Vienna', audience: Audience.OnlyMe, included: true, createdAt: T0 },
    ],
    people: [{
      id: 'p1', name: 'Lena', context: 'coffee', ring: Ring.Friend, metAt: T0,
      lines: [
        { id: 'l1', text: 'We have a new position to fill: head of operations', tag: Tag.Opportunity, audience: Audience.Friends, status: LineStatus.Current, notedAt: T0, checkedAt: T0 },
        { id: 'l2', text: 'Looking for a flatmate in Graz', tag: Tag.Looking, audience: Audience.FriendsOfFriends, status: LineStatus.Gone, notedAt: T0, checkedAt: T0 },
      ],
    }],
  }
}

function surfaces(s: AppState, ring: Ring, ask: string): boolean {
  const { threads } = threadsForRing(s, ring)
  const match = matchTemplate(askTemplate(ask), threads)
  return classifyIncomingQuery(match, false, true).surface
}

describe('trustweb lexicon', () => {
  it('drops English and German function words and keeps content words', () => {
    expect(askTerms('Does anyone have a motorbike I could borrow this weekend?')).toContain('motorbike')
    expect(askTerms('Can anyone lend me a ladder?')).not.toContain('can')
    expect(askTerms('Can anyone lend me a ladder?')).not.toContain('lend')
    expect(askTerms('Hat jemand eine Leiter?')).toEqual(expect.arrayContaining(['leiter', 'ladder']))
  })

  it('expands synonyms', () => {
    expect(askTerms('any motorcycle around?')).toContain('motorbike')
    expect(askTerms('who is hiring?')).toContain('position')
  })

  it('never ships k=1: the template carries the shared DEFAULT_K', () => {
    expect(askTemplate('motorbike').kThreshold).toBe(DEFAULT_K)
    expect(DEFAULT_K).toBeGreaterThan(1)
  })
})

describe('trustweb acceptance (decision level)', () => {
  it('an English motorbike ask surfaces the holder consent prompt', () => {
    expect(surfaces(holder(), Ring.Friend, 'Does anyone have a motorbike I could borrow?')).toBe(true)
    expect(surfaces(holder(), Ring.Acquaintance, 'anyone got a motorcycle?')).toBe(true)
  })

  it('an unrelated English ask leaves the holder silent', () => {
    expect(surfaces(holder(), Ring.Friend, 'Does anyone know a good piano teacher?')).toBe(false)
    expect(surfaces(holder(), Ring.Friend, 'Can anyone lend me a ladder for the weekend?')).toBe(false)
  })

  it('a line shared with nobody reads as no match', () => {
    expect(surfaces(holder(), Ring.Close, 'Who has a spare room in Vienna?')).toBe(false)
  })

  it('a line for friends is invisible to an acquaintance and visible to a friend', () => {
    expect(surfaces(holder(), Ring.Friend, 'Who is hiring?')).toBe(true)
    expect(surfaces(holder(), Ring.Acquaintance, 'Who is hiring?')).toBe(false)
  })

  it('a line marked "no longer" is out of scope', () => {
    expect(surfaces(holder(), Ring.Close, 'looking for a flatmate in Graz')).toBe(false)
  })
})

describe('trustweb model', () => {
  it('audience rules', () => {
    expect(audienceAdmits(Audience.OnlyMe, Ring.Close)).toBe(false)
    expect(audienceAdmits(Audience.Friends, Ring.Acquaintance)).toBe(false)
    expect(audienceAdmits(Audience.Friends, Ring.Close)).toBe(true)
    expect(audienceAdmits(Audience.FriendsOfFriends, Ring.Acquaintance)).toBe(true)
  })

  it('age labels', () => {
    expect(ageLabel(T0, T0 + 5 * 30 * 86_400_000)).toBe('5 months ago')
    expect(ageLabel(T0, T0)).toBe('today')
  })
})

describe('trustweb note extraction', () => {
  it('picks lines and first-guess tags out of a typed note', () => {
    const lines = extractLines('Runs ops at a new AI governance org, hiring a head of ops. Knows two alt-protein founders. Suggested I talk to Jonas about grant writing')
    expect(lines.map((l) => l.tag)).toEqual([Tag.Note, Tag.Looking, Tag.Offer, Tag.Meet])
    expect(lines[0].text).toBe('Runs ops at a new AI governance org')
    expect(lines[2].text).toBe('Knows two alt-protein founders')
  })

  it('falls back to a plain note', () => {
    expect(guessTag('Great laugh')).toBe(Tag.Note)
  })
})
