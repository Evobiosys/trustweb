import { describe, expect, it } from 'vitest'
import { decide, interpret, type GateInput } from '../src/gate'
import { derivePairKey } from '../src/crypto'
import { threadsInScope } from '../src/state'
import type { DeviceState } from '../src/state'
import type {
  InventoryItem,
  MatchHit,
  MatchResult,
  Profile,
  QueryEnvelope,
  QueryTemplate,
} from '../src/types'

/**
 * The profile privacy rule from the handover, stated twice because it can be
 * broken in two different places:
 *
 *  1. A profile field could leak into the MATCH CORPUS -- someone folds
 *     `profile.bio` into inventoryThreads() so "her bio is matchable too",
 *     which would make it reachable via match.hits without ever touching
 *     gate.ts. Caught by the corpus test below, same idiom as
 *     match_lexical.test.ts's "content can never appear in a hit".
 *  2. A profile field could leak into the ENVELOPE -- someone adds a
 *     `profile` (or a stray field) to GateInput/SharedPayload as a shortcut
 *     around the consent gate. Caught by the @ts-expect-error compile-time
 *     check and the wire-shape reflection guard below, both mirroring
 *     gate_identity.test.ts's "reflection guard" test.
 *
 * This build wires NEITHER path: gate.ts's GateInput has no `profile` slot,
 * and inventoryThreads() only ever reads InventoryItem, never Profile. These
 * tests exist to keep it that way on purpose, not by omission.
 */

function baseState(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    me: { id: 'marlene0', displayName: 'Marlene' },
    threads: [],
    peers: [],
    profile: { displayName: 'Marlene', bio: '', neighbourhood: '', languages: [] },
    inventory: [],
    queryLog: [],
    ...overrides,
  }
}

function entry(text: string, included: boolean): InventoryItem {
  return { id: 'inv-1', text, createdAt: '2026-08-15T10:00:00.000Z', included }
}

function makeTemplate(overrides: Partial<QueryTemplate> = {}): QueryTemplate {
  return {
    id: 'tmpl-housing-1',
    version: 1,
    category: 'housing',
    title: { de: 'Wohnung', en: 'Housing' },
    question: { de: 'Suchst du eine Wohnung?', en: 'Looking for housing?' },
    matchTerms: ['wohnung'],
    boostTerms: [],
    excludeTerms: [],
    minScore: 1,
    kThreshold: 7,
    sensitivity: 'medium',
    ttlSeconds: 3600,
    ...overrides,
  }
}

function makeQuery(qid: string): QueryEnvelope {
  return {
    v: 1,
    t: 'query',
    from: { id: 'asker001', displayName: 'Nora' },
    templateId: 'tmpl-housing-1',
    templateVersion: 1,
    qid,
    issuedAt: 1735689600000,
  }
}

function makeHit(threadId: string, author: string): MatchHit {
  return {
    threadId,
    threadTitle: 'Eigene Notizen',
    messageIndex: 0,
    message: { ts: '2026-08-15T10:00:00Z', author, text: 'Wohnung wird bald frei bei uns im Haus.', system: false },
    score: 5,
    terms: ['wohnung'],
    source: 'seed',
  }
}

const FIXED_IV = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const QID = 'qid-fixed-profile-0001'

describe('a profile field cannot reach the requester without explicit consent', () => {
  it('is never in the match corpus, even alongside an inventory entry that IS', async () => {
    const SENTINEL = 'GEHEIM-BIO-SENTINEL-9f3'
    const s = baseState({
      profile: { displayName: 'Marlene', bio: SENTINEL, neighbourhood: SENTINEL, languages: [SENTINEL] },
      inventory: [entry('Hab eine Bohrmaschine daheim, kannst sie dir ausborgen.', true)],
    })
    const scope = threadsInScope(s)
    // Positive control first: prove the corpus is not simply empty, which
    // would make the negative assertion below vacuous.
    expect(scope.length).toBeGreaterThan(0)
    expect(JSON.stringify(scope)).not.toContain(SENTINEL)
  })

  it('GateInput has no profile field -- compile-time guard', async () => {
    const key = await derivePairKey('nonce-a-fixed', 'nonce-b-fixed')
    const profile: Profile = { displayName: 'Marlene', bio: 'x', neighbourhood: 'x', languages: [] }
    // GateInput must not accept a profile passthrough: the only content that
    // may reach an AnswerEnvelope is `match.hits`, built once, unconditionally,
    // in gate.ts's buildSharedJsonBytes (see gate.ts's module doc). If the
    // suppressed error just below stops firing, GateInput was widened to
    // accept a way around that -- fix the widening, do not delete this line.
    const leaking: GateInput = {
      query: makeQuery(QID),
      template: makeTemplate(),
      match: { hits: [], distinctAuthors: 0, aboveThreshold: false },
      consent: true,
      blocked: false,
      key,
      // @ts-expect-error GateInput has no `profile` field, see comment above.
      profile,
    }
    void leaking
  })

  it('a shared payload has exactly the documented WirePayload keys -- no profile-shaped field', async () => {
    const key = await derivePairKey('nonce-a-fixed', 'nonce-b-fixed')
    const match: MatchResult = { hits: [makeHit('inv:x', 'Marlene')], distinctAuthors: 1, aboveThreshold: true }
    const { envelope } = await decide({
      query: makeQuery(QID),
      template: makeTemplate(),
      match,
      consent: true,
      blocked: false,
      key,
    })
    const decoded = await interpret(envelope, key)
    expect(decoded.outcome).toBe('shared')
    expect(Object.keys(decoded.shared!).sort()).toEqual(['from', 'items', 'templateId'])
  })

  it('below-k with ONLY an inventory hit is byte-identical to the canonical nothing envelope', async () => {
    // An inventory entry contributes exactly one author (see
    // state.ts/inventoryThreads' doc comment), so a template with a
    // production-realistic kThreshold can never be cleared by inventory
    // content alone -- this must collapse to the same indistinguishable
    // "nothing" as any other below-k case, not a special inventory-only one.
    const key = await derivePairKey('nonce-a-fixed', 'nonce-b-fixed')
    const template = makeTemplate({ kThreshold: 7 })
    const query = makeQuery(QID)

    const belowK: MatchResult = { hits: [makeHit('inv:x', 'Marlene')], distinctAuthors: 1, aboveThreshold: false }
    const canonicalNothing: MatchResult = { hits: [], distinctAuthors: 0, aboveThreshold: false }

    const rBelowK = await decide({ query, template, match: belowK, consent: true, blocked: false, key }, FIXED_IV)
    const rCanonical = await decide(
      { query, template, match: canonicalNothing, consent: true, blocked: false, key },
      FIXED_IV,
    )

    expect(rBelowK.outcome).toBe('below-k')
    expect(JSON.stringify(rBelowK.envelope)).toBe(JSON.stringify(rCanonical.envelope))

    const decoded = await interpret(rBelowK.envelope, key)
    expect(decoded).toEqual({ outcome: 'nothing' })
  })
})
