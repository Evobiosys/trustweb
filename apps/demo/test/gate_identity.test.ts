import { beforeAll, describe, expect, it } from 'vitest'
import { decide, interpret, type GateInput } from '../src/gate'
import { derivePairKey } from '../src/crypto'
import type { MatchHit, MatchResult, QueryEnvelope, QueryTemplate } from '../src/types'

// ---------------------------------------------------------------------------
// THE test suite that decides whether this ships.
//
// The whole product claim is: the four internal "nothing" reasons
// (no-match, below-k, declined, blocked) are indistinguishable to the asker.
// Every test below drives that from a different angle: exact byte equality,
// length equality with `shared`, interpret()'s output shape, a property test
// over random inputs, and a reflection guard against a future field addition.
// ---------------------------------------------------------------------------

function makeTemplate(): QueryTemplate {
  return {
    id: 'tmpl-housing-1',
    version: 1,
    category: 'housing',
    title: { de: 'Wohnung', en: 'Housing' },
    question: { de: 'Suchst du eine Wohnung?', en: 'Looking for housing?' },
    matchTerms: ['wohnung'],
    boostTerms: ['dringend'],
    excludeTerms: ['suche'],
    minScore: 1,
    kThreshold: 2,
    sensitivity: 'medium',
    ttlSeconds: 3600,
  }
}

function makeQuery(qid: string): QueryEnvelope {
  return {
    v: 1,
    t: 'query',
    from: { id: 'asker001', displayName: 'B' },
    templateId: 'tmpl-housing-1',
    templateVersion: 1,
    qid,
    issuedAt: 1735689600000,
  }
}

function makeHit(i: number): MatchHit {
  return {
    threadId: `thread-${i}`,
    threadTitle: `Gruppe ${i}`,
    messageIndex: i,
    message: {
      ts: '2026-08-15T10:00:00Z',
      author: 'X',
      text: `Nachricht ${i}: Wohnung frei ab September, 2 Zimmer, ruhige Lage.`,
      system: false,
    },
    score: 5,
    terms: ['wohnung'],
    source: 'seed',
  }
}

function makeMatch(hitCount: number, aboveThreshold: boolean): MatchResult {
  const hits = Array.from({ length: hitCount }, (_, i) => makeHit(i))
  // The gate never recomputes the floor; it trusts what the matcher decided.
  // distinctAuthors is carried only so the shape is honest, and is deliberately
  // NOT what aboveThreshold is derived from here: these tests drive the gate
  // directly, including states a real matcher would not produce.
  const distinctAuthors = new Set(hits.map((h) => h.message.author)).size
  return { hits, distinctAuthors, aboveThreshold }
}

const FIXED_IV = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const QID = 'qid-fixed-0001'

let KEY: CryptoKey

beforeAll(async () => {
  KEY = await derivePairKey('nonce-a-fixed', 'nonce-b-fixed')
})

function baseInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    query: makeQuery(QID),
    template: makeTemplate(),
    match: makeMatch(0, false),
    consent: true,
    blocked: false,
    key: KEY,
    ...overrides,
  }
}

