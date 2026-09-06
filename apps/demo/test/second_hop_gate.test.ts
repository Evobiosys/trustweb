import { describe, expect, it } from 'vitest'
import { derivePairKey, fromB64u, open } from '../src/crypto'
import { decide, maskAnswerPlaintext, sealAnswerEnvelope, truncateSharedJson } from '../src/gate'
import type { MatchHit, MatchResult, QueryEnvelope, QueryTemplate, SharedPayload } from '../src/types'
import { ANSWER_BODY_LEN } from '../src/types'

/**
 * Demo 21 (secondHop scenario, DEVLOG/handover-demo21-two-hop.md): the
 * byte-level proof the handover asks for, for A's OWN final answer to B --
 * the one hop B is actually watching. It exercises the SAME primitives
 * main.ts's `sendSecondHopFinalAnswer` calls (`maskAnswerPlaintext`,
 * `truncateSharedJson`, `sealAnswerEnvelope`), the way
 * test/e2e/call_into_the_web.mjs exercises `decide()` for the one-hop case
 * -- not a reimplementation of the construction, the actual construction.
 *
 * The five reasons B can end up with nothing, per the handover:
 *   (a) A has no second-brain note at all, or it does not match.
 *   (b) A has a matching note but chooses not to forward it.
 *   (c) A forwards it, and Jakob declines.
 *   (d) A forwards it, and Jakob has nothing (his own no-match/below-k).
 *   (e) A forwards it, and Jakob never answers within the shared deadline
 *       (unreachable, offline, or simply too slow).
 * All five must produce a BYTE-IDENTICAL PLAINTEXT and an equal-length
 * body, for the same qid and the same A<->B pair key -- proven directly
 * below, not inferred from screen text.
 *
 * UPDATED 2026-09-05 (C-02/F-01): the claim used to be byte-identical
 * CIPHERTEXT, which held only because `sealAnswerEnvelope` derived its
 * AES-GCM IV from `qid`. That deterministic IV was an AES-GCM nonce-reuse
 * hole (see gate.ts's SECURITY note) and is gone. The property that
 * actually carries I3 is unchanged and still proven here two ways:
 *   - with the IV pinned (`FIXED_IV`), the construction is byte-identical,
 *     which is the real claim about `maskAnswerPlaintext`/`truncateSharedJson`;
 *   - with the production random IV, the bodies are equal-LENGTH and decrypt
 *     to the identical all-zero plaintext.
 * A third test below pins the new requirement: two seals of the same
 * (key, qid) must NOT collide on an IV.
 */

const QID = 'qid-secondhop-proof-0001'
const TEMPLATE_ID = 'wot.freetext.ask'
/** Pinned IV, so a test can still assert on the CONSTRUCTION's bytes. */
const FIXED_IV = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

async function finalPlaintextAndEnvelope(
  payload: SharedPayload | null,
  key: CryptoKey,
  iv?: Uint8Array,
) {
  const jsonBytes = truncateSharedJson(payload ?? { from: '', templateId: TEMPLATE_ID, items: [] })
  const plaintext = maskAnswerPlaintext(Boolean(payload), jsonBytes)
  const envelope = await sealAnswerEnvelope(QID, plaintext, key, iv)
  return { plaintext, envelope }
}

