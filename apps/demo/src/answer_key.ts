/**
 * WHICH KEY AN ANSWER IS SEALED UNDER, AND WHAT HAPPENS WHEN THERE IS NONE.
 *
 * Extracted from main.ts for the same reason answer_log.ts was (see that
 * module's doc comment): main.ts is a browser entry module with top-level
 * side effects and no test can import it, so an invariant that only lives
 * there can only ever be asserted by proxy. This one is a CRYPTO invariant
 * and deserves better than a proxy -- the app calls exactly the functions
 * test/answer_key.test.ts calls.
 *
 * THE DEFECT THIS EXISTS TO CLOSE (2026-09-06, follow-up 1 of the C-02/F-01
 * crypto review -- DEVLOG/wot-iv-review/iv-review_of-web-of-trust_report.txt
 * section 7.1). Six call sites in main.ts spelled the no-peer fallback
 * inline:
 *
 *     const key = peer ? await pairKey(peer) : await derivePairKey(q.qid, q.qid)
 *
 * `qid` travels in CLEARTEXT inside both the QueryEnvelope and the
 * AnswerEnvelope, so `HKDF("<qid>|<qid>", "ew-demo-pair-v1")` is computable
 * by anyone who ever saw either -- a relay operator, a passive network
 * observer, anyone who photographs the QR rung (`encodeForQr` is plain
 * `JSON.stringify`, wire.ts:23, no transport encryption at all). A key
 * derived from public data is not a key. This is a confidentiality break
 * fully independent of C-02's nonce reuse, and C-02's random-IV fix did not
 * touch it.
 *
 * It was also useless in the same breath, which is the argument that settles
 * the design question: the ASKER derives `pairKey(their own record of us)`
 * and NEVER the qid key, so an envelope sealed under the fallback was
 * unreadable by the one party entitled to read it and readable by every
 * eavesdropper. Strictly worse than both alternatives at once.
 *
 * THE RULE: no payload is ever sealed under a key derivable from public
 * data. Five of the six sites already forced `blocked: peer?.blocked ?? true`
 * alongside the fallback, so they sealed the all-zero "nothing" plaintext and
 * lost no content -- but they still handed an observer a clean decrypt, which
 * tells that observer "this device holds no record of the asker", an I3
 * distinction told to exactly the wrong party. The sixth,
 * `createRelayDispatch.resolvePayload`, never consulted `blocked` at all and
 * sealed `maskAnswerPlaintext(Boolean(payload), ...)` -- a REAL relayed
 * payload -- under the recomputable key.
 *
 * THE FIX, AND WHY NOT AN EPHEMERAL-MATERIAL KEY. The task that commissioned
 * this offered a second option: derive the no-peer key from the relay wrap's
 * ephemeral material instead. No legitimate path needs it. Every send is
 * already gated on a peer -- `createRelayDispatch`'s `fire()` returns early
 * on `!(peer?.did && relayChannel)` BEFORE it sends, and each of
 * `emitAnswer`'s four transport rungs guards on `peer?.did` or on a channel a
 * pairing ceremony opened. A payload sealed with no peer therefore has no
 * recipient by construction, so there is nothing to keep working. Refusing is
 * the smaller, checkable rule.
 *
 * "Refuse" means `{ key: <throwaway>, blocked: true }`, NOT "skip the seal".
 * A same-shape, same-length, undecryptable envelope still goes out, because
 * an ABSENT answer would itself announce "this device does not know you" --
 * the very distinction the four indistinguishable "nothing" causes exist to
 * hide (I3, types.ts's AnswerEnvelope doc comment). The wire format is
 * unchanged in both directions: same fields, same `body` length, and
 * `interpret()` already returns `{outcome:'nothing'}` on any authentication
 * failure without throwing (crypto.ts's `open` swallows it), which is
 * byte-for-byte the experience an asker already has for a genuinely blocked
 * answer.
 */
import { randomThrowawayKey } from './crypto'
import { maskAnswerPlaintext, sealAnswerEnvelope, truncateSharedJson } from './gate'
import type { Peer } from './state'
import type { AnswerEnvelope, SharedPayload } from './types'

/**
 * The key an answer goes out under, plus whether this device is refusing to
 * say anything under it. The two travel together on purpose: a caller cannot
 * take the key and forget the `blocked` flag, which is precisely the mistake
 * `resolvePayload` made.
 */
export interface AnswerKey {
  key: CryptoKey
  /**
   * `true` for a peer this device blocked, AND for no peer at all. Callers
   * pass it straight into `decide({ blocked })` or into `sealRelayAnswer`
   * below; either way it forces `maskAnswerPlaintext(false, ...)`, the fixed
   * length all-zero buffer every other "nothing" cause converges on.
   */
  blocked: boolean
}

/**
 * `pairKey` lives in main.ts because it needs that module's `state` and its
 * lazily-minted relay identity. Injected rather than imported so this module
 * stays free of main.ts (which would be a cycle, and untestable besides).
 */
export type PairKeyFor = (p: Peer) => Promise<CryptoKey>

/** See this module's doc comment. `qid` is used for the log line only. */
export async function answerKeyFor(
  peer: Peer | null,
  qid: string,
  pairKeyFor: PairKeyFor,
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<AnswerKey> {
  if (peer) return { key: await pairKeyFor(peer), blocked: Boolean(peer.blocked) }
  // Logged, not silent: the refusal is otherwise invisible by design (it
  // produces the same bytes as every other "nothing"), and a query from a
  // sender this device holds no record for is worth seeing while demoing.
  // `qid` only -- never the sender's name, never the question text.
  warn('[wot] no peer record for query ' + qid + ': answering blocked, under a throwaway key')
  return { key: await randomThrowawayKey(), blocked: true }
}

/**
 * Seal a relayed second-hop answer. The one place `createRelayDispatch`'s
 * payload-bearing ending builds its bytes, so the `!ak.blocked` conjunct
 * below cannot be dropped at one call site and kept at another.
 *
 * `truncateSharedJson` runs on the real payload whether or not the mask will
 * discard it, exactly as `gate.ts`'s `decide()` does: the "always do the full
 * work" discipline that keeps the timing flat (gate.ts's module doc).
 */
export async function sealRelayAnswer(
  qid: string,
  templateId: string,
  payload: SharedPayload | null,
  ak: AnswerKey,
): Promise<AnswerEnvelope> {
  const jsonBytes = truncateSharedJson(payload ?? { from: '', templateId, items: [] })
  const plaintext = maskAnswerPlaintext(!ak.blocked && Boolean(payload), jsonBytes)
  return sealAnswerEnvelope(qid, plaintext, ak.key)
}
