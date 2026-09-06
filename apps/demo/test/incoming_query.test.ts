import { describe, expect, it } from 'vitest'
import { classifyIncomingQuery } from '../src/incoming_query'
import type { MatchHit, MatchResult } from '../src/types'

/**
 * classifyIncomingQuery() is the ONE function main.ts's handleAmbientQuery()
 * calls to decide whether an ambiently-received query interrupts this device
 * (surface: true, the consent ceremony) or is answered silently (surface:
 * false, no shell()/go() call anywhere). These tests pin that decision table
 * directly -- the live-relay acceptance script (test/e2e) imports and
 * asserts on this SAME function, so a regression here is the regression that
 * matters for "a request should show up on one device and not the other".
 */

const hit = (author: string): MatchHit => ({
  threadId: 't1',
  threadTitle: 'Gruppe',
  messageIndex: 0,
  message: { ts: '2026-09-04T10:00:00Z', author, text: 'Ski, kannst du dir ausborgen', system: false },
  score: 1,
  terms: ['ski'],
  source: 'seed',
})

const NO_MATCH: MatchResult = { hits: [], distinctAuthors: 0, aboveThreshold: false }
const BELOW_K: MatchResult = { hits: [hit('marlene0')], distinctAuthors: 1, aboveThreshold: false }
const ABOVE_K: MatchResult = { hits: [hit('marlene0')], distinctAuthors: 1, aboveThreshold: true }

// B-08 (2026-09-06): a single owner-declared hit that cleared the floor via
// match/lexical.ts's bypass looks IDENTICAL to any other aboveThreshold:true
// match from classifyIncomingQuery()'s point of view -- it reads
// match.aboveThreshold as a black box and has no separate branch for how
// that became true. Pinning this literally: surfacing does not care why.
const ownDeclaredHit: MatchHit = {
  ...hit('marlene0'),
  threadId: 'inv:1',
  message: { ts: '2026-09-06T10:00:00Z', author: 'marlene0', text: 'Ich habe ein Motorrad.', system: false },
  source: 'self',
}
const ABOVE_K_VIA_BYPASS: MatchResult = { hits: [ownDeclaredHit], distinctAuthors: 1, aboveThreshold: true }

describe('classifyIncomingQuery', () => {
  it('does not surface, and logs no-match, when nothing matched', () => {
    expect(classifyIncomingQuery(NO_MATCH, false, true)).toEqual({ surface: false, outcome: 'no-match' })
  })

  it('does not surface, and logs below-k, when matched but under the anonymity floor', () => {
    expect(classifyIncomingQuery(BELOW_K, false, true)).toEqual({ surface: false, outcome: 'below-k' })
  })

  it('surfaces, with no committed outcome yet, when matched above the floor', () => {
    expect(classifyIncomingQuery(ABOVE_K, false, true)).toEqual({ surface: true, outcome: null })
  })

  it('does not surface a blocked peer even with a real match above the floor', () => {
    expect(classifyIncomingQuery(ABOVE_K, true, true)).toEqual({ surface: false, outcome: 'blocked' })
  })

  it('does not surface an unresolvable template (and logs it as no-match, not silently dropped)', () => {
    expect(classifyIncomingQuery(NO_MATCH, false, false)).toEqual({ surface: false, outcome: 'no-match' })
  })

  it('blocked wins over an unresolvable template check order is irrelevant here: both are silent', () => {
    // Documents the precedence (unresolved is checked first in the
    // implementation) without over-asserting a specific reason -- both are
    // "silent", which is the only thing that has to hold for I2/no-notify.
    const r = classifyIncomingQuery(NO_MATCH, true, false)
    expect(r.surface).toBe(false)
  })

  // cooldown.ts, 2026-09-06: muted and cooldown-blocked never surface,
  // regardless of how strong the match is -- same precedent `blocked`
  // already sets above.
  it('does not surface a muted peer even with a real match above the floor', () => {
    expect(classifyIncomingQuery(ABOVE_K, false, true, true, false)).toEqual({ surface: false, outcome: 'muted' })
  })

  it('does not surface an ask that violates the cooldown view, even with a real match above the floor', () => {
    expect(classifyIncomingQuery(ABOVE_K, false, true, false, true)).toEqual({ surface: false, outcome: 'cooldown' })
  })

  it('blocked outranks muted outranks cooldown when more than one applies at once', () => {
    expect(classifyIncomingQuery(ABOVE_K, true, true, true, true)).toEqual({ surface: false, outcome: 'blocked' })
    expect(classifyIncomingQuery(ABOVE_K, false, true, true, true)).toEqual({ surface: false, outcome: 'muted' })
  })

  it('muted/cooldownBlocked default to false, so every pre-existing call site is unaffected', () => {
    expect(classifyIncomingQuery(ABOVE_K, false, true)).toEqual({ surface: true, outcome: null })
  })

  // B-08 (2026-09-06)
  it('surfaces exactly as today when aboveThreshold:true came from the owner-declared bypass', () => {
    expect(classifyIncomingQuery(ABOVE_K_VIA_BYPASS, false, true)).toEqual({ surface: true, outcome: null })
  })
})