describe('demo 21: A -> B final answer is byte-identical across every "nothing" cause', () => {
  it('five different nothing-causing inputs produce byte-identical plaintext AND ciphertext', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')

    // (a) no note, or note did not match -- payload never even considered.
    const noNote = await finalPlaintextAndEnvelope(null, key)

    // (b) A had an eligible note and chose not to forward -- her own local
    // decide()-equivalent path resolves 'declined' locally, but the ONLY
    // thing that reaches this function is payload === null, same as (a).
    const declinedToRelay = await finalPlaintextAndEnvelope(null, key)

    // (c) Jakob declined -- jakobDecoded.outcome !== 'shared', so payload is
    // null regardless of what Jakob's own (real, byte-padded) AnswerEnvelope
    // to A actually contained.
    const jakobDeclined = await finalPlaintextAndEnvelope(null, key)

    // (d) Jakob had nothing of his own -- same collapse.
    const jakobNoMatch = await finalPlaintextAndEnvelope(null, key)

    // (e) Jakob never answered before the shared deadline -- forwardToOwner's
    // waiter resolves null, jakobDecoded stays null, same collapse.
    const jakobTimedOut = await finalPlaintextAndEnvelope(null, key)

    const all = [noNote, declinedToRelay, jakobDeclined, jakobNoMatch, jakobTimedOut]
    for (const one of all) {
      expect(one.plaintext.length).toBe(ANSWER_BODY_LEN)
      // All-zero: tag 0x00 (nothing), zero-length JSON, zero padding --
      // maskAnswerPlaintext's mask trick makes `jsonBytes` irrelevant to the
      // output whenever wouldShare is false, so this holds regardless of
      // which of the five distinct LOCAL reasons produced payload === null.
      expect(Array.from(one.plaintext)).toEqual(new Array(ANSWER_BODY_LEN).fill(0))
    }
    // Equal LENGTH on the wire, always -- the property an observer sees.
    const bodies = all.map((one) => one.envelope.body)
    for (const body of bodies) expect(body.length).toBe(bodies[0].length)

    // And byte-identical once the IV is pinned: that isolates the
    // CONSTRUCTION (mask + truncate + frame) from the per-call nonce.
    const pinned = await Promise.all(
      all.map(() => finalPlaintextAndEnvelope(null, key, FIXED_IV)),
    )
    for (const one of pinned) expect(one.envelope.body).toBe(pinned[0].envelope.body)

    // Decrypt each independently and confirm the PLAINTEXTS are identical
    // too, not merely the ciphertext lengths -- same discipline
    // call_into_the_web.mjs's side-channel proof uses.
    for (const one of all) {
      const combined = fromB64u(one.envelope.body)
      const iv = combined.slice(0, 12)
      const ciphertext = combined.slice(12)
      const plain = await open(key, iv, ciphertext)
      expect(plain).not.toBeNull()
      expect(Array.from(plain as Uint8Array)).toEqual(new Array(ANSWER_BODY_LEN).fill(0))
    }
  })

  it('A declining to relay (main.ts\'s declineRelay, via the real decide() call, not the direct primitives) is byte-identical to the other four', async () => {
    // Mirrors declineRelay's actual call exactly: emitAnswer(q, tpl,
    // noteMatch, false, peer, ...) -> decide(). noteMatch here is a REAL
    // above-threshold hit against A's own note (not null like the other
    // four cases above), consent is false. decide() now internally reuses
    // maskAnswerPlaintext/sealAnswerEnvelope (this file's gate.ts refactor),
    // so this proves the ACTUAL declineRelay code path, not an analogy of it.
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const query: QueryEnvelope = {
      v: 1, t: 'query', from: { id: 'b0000000', displayName: 'B' },
      templateId: TEMPLATE_ID, templateVersion: 1, qid: QID, issuedAt: Date.now(),
    }
    const template: QueryTemplate = {
      id: TEMPLATE_ID, version: 1, category: 'freetext',
      title: { de: 'x', en: 'x' }, question: { de: 'x', en: 'x' },
      matchTerms: ['leiter'], boostTerms: [], excludeTerms: [], minScore: 1, kThreshold: 1,
      sensitivity: 'high', ttlSeconds: 3600,
    }
    const hit: MatchHit = {
      threadId: 'sb:note1', threadTitle: 'Eigene Notizen (über andere)', messageIndex: 0,
      message: { ts: new Date().toISOString(), author: 'A', text: 'Der Jakob hat eine Leiter.', system: false },
      score: 5, terms: ['leiter'], source: 'self',
    }
    const noteMatch: MatchResult = { hits: [hit], distinctAuthors: 1, aboveThreshold: true }

    const { outcome, envelope } = await decide({
      query, template, match: noteMatch, consent: false, blocked: false, key,
    })
    expect(outcome).toBe('declined') // A's own local audit label, per renderSecondHopRelayCard's doc comment

    const nothing = await finalPlaintextAndEnvelope(null, key)
    expect(envelope.body.length).toBe(nothing.envelope.body.length)

    // Same construction, proven at the byte level with the nonce held fixed
    // on both sides (see this file's header on why ciphertext equality
    // across two SEPARATE seals is no longer -- and must not be -- a claim).
    const pinnedDecline = await decide(
      { query, template, match: noteMatch, consent: false, blocked: false, key },
      FIXED_IV,
    )
    const pinnedNothing = await finalPlaintextAndEnvelope(null, key, FIXED_IV)
    expect(pinnedDecline.envelope.body).toBe(pinnedNothing.envelope.body)
  })

  it('a genuine relay SUCCESS produces a DIFFERENT ciphertext from every nothing cause', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const nothing = await finalPlaintextAndEnvelope(null, key)
    const shared: SharedPayload = {
      from: 'Jakob',
      templateId: TEMPLATE_ID,
      items: [{ text: 'Hab eine 3-Meter-Leiter im Keller.', when: 'Mitte August', context: 'Eigene Notizen' }],
    }
    const success = await finalPlaintextAndEnvelope(shared, key)
    expect(success.envelope.body).not.toBe(nothing.envelope.body)
    // Pinned too, so this is a claim about the PAYLOAD and not merely about
    // two random nonces differing.
    const successPinned = await finalPlaintextAndEnvelope(shared, key, FIXED_IV)
    const nothingPinned = await finalPlaintextAndEnvelope(null, key, FIXED_IV)
    expect(successPinned.envelope.body).not.toBe(nothingPinned.envelope.body)
    expect(success.plaintext[0]).toBe(1) // tag byte: shared
    expect(nothing.plaintext[0]).toBe(0) // tag byte: nothing
  })

  it('CORRECTED (DECISIONS.md D27, supersedes the former D23): the answer is ANONYMOUS -- `from` is always empty on the wire, even on a genuine relay success', async () => {
    // Earlier versions of this test asserted `parsed.from === 'Jakob'`
    // (the former named-introduction design). The owner reversed that
    // decision: main.ts's forwardToOwner strips `from` to '' before
    // building the WIRE payload, regardless of what Jakob's own answer to
    // A actually carried -- A's own LOCAL record (I6/D24) keeps the real
    // name, but that never reaches this function's input at all (see
    // `resolvePayload`'s `localFromLabel`, a SEPARATE parameter, in
    // main.ts). This test therefore builds `shared.from` as it would
    // arrive from forwardToOwner: already stripped.
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const shared: SharedPayload = {
      from: '',
      templateId: TEMPLATE_ID,
      items: [{ text: 'Hab eine 3-Meter-Leiter im Keller.', when: 'Mitte August', context: 'Eigene Notizen' }],
    }
    const { envelope } = await finalPlaintextAndEnvelope(shared, key)
    const combined = fromB64u(envelope.body)
    const plain = await open(key, combined.slice(0, 12), combined.slice(12))
    expect(plain).not.toBeNull()
    const dataLen = ((plain as Uint8Array)[1] << 8) | (plain as Uint8Array)[2]
    const json = new TextDecoder().decode((plain as Uint8Array).slice(3, 3 + dataLen))
    const parsed = JSON.parse(json) as SharedPayload
    expect(parsed.from).toBe('')
    expect(parsed.items[0].when).toBe('Mitte August') // carried verbatim, never recomputed
  })

  it('DECISIONS.md D29: a second-hop accommodation answer never carries the real ADDRESS string, only the abstraction', async () => {
    // Reproduces main.ts's forwardToOwner address-stripping exactly:
    // ACCOMMODATION_TEMPLATE_ID -> every item's text replaced with
    // accommodationAbstractText() before this function (the real sealing
    // primitives) ever sees it. This test does not import main.ts (DOM-
    // bound); it proves the PRIMITIVE-level claim -- that a plaintext built
    // from the abstraction cannot possibly contain ADDRESS, structurally,
    // regardless of what main.ts's own call site does -- and
    // test/e2e/second_hop.mjs proves the SAME claim against real wire bytes
    // that crossed the live relay, including main.ts's own call site.
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const realAddressBearingText =
      'Ja, wir sind vom 26. Oktober bis 1. November 2026 nicht da. In dieser Zeit kannst du die Wohnung nutzen: Geologengasse 12, 1030 Wien.'
    const abstractedText = 'Eine Wohnung in Wien, frei vom 26. Oktober bis 1. November 2026.'
    expect(abstractedText.includes('Geologengasse')).toBe(false) // sanity: the fixture itself must differ

    const abstracted: SharedPayload = {
      from: '',
      templateId: 'wot.vienna.geologengasse.accommodation',
      items: [{ text: abstractedText, when: 'jetzt', context: 'Kalender' }],
    }
    const { envelope } = await finalPlaintextAndEnvelope(abstracted, key)
    const combined = fromB64u(envelope.body)
    const plain = await open(key, combined.slice(0, 12), combined.slice(12))
    expect(plain).not.toBeNull()
    const plainText = new TextDecoder().decode(plain as Uint8Array)
    expect(plainText.includes('Geologengasse')).toBe(false)
    expect(plainText).not.toContain(realAddressBearingText.split(': ')[1]) // the address clause itself
  })
})
