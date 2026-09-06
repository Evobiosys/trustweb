import { describe, expect, it, vi } from 'vitest'
import { answerKeyFor, sealRelayAnswer } from '../src/answer_key'
import { derivePairKey, fromB64u, open } from '../src/crypto'
import { interpret } from '../src/gate'
import type { Peer } from '../src/state'
import type { SharedPayload } from '../src/types'
import { ANSWER_BODY_LEN } from '../src/types'

/**
 * Follow-up 1 of the C-02/F-01 crypto review (section 7.1 of
 * DEVLOG/wot-iv-review/iv-review_of-web-of-trust_report.txt): on the
 * `peer === null` path the pair key was `derivePairKey(q.qid, q.qid)`, and
 * `qid` travels in cleartext in both the QueryEnvelope and the
 * AnswerEnvelope. Anyone who saw either could recompute the key.
 *
 * Five of the six sites also forced `blocked`, so they sealed zeros. The
 * sixth -- `createRelayDispatch.resolvePayload`, demo 21's relay
 * finalisation -- never consulted `blocked` and sealed a REAL relayed
 * payload under that recomputable key.
 *
 * These tests run against the SAME functions main.ts calls (that is why
 * answer_key.ts exists as its own module: main.ts is a browser entry module
 * no test can import, and a crypto invariant asserted by proxy is not
 * asserted). The eavesdropper below is modelled with exactly the attacker's
 * own capability: the cleartext qid, and nothing else.
 */

const QID = 'q-null-peer-1'
const TEMPLATE_ID = 'ladder'

const PAYLOAD: SharedPayload = {
  from: '',
  templateId: TEMPLATE_ID,
  items: [{ text: 'Hab eine 3-Meter-Leiter im Keller.', when: 'Mitte August', context: 'Eigene Notizen' }],
}

const PEER: Peer = {
  id: 'b0000000', displayName: 'B',
  nonceSelf: 'a-nonce', noncePeer: 'b-nonce',
  connectedAt: 1_700_000_000_000, blocked: false,
}

const pairKeyFor = (p: Peer): Promise<CryptoKey> => derivePairKey(p.nonceSelf, p.noncePeer)

/** Exactly what an observer of the wire can compute: HKDF over the public qid. */
const eavesdropperKey = (qid: string): Promise<CryptoKey> => derivePairKey(qid, qid)

/** Decrypt a body with a key we hold, or null if it does not authenticate. */
async function openBody(body: string, key: CryptoKey): Promise<Uint8Array | null> {
  const combined = fromB64u(body)
  return open(key, combined.slice(0, 12), combined.slice(12))
}