describe('gate byte-identity: the central privacy contract', () => {
  it('no-match, below-k, declined, blocked, cooldown, muted are byte-for-byte identical', async () => {
    const noMatchIn = baseInput({ match: makeMatch(0, false), consent: true, blocked: false })
    const belowKIn = baseInput({ match: makeMatch(1, false), consent: true, blocked: false })
    const declinedIn = baseInput({ match: makeMatch(3, true), consent: false, blocked: false })
    const blockedIn = baseInput({ match: makeMatch(5, true), consent: true, blocked: true })
    // cooldown.ts, 2026-09-06: the two NEW "nothing" reasons must collapse
    // into the exact same wire envelope as the original four -- this is the
    // whole point of gating them through `decide()` rather than dropping
    // the ask at a layer that never builds a wire message at all.
    const cooldownIn = baseInput({ match: makeMatch(4, true), consent: true, blocked: false, cooldownBlocked: true })
    const mutedIn = baseInput({ match: makeMatch(6, true), consent: true, blocked: false, muted: true })

    const rNoMatch = await decide(noMatchIn, FIXED_IV)
    const rBelowK = await decide(belowKIn, FIXED_IV)
    const rDeclined = await decide(declinedIn, FIXED_IV)
    const rBlocked = await decide(blockedIn, FIXED_IV)
    const rCooldown = await decide(cooldownIn, FIXED_IV)
    const rMuted = await decide(mutedIn, FIXED_IV)

    expect(rNoMatch.outcome).toBe('no-match')
    expect(rBelowK.outcome).toBe('below-k')
    expect(rDeclined.outcome).toBe('declined')
    expect(rBlocked.outcome).toBe('blocked')
    expect(rCooldown.outcome).toBe('cooldown')
    expect(rMuted.outcome).toBe('muted')

    const envelopes = [rNoMatch.envelope, rBelowK.envelope, rDeclined.envelope, rBlocked.envelope, rCooldown.envelope, rMuted.envelope]

    // Full JSON string equality.
    const jsonStrings = envelopes.map((e) => JSON.stringify(e))
    for (const s of jsonStrings.slice(1)) expect(s).toBe(jsonStrings[0])

    // Decoded body bytes equality (belt and braces beyond the string compare).
    const bodyBytes = envelopes.map((e) => Array.from(atobLike(e.body)))
    for (const b of bodyBytes.slice(1)) expect(b).toEqual(bodyBytes[0])
  })

  it('the shared envelope has the same length as the nothing envelope', async () => {
    const nothingIn = baseInput({ match: makeMatch(0, false) })
    const sharedIn = baseInput({ match: makeMatch(2, true), consent: true, blocked: false })

    const rNothing = await decide(nothingIn, FIXED_IV)
    const rShared = await decide(sharedIn, FIXED_IV)

    expect(rShared.outcome).toBe('shared')
    expect(rShared.envelope.body.length).toBe(rNothing.envelope.body.length)
    expect(JSON.stringify(rShared.envelope).length).toBe(JSON.stringify(rNothing.envelope).length)
  })

  it('interpret() on all six nothing envelopes returns exactly {outcome:"nothing"}', async () => {
    const inputs: GateInput[] = [
      baseInput({ match: makeMatch(0, false), consent: true, blocked: false }),
      baseInput({ match: makeMatch(1, false), consent: true, blocked: false }),
      baseInput({ match: makeMatch(3, true), consent: false, blocked: false }),
      baseInput({ match: makeMatch(5, true), consent: true, blocked: true }),
      baseInput({ match: makeMatch(4, true), consent: true, blocked: false, cooldownBlocked: true }),
      baseInput({ match: makeMatch(6, true), consent: true, blocked: false, muted: true }),
    ]

    for (const input of inputs) {
      const { envelope } = await decide(input, FIXED_IV)
      const decoded = await interpret(envelope, KEY)
      expect(decoded).toEqual({ outcome: 'nothing' })
      expect(Object.keys(decoded)).toEqual(['outcome'])
    }
  })

  it('interpret() on the shared envelope returns shared with the matched items', async () => {
    const sharedIn = baseInput({ match: makeMatch(2, true), consent: true, blocked: false })
    // Deliberately do NOT pass ivOverride here: this exercises the real,
    // production default-IV path (derived from qid) end to end.
    const { envelope, outcome } = await decide(sharedIn)
    expect(outcome).toBe('shared')
    const decoded = await interpret(envelope, KEY)
    expect(decoded.outcome).toBe('shared')
    expect(decoded.shared?.items.length).toBe(2)
  })

  it('reflection guard: AnswerEnvelope has exactly the keys v, t, qid, body', async () => {
    const { envelope } = await decide(baseInput(), FIXED_IV)
    expect(Object.keys(envelope)).toEqual(['v', 't', 'qid', 'body'])
  })

  it(
    'property: 200 random combinations collapse to the single canonical nothing envelope',
    async () => {
    const canonical = await decide(baseInput({ match: makeMatch(0, false) }), FIXED_IV)
    let sharedSeen = 0
    let nothingSeen = 0

    for (let i = 0; i < 200; i++) {
      const hitCount = Math.floor(Math.random() * 20)
      // types.ts documents MatchResult.aboveThreshold as "True when
      // hits.length >= template.kThreshold" -- a real matcher can never
      // produce aboveThreshold:true together with zero hits (kThreshold is
      // always >= 1). Keep the fuzzed input consistent with that invariant;
      // an inconsistent (0 hits, aboveThreshold:true) combination is not a
      // state decide() is ever asked to handle in practice.
      const aboveThreshold = hitCount > 0 && Math.random() < 0.5
      const consent = Math.random() < 0.5
      const blocked = Math.random() < 0.5
      // cooldown.ts, 2026-09-06: fuzz the two new reasons alongside the
      // original four -- every combination must still collapse to the SAME
      // canonical "nothing" envelope whenever any reason applies.
      const muted = Math.random() < 0.5
      const cooldownBlocked = Math.random() < 0.5

      const input = baseInput({
        match: makeMatch(hitCount, aboveThreshold),
        consent,
        blocked,
        muted,
        cooldownBlocked,
      })
      const result = await decide(input, FIXED_IV)

      const expectShared = !blocked && !muted && !cooldownBlocked && aboveThreshold && consent
      expect(result.outcome === 'shared').toBe(expectShared)

      if (result.outcome === 'shared') {
        sharedSeen++
        continue
      }
      nothingSeen++
      expect(result.envelope.body).toBe(canonical.envelope.body)
      expect(JSON.stringify(result.envelope)).toBe(JSON.stringify(canonical.envelope))
    }

    // Sanity: the random sweep actually exercised both branches.
    expect(sharedSeen).toBeGreaterThan(0)
    expect(nothingSeen).toBeGreaterThan(0)
    },
    30_000,
  )

  it('truncates an oversized shared payload without changing envelope size, and flags it', async () => {
    const manyHits = 200 // far more than fits in ANSWER_BODY_LEN once serialised
    const sharedIn = baseInput({ match: makeMatch(manyHits, true), consent: true, blocked: false })
    const nothingIn = baseInput({ match: makeMatch(0, false) })

    const rShared = await decide(sharedIn, FIXED_IV)
    const rNothing = await decide(nothingIn, FIXED_IV)

    expect(rShared.outcome).toBe('shared')
    expect(rShared.envelope.body.length).toBe(rNothing.envelope.body.length)

    const decoded = await interpret(rShared.envelope, KEY)
    expect(decoded.outcome).toBe('shared')
    expect(decoded.shared).toBeDefined()
    expect(decoded.shared!.items.length).toBeLessThan(manyHits)
    // The truncation flag lives on the object at runtime even though
    // DecodedAnswer.shared is typed as plain SharedPayload.
    expect((decoded.shared as { tr?: 1 }).tr).toBe(1)
  })
})

// base64url decode without depending on crypto.ts's own fromB64u, so this
// test doesn't silently pass just because both sides share one bug.
function atobLike(b64u: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const lookup: Record<string, number> = {}
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet[i]] = i
  const byteLen = Math.floor((b64u.length * 6) / 8)
  const out = new Uint8Array(byteLen)
  let bitBuffer = 0
  let bitCount = 0
  let outIdx = 0
  for (const ch of b64u) {
    const val = lookup[ch]
    if (val === undefined) throw new Error(`invalid b64u char ${ch}`)
    bitBuffer = (bitBuffer << 6) | val
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      out[outIdx++] = (bitBuffer >> bitCount) & 0xff
    }
  }
  return out
}
