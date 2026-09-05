import { describe, expect, it } from 'vitest'
import { derivePairKey, fromB64u, open } from '../src/crypto'
import type { GateInput } from '../src/gate'
import { decide, interpret, maskAnswerPlaintext, sealAnswerEnvelope, truncateSharedJson } from '../src/gate'
import type { MatchHit, MatchResult, QueryEnvelope, QueryTemplate, SharedPayload } from '../src/types'
import { ANSWER_BODY_LEN } from '../src/types'

/**
 * C-02 / F-01 (2026-09-05): the AES-GCM IV on the answer-sealing path must
 * be RANDOM, never a function of `qid`.
 *
 * Why this file exists rather than a comment: `sealAnswerEnvelope` used to
 * compute `iv = SHA-256(qid)[0..12]` while the key is `pairKey(peer)` --
 * a pure function of the PAIR, not of the query. So every seal for one
 * (pair key, qid) shared one AES-GCM nonce, and a second seal for the same
 * pair and qid with a DIFFERENT plaintext is a catastrophic nonce reuse:
 * keystream reuse plus GHASH authentication-key recovery.
 *
 * That second seal is reachable in the shipped code, three ways, none of
 * which any test previously forbade:
 *   1. RELAY REDELIVERY. `relay.ts` deliberately leaves a wire unacked when
 *      it cannot be handled, and skips the ack when the socket closed while
 *      `handleWire` was still running, "so the relay redelivers it on the
 *      next authenticated drain". Nothing anywhere dedupes `qid` on the
 *      answering side, so the same query is answered again -- against a
 *      corpus, a second-brain note, a block flag and a human that may all
 *      have changed in between.
 *   2. RE-ANSWER. `main.ts`'s consent ceremony (`finish`) has no once-only
 *      guard on its yes/no buttons, unlike `createRelayDispatch`'s
 *      `dispatched` flag; a second tap re-enters `decide()` for the same
 *      qid and peer with the opposite `consent`.
 *   3. NO-PEER RELAY HOP. `sealAnswerEnvelope`'s callers fall back to
 *      `derivePairKey(q.qid, q.qid)` when there is no peer record, making
 *      key AND IV both pure functions of a `qid` that travels in cleartext.
 * `test/e2e/second_hop.mjs` leg 7 performs sequence 1 against a LIVE relay
 * today: two answers, one qid, one pair key.
 *
 * The amplification that makes this a break and not a style point: every
 * "nothing" answer is an ALL-ZERO plaintext by construction
 * (`maskAnswerPlaintext(false, ...)`). Under one nonce,
 * C_nothing XOR C_shared = P_shared exactly -- total recovery of the shared
 * payload, which is the one thing gate.ts exists to hide.
 */

const TEMPLATE_ID = 'wot.freetext.ask'
const QID = 'qid-iv-review-0001'

const TEMPLATE: QueryTemplate = {
  id: TEMPLATE_ID, version: 1, category: 'freetext',
  title: { de: 'x', en: 'x' }, question: { de: 'x', en: 'x' },
  matchTerms: ['leiter'], boostTerms: [], excludeTerms: [], minScore: 1, kThreshold: 1,
  sensitivity: 'high', ttlSeconds: 3600,
}

const QUERY: QueryEnvelope = {
  v: 1, t: 'query', from: { id: 'b0000000', displayName: 'B' },
  templateId: TEMPLATE_ID, templateVersion: 1, qid: QID, issuedAt: 1_700_000_000_000,
}

function makeMatch(hitCount: number, aboveThreshold: boolean): MatchResult {
  const hits: MatchHit[] = Array.from({ length: hitCount }, (_, i) => ({
    threadId: `t${i}`, threadTitle: 'Chat', messageIndex: i,
    message: { ts: '2026-08-15T10:00:00.000Z', author: `A${i}`, text: 'Ich hab eine Leiter.', system: false },
    score: 5, terms: ['leiter'],
  }))
  return { hits, distinctAuthors: hitCount, aboveThreshold }
}

const SHARED: SharedPayload = {
  from: '',
  templateId: TEMPLATE_ID,
  items: [{ text: 'Hab eine 3-Meter-Leiter im Keller.', when: 'Mitte August', context: 'Eigene Notizen' }],
}

function sealNothing(key: CryptoKey, iv?: Uint8Array) {
  const jsonBytes = truncateSharedJson({ from: '', templateId: TEMPLATE_ID, items: [] })
  return sealAnswerEnvelope(QID, maskAnswerPlaintext(false, jsonBytes), key, iv)
}

function sealShared(key: CryptoKey, iv?: Uint8Array) {
  return sealAnswerEnvelope(QID, maskAnswerPlaintext(true, truncateSharedJson(SHARED)), key, iv)
}

/** The IV as it actually travels: the first 12 bytes of the framed body. */
function ivOf(body: string): Uint8Array {
  return fromB64u(body).slice(0, 12)
}