describe('no-peer answers are never sealed under a key derived from the cleartext qid', () => {
  it('answerKeyFor(null) refuses: blocked, and a key an observer of the qid cannot reproduce', async () => {
    const warn = vi.fn()
    const ak = await answerKeyFor(null, QID, pairKeyFor, warn)

    expect(ak.blocked).toBe(true)
    // Logged, so the refusal is visible somewhere -- it is invisible on the
    // wire by design.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(QID)

    // Not the old key. Proven by use, not by inspection: nothing sealed
    // under it opens under HKDF("<qid>|<qid>").
    const env = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, ak)
    expect(await openBody(env.body, await eavesdropperKey(QID))).toBeNull()
  })

  it('resolvePayload\'s own sealing path, with peer === null, yields a BLOCKED ZERO envelope', async () => {
    const ak = await answerKeyFor(null, QID, pairKeyFor, () => {})
    // A real, non-empty relayed payload -- the exact input the defect
    // mishandled. The old code sealed this verbatim.
    const env = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, ak)

    const plaintext = await openBody(env.body, ak.key)
    expect(plaintext).not.toBeNull()
    expect(plaintext).toHaveLength(ANSWER_BODY_LEN)
    // The all-zero "nothing" buffer, byte for byte. `maskAnswerPlaintext`'s
    // own mask trick, forced by `blocked`.
    expect(Array.from(plaintext as Uint8Array).every((b) => b === 0)).toBe(true)
    // And nothing of the payload survives anywhere in the ciphertext.
    expect(env.body).not.toContain('Leiter')
  })

  it('a peer WITH a record still gets the real payload, so the refusal is not a blanket mute', async () => {
    const ak = await answerKeyFor(PEER, QID, pairKeyFor, () => {})
    expect(ak.blocked).toBe(false)

    const env = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, ak)
    const decoded = await interpret(env, await pairKeyFor(PEER))
    expect(decoded.outcome).toBe('shared')
    expect(decoded.shared?.items[0].text).toContain('3-Meter-Leiter')
  })

  it('THE LIVE HALF: a BLOCKED peer, who holds the real pair key, gets the all-zero plaintext', async () => {
    // `resolvePayload` never read `blocked`, and unlike the peer === null
    // case nothing downstream stopped this one: `fire()`'s guard is
    // `peer?.did && relayChannel`, and a blocked peer with a did satisfies
    // it, so the envelope was SENT -- under `pairKey(peer)`, the real key
    // that peer holds. `runSecondHopRelayCeremony` (main.ts:2411) returns
    // before `classifyIncomingQuery(match, blocked, ...)` (main.ts:2424),
    // the one filter that drops a blocked sender's query, so demo 21's
    // relay ceremony never saw the flag at all.
    const blockedPeer = { ...PEER, blocked: true }
    const ak = await answerKeyFor(blockedPeer, QID, pairKeyFor, () => {})
    expect(ak.blocked).toBe(true)

    const env = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, ak)
    // Decrypted with the key the blocked peer really has -- their own view,
    // not an approximation of it.
    const plaintext = await openBody(env.body, await pairKeyFor(blockedPeer))
    expect(plaintext).not.toBeNull()
    expect(plaintext).toHaveLength(ANSWER_BODY_LEN)
    expect(Array.from(plaintext as Uint8Array).every((b) => b === 0)).toBe(true)
    expect((await interpret(env, await pairKeyFor(blockedPeer))).outcome).toBe('nothing')

    // The regression, reconstructed: `blocked` ignored, real key. This is
    // what a blocked peer used to receive and could read.
    const oldEnv = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, { key: ak.key, blocked: false })
    const leaked = await interpret(oldEnv, await pairKeyFor(blockedPeer))
    expect(leaked.outcome).toBe('shared')
    expect(leaked.shared?.items[0].text).toContain('3-Meter-Leiter')
  })

  it('a blocked peer and a no-peer answer are indistinguishable on the wire from a shared one', async () => {
    const shared = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, await answerKeyFor(PEER, QID, pairKeyFor, () => {}))
    const blockedPeer = await answerKeyFor({ ...PEER, blocked: true }, QID, pairKeyFor, () => {})
    const blocked = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, blockedPeer)
    const noPeer = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, await answerKeyFor(null, QID, pairKeyFor, () => {}))

    // I3: same fields, same length. The no-peer envelope is still SENT --
    // an absent answer would itself announce "this device does not know you".
    for (const env of [blocked, noPeer]) {
      expect(env.body.length).toBe(shared.body.length)
      expect(Object.keys(env).sort()).toEqual(Object.keys(shared).sort())
      expect(env.qid).toBe(QID)
    }
  })

  it('the asker sees a plain "nothing", exactly as for any other blocked answer', async () => {
    const ak = await answerKeyFor(null, QID, pairKeyFor, () => {})
    const env = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, ak)
    // The asker holds pairKey(their record of us) and tries it, as always.
    // interpret() never throws on an authentication failure (crypto.ts's
    // open() swallows it), so this degrades to the same 'nothing' the four
    // indistinguishable causes already produce.
    expect((await interpret(env, await pairKeyFor(PEER))).outcome).toBe('nothing')
  })

  it('THE REGRESSION, shown both ways: the old fallback key leaked the payload to a qid-only observer', async () => {
    // What the code used to do, reconstructed exactly: key from the public
    // qid, `blocked` never consulted, real payload sealed.
    const oldKey = await derivePairKey(QID, QID)
    const oldEnv = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, { key: oldKey, blocked: false })
    const stolen = await interpret(oldEnv, await eavesdropperKey(QID))
    expect(stolen.outcome).toBe('shared')
    expect(stolen.shared?.items[0].text).toContain('3-Meter-Leiter')

    // What it does now, same inputs, through the shipped path.
    const ak = await answerKeyFor(null, QID, pairKeyFor, () => {})
    const newEnv = await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, ak)
    expect((await interpret(newEnv, await eavesdropperKey(QID))).outcome).toBe('nothing')
  })

  it('20 no-peer refusals draw 20 distinct keys, so two of them do not collide either', async () => {
    const bodies = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const ak = await answerKeyFor(null, QID, pairKeyFor, () => {})
      bodies.add((await sealRelayAnswer(QID, TEMPLATE_ID, PAYLOAD, ak)).body)
    }
    expect(bodies.size).toBe(20)
  })
})