/** The old, removed scheme: SHA-256(qid) truncated to 12 bytes. */
async function legacyIvFromQid(qid: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(qid))
  return new Uint8Array(digest).slice(0, 12)
}

describe('C-02: the answer-envelope IV is random, never derived from qid', () => {
  it('two seals of the SAME (key, qid) use different IVs and produce different ciphertext', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')

    const first = await sealNothing(key)
    const second = await sealNothing(key)

    // Same key, same qid, same plaintext -- and still a fresh nonce.
    expect(Array.from(ivOf(second.body))).not.toEqual(Array.from(ivOf(first.body)))
    expect(second.body).not.toBe(first.body)
    // Equal length, though: the wire-visible shape must not move.
    expect(second.body.length).toBe(first.body.length)
  })

  it('20 seals of one (key, qid) yield 20 distinct IVs', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const env = await sealNothing(key)
      seen.add(Array.from(ivOf(env.body)).join(','))
    }
    expect(seen.size).toBe(20)
  })

  it('the IV is NOT SHA-256(qid)[0..12] any more', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const legacy = Array.from(await legacyIvFromQid(QID))
    const env = await sealNothing(key)
    expect(Array.from(ivOf(env.body))).not.toEqual(legacy)
  })

  it(
    'THE BREAK, reproduced against the old scheme and shown closed under the new one: ' +
    'a "nothing" and a "shared" answer for one (key, qid) must not share a nonce',
    async () => {
      const key = await derivePairKey('a-nonce', 'b-nonce')
      const legacyIv = await legacyIvFromQid(QID)

      // What the deterministic scheme produced: both seals on ONE nonce.
      const oldNothing = await sealNothing(key, legacyIv)
      const oldShared = await sealShared(key, legacyIv)
      expect(Array.from(ivOf(oldNothing.body))).toEqual(Array.from(ivOf(oldShared.body)))

      // And that is a total break, not a theoretical one: because the
      // "nothing" plaintext is all-zero, XOR-ing the two ciphertexts
      // recovers the shared plaintext EXACTLY, with no key material at all.
      const ctNothing = fromB64u(oldNothing.body).slice(12, 12 + ANSWER_BODY_LEN)
      const ctShared = fromB64u(oldShared.body).slice(12, 12 + ANSWER_BODY_LEN)
      const recovered = new Uint8Array(ANSWER_BODY_LEN)
      for (let i = 0; i < ANSWER_BODY_LEN; i++) recovered[i] = ctNothing[i] ^ ctShared[i]

      const truePlain = maskAnswerPlaintext(true, truncateSharedJson(SHARED))
      expect(Array.from(recovered)).toEqual(Array.from(truePlain))
      expect(new TextDecoder().decode(recovered)).toContain('3-Meter-Leiter')

      // Under the shipped path, the two seals no longer share a nonce, so
      // the same XOR recovers nothing.
      const newNothing = await sealNothing(key)
      const newShared = await sealShared(key)
      expect(Array.from(ivOf(newNothing.body))).not.toEqual(Array.from(ivOf(newShared.body)))

      const nCt = fromB64u(newNothing.body).slice(12, 12 + ANSWER_BODY_LEN)
      const sCt = fromB64u(newShared.body).slice(12, 12 + ANSWER_BODY_LEN)
      const junk = new Uint8Array(ANSWER_BODY_LEN)
      for (let i = 0; i < ANSWER_BODY_LEN; i++) junk[i] = nCt[i] ^ sCt[i]
      expect(Array.from(junk)).not.toEqual(Array.from(truePlain))
      expect(new TextDecoder().decode(junk)).not.toContain('3-Meter-Leiter')
    },
  )

  it('scenario: relay redelivery (same query answered twice, corpus changed in between)', async () => {
    // Sequence 1 from this file's header, at the level gate.ts owns: the
    // SAME qid and the SAME pair key, sealed once with nothing to say and
    // once with something, exactly as a redelivered query would be after a
    // matching message arrived between the two deliveries.
    const key = await derivePairKey('a-nonce', 'b-nonce')

    const firstDelivery = await decide({
      query: QUERY, template: TEMPLATE, match: makeMatch(0, false), consent: true, blocked: false, key,
    })
    const secondDelivery = await decide({
      query: QUERY, template: TEMPLATE, match: makeMatch(3, true), consent: true, blocked: false, key,
    })

    expect(firstDelivery.outcome).toBe('no-match')
    expect(secondDelivery.outcome).toBe('shared')
    expect(Array.from(ivOf(firstDelivery.envelope.body)))
      .not.toEqual(Array.from(ivOf(secondDelivery.envelope.body)))
  })

  it('scenario: re-answer (decline then accept, one qid, one peer)', async () => {
    // Sequence 2: the consent ceremony has no once-only guard, so the same
    // qid can be answered "no" and then "yes".
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const base: GateInput = {
      query: QUERY, template: TEMPLATE, match: makeMatch(3, true), consent: false, blocked: false, key,
    }
    const declined = await decide(base)
    const accepted = await decide({ ...base, consent: true })

    expect(declined.outcome).toBe('declined')
    expect(accepted.outcome).toBe('shared')
    expect(Array.from(ivOf(declined.envelope.body)))
      .not.toEqual(Array.from(ivOf(accepted.envelope.body)))
  })

  it('scenario: two holders answering one qid under one pair key still get distinct IVs', async () => {
    // The `derivePairKey(q.qid, q.qid)` fallback makes the key itself a
    // function of qid, so two devices can genuinely land on the same key.
    // A random IV is what keeps that from also being a nonce collision.
    // (The key derivation itself is a SEPARATE defect -- see the report.)
    const keyA = await derivePairKey(QID, QID)
    const keyB = await derivePairKey(QID, QID)
    const a = await sealShared(keyA)
    const b = await sealNothing(keyB)
    expect(Array.from(ivOf(a.body))).not.toEqual(Array.from(ivOf(b.body)))
  })

  it('injected IV: sealAnswerEnvelope uses the IV it is handed, verbatim, at offset 0', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const iv = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 255, 128])
    const env = await sealAnswerEnvelope(QID, maskAnswerPlaintext(false, truncateSharedJson({ from: '', templateId: TEMPLATE_ID, items: [] })), key, iv)
    expect(Array.from(ivOf(env.body))).toEqual(Array.from(iv))

    // Pinned on both sides, the output is reproducible -- what the
    // byte-identity tests in gate_identity/second_hop_gate rely on.
    const again = await sealNothing(key, iv)
    expect(again.body).toBe(env.body)
  })

  it('injected IV via decide(): the same pinning works through the production entry point', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const iv = new Uint8Array([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144])
    const input: GateInput = {
      query: QUERY, template: TEMPLATE, match: makeMatch(2, true), consent: true, blocked: false, key,
    }
    const one = await decide(input, iv)
    const two = await decide(input, iv)
    expect(Array.from(ivOf(one.envelope.body))).toEqual(Array.from(iv))
    expect(two.envelope.body).toBe(one.envelope.body)
  })

  it('BACKWARD COMPATIBILITY: an envelope sealed under the OLD deterministic IV still decrypts', async () => {
    // The IV has always been carried in the body (`iv || ciphertext`) and
    // `interpret()` has always read it back off the wire rather than
    // recomputing it from qid -- so randomising the IV needs no version
    // byte and no new field. This test pins that: a body built exactly the
    // way the pre-fix code built it must still round-trip.
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const legacyIv = await legacyIvFromQid(QID)

    const legacyShared = await sealShared(key, legacyIv)
    expect(Array.from(ivOf(legacyShared.body))).toEqual(Array.from(legacyIv))

    const decoded = await interpret(legacyShared, key)
    expect(decoded.outcome).toBe('shared')
    expect(decoded.shared?.items[0].text).toContain('3-Meter-Leiter')

    const legacyNothing = await sealNothing(key, legacyIv)
    expect(await interpret(legacyNothing, key)).toEqual({ outcome: 'nothing' })

    // And a NEW random-IV envelope decrypts identically -- both formats are
    // simultaneously readable, which is what "compatible" has to mean here.
    const fresh = await sealShared(key)
    expect((await interpret(fresh, key)).outcome).toBe('shared')
  })

  it('I3 is unchanged: nothing and shared bodies stay equal length under random IVs', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    for (let i = 0; i < 8; i++) {
      const nothing = await sealNothing(key)
      const shared = await sealShared(key)
      expect(shared.body.length).toBe(nothing.body.length)
      expect(JSON.stringify(shared).length).toBe(JSON.stringify(nothing).length)
    }
  })

  it('every nothing-cause still decrypts to the same all-zero plaintext, random IV or not', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const causes: GateInput[] = [
      { query: QUERY, template: TEMPLATE, match: makeMatch(0, false), consent: true, blocked: false, key },
      { query: QUERY, template: TEMPLATE, match: makeMatch(1, false), consent: true, blocked: false, key },
      { query: QUERY, template: TEMPLATE, match: makeMatch(3, true), consent: false, blocked: false, key },
      { query: QUERY, template: TEMPLATE, match: makeMatch(5, true), consent: true, blocked: true, key },
    ]
    for (const input of causes) {
      const { envelope } = await decide(input)
      const combined = fromB64u(envelope.body)
      const plain = await open(key, combined.slice(0, 12), combined.slice(12))
      expect(plain).not.toBeNull()
      expect(Array.from(plain as Uint8Array)).toEqual(new Array(ANSWER_BODY_LEN).fill(0))
    }
  })
})
