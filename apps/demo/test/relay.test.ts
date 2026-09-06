import { describe, expect, it } from 'vitest'
import {
  buildOuterWire,
  createRelayChannel,
  decryptEnvelope,
  encryptEnvelope,
  parseOuterWire,
} from '../src/relay'
import type { RelayWebSocketLike } from '../src/relay'
import { decide } from '../src/gate'
import { createIdentity } from '../src/did'
import { derivePairKey, randomBytes, seal, toB64u } from '../src/crypto'
import type { MatchHit, MatchResult, QueryTemplate } from '../src/types'
import type { AnswerEnvelope, QueryEnvelope } from '../src/types'

function makeQuery(qid = 'qid-abc12345'): QueryEnvelope {
  return {
    v: 1,
    t: 'query',
    from: { id: 'asker001', displayName: 'Nora' },
    templateId: 'tmpl-housing-1',
    templateVersion: 1,
    qid,
    issuedAt: Date.now(),
  }
}

function makeAnswer(qid = 'qid-abc12345'): AnswerEnvelope {
  return { v: 1, t: 'answer', qid, body: 'x'.repeat(512) }
}

// ---------------------------------------------------------------------------
// Outer wire framing -- pure, no crypto.
// ---------------------------------------------------------------------------

describe('buildOuterWire / parseOuterWire', () => {
  it('round-trips to/from/payload', () => {
    const raw = buildOuterWire('did:peer:2.Vabc.Edef.Sghi', 'did:peer:2.Vjkl.Emno.Spqr', 'cGF5bG9hZA')
    const parsed = parseOuterWire(raw)
    expect(parsed).toEqual({
      to: 'did:peer:2.Vabc.Edef.Sghi',
      from: 'did:peer:2.Vjkl.Emno.Spqr',
      payload: 'cGF5bG9hZA',
    })
  })

  it('the relay-visible "to" field is a plain top-level JSON string property, matching relay_server.ts submit()', () => {
    const raw = buildOuterWire('did:peer:2.to', 'did:peer:2.from', 'payload')
    const outer = JSON.parse(raw) as { to: unknown }
    expect(typeof outer.to).toBe('string')
    expect(outer.to).toBe('did:peer:2.to')
  })

  it.each([
    ['not JSON at all', 'not json'],
    ['a JSON array, not an object', '[1,2,3]'],
    ['null', 'null'],
    ['missing to', JSON.stringify({ from: 'a', payload: 'b' })],
    ['empty to', JSON.stringify({ to: '', from: 'a', payload: 'b' })],
    ['missing from', JSON.stringify({ to: 'a', payload: 'b' })],
    ['missing payload', JSON.stringify({ to: 'a', from: 'b' })],
    ['non-string to', JSON.stringify({ to: 1, from: 'a', payload: 'b' })],
  ])('rejects malformed input: %s', (_label, input) => {
    expect(parseOuterWire(input)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// encrypt/decrypt round trip
// ---------------------------------------------------------------------------

describe('encryptEnvelope / decryptEnvelope', () => {
  it('round-trips a QueryEnvelope under a derived pair key', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const query = makeQuery()

    const payload = await encryptEnvelope(query, pairKey)
    const decoded = await decryptEnvelope(payload, pairKey)

    expect(decoded).toEqual(query)
  })

  it('round-trips an AnswerEnvelope under a derived pair key', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const answer = makeAnswer()

    const payload = await encryptEnvelope(answer, pairKey)
    const decoded = await decryptEnvelope(payload, pairKey)

    expect(decoded).toEqual(answer)
  })

  it('produces a different IV (and therefore different payload) on every call, even for the identical envelope', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const query = makeQuery()

    const a = await encryptEnvelope(query, pairKey)
    const b = await encryptEnvelope(query, pairKey)

    expect(a).not.toBe(b)
  })

  it('fails to decrypt under the WRONG pair key', async () => {
    const pairKeyA = await derivePairKey('anna-nonce', 'ben-nonce')
    const pairKeyWrong = await derivePairKey('mallory-nonce', 'someone-else-nonce')
    const query = makeQuery()

    const payload = await encryptEnvelope(query, pairKeyA)
    const decoded = await decryptEnvelope(payload, pairKeyWrong)

    expect(decoded).toBeNull()
  })

  it('fails on a tampered ciphertext byte (AEAD authentication)', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const payload = await encryptEnvelope(makeQuery(), pairKey)

    // Flip an interior character (never the last one -- an unpadded
    // base64url string's final char can carry unused low bits, so flipping
    // it can spuriously decode to the same byte; see relay_client.test.ts's
    // identical caveat in packages/browser-agent for the same reasoning).
    const flipIndex = Math.floor(payload.length / 2)
    const flipped =
      payload.slice(0, flipIndex) +
      (payload[flipIndex] === 'A' ? 'B' : 'A') +
      payload.slice(flipIndex + 1)

    expect(await decryptEnvelope(flipped, pairKey)).toBeNull()
  })

  it('never throws on a too-short payload (shorter than one IV)', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    await expect(decryptEnvelope(toB64u(randomBytes(4)), pairKey)).resolves.toBeNull()
  })

  it('never throws on garbage base64url', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    await expect(decryptEnvelope('not valid base64url!!!', pairKey)).resolves.toBeNull()
  })

  it('returns null when the decrypted plaintext authenticates but is not a recognised envelope (decodeFromQr rejects it)', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const iv = randomBytes(12)
    const notAnEnvelope = new TextEncoder().encode(JSON.stringify({ hello: 'world' }))
    const ciphertext = await seal(pairKey, iv, notAnEnvelope)
    const framed = new Uint8Array(iv.length + ciphertext.length)
    framed.set(iv, 0)
    framed.set(ciphertext, iv.length)

    expect(await decryptEnvelope(toB64u(framed), pairKey)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The privacy invariant, at the layer the RELAY actually sees.
//
// gate.ts's byte-identical padding (ANSWER_BODY_LEN) guarantees the AnswerEnvelope
// itself is the same shape regardless of outcome, for a fixed qid. That is not
// automatically true one layer further out, on the wire the relay actually
// observes: encryptEnvelope() wraps that envelope under a FRESH RANDOM IV on
// every call (by design -- reusing an AES-GCM IV under one key is a real
// confidentiality break, not a test inconvenience, see relay.ts's module doc
// and the "produces a different IV... every call" test above). So the exact
// ciphertext bytes on the relay's wire are NEVER identical between two sends,
// on purpose, even for two byte-identical plaintexts.
//
// What the relay CAN still learn, and what must therefore stay constant
// across outcomes, is LENGTH: if a `shared` answer's OuterWire payload were
// even one byte longer or shorter than a `no-match`/`below-k`/`declined`/
// `blocked` one, the relay operator could distinguish "she had something"
// from "she had nothing" without ever decrypting a single byte. This test
// proves that does not happen: it drives all five gate.decide() outcomes for
// ONE fixed query, encrypts each resulting AnswerEnvelope exactly as
// relay.ts's send() does, and asserts every resulting OuterWire (and its
// payload field) has the identical byte length.
// ---------------------------------------------------------------------------

describe('wire-level indistinguishability: what the RELAY sees', () => {
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

  function makeHit(i: number): MatchHit {
    return {
      threadId: `thread-${i}`,
      threadTitle: `Gruppe ${i}`,
      messageIndex: i,
      message: {
        ts: '2026-08-15T10:00:00Z',
        author: `author-${i}`,
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
    return { hits, distinctAuthors: hits.length, aboveThreshold }
  }

  it('the OuterWire payload length (and the whole wire length) is identical across shared / declined / below-k / no-match / blocked, for the same question', async () => {
    const query = makeQuery('qid-fixed-relay-0001')
    const template = makeTemplate()
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const toDid = 'did:peer:2.Vasker.Easker.Sasker'
    const fromDid = 'did:peer:2.Vholder.Eholder.Sholder'

    const cases: { label: string; match: MatchResult; consent: boolean; blocked: boolean }[] = [
      { label: 'shared',    match: makeMatch(3, true),  consent: true,  blocked: false },
      { label: 'declined',  match: makeMatch(3, true),  consent: false, blocked: false },
      { label: 'below-k',   match: makeMatch(1, false), consent: true,  blocked: false },
      { label: 'no-match',  match: makeMatch(0, false),  consent: true,  blocked: false },
      { label: 'blocked',   match: makeMatch(3, true),  consent: true,  blocked: true },
    ]

    const wires = await Promise.all(cases.map(async ({ match, consent, blocked }) => {
      const { envelope } = await decide({ query, template, match, consent, blocked, key: pairKey })
      const payload = await encryptEnvelope(envelope, pairKey)
      const outer = buildOuterWire(toDid, fromDid, payload)
      return { payload, outer }
    }))

    const payloadLengths = wires.map((w) => w.payload.length)
    const outerLengths = wires.map((w) => w.outer.length)

    for (let i = 1; i < cases.length; i++) {
      expect(payloadLengths[i], `payload length: ${cases[i].label} vs ${cases[0].label}`).toBe(payloadLengths[0])
      expect(outerLengths[i], `outer wire length: ${cases[i].label} vs ${cases[0].label}`).toBe(outerLengths[0])
    }

    // Every OuterWire's `to`/`from` are the peer DIDs -- constant by
    // construction, never a function of the gate's decision. Asserted
    // explicitly so a future refactor that threaded outcome into routing
    // would fail loudly here, not silently in production.
    for (const { outer } of wires) {
      const parsed = parseOuterWire(outer)
      expect(parsed?.to).toBe(toDid)
      expect(parsed?.from).toBe(fromDid)
    }
  })
})

// ---------------------------------------------------------------------------
// handleWire's ack decision -- root-caused 2026-09-05: the residual "second
// guest misses a broadcast query" loss that survived the single-flight relay
// channel fix. `onRawWire`'s callback used to be typed `=> void`, and
// `handleWire` (relay.ts, not exported -- exercised here only through the
// public `RelayChannel` surface, via a scripted mock drain socket) treated
// merely REGISTERING a raw sink as proof a wire was "handled", regardless of
// what that callback's body actually did with it. Since every relay-mode
// device registers a raw sink unconditionally for its whole lifetime
// (main.ts's `bringUpRelayChannel`), this silently acked -- and therefore
// permanently dropped instead of leaving for redelivery -- ANY ordinary
// encrypted wire whose `onEnvelope` decrypt happened to fail on its first
// delivery attempt (an as-yet-unresolvable pair key being the likeliest
// real-world trigger). `onRawWire`'s callback now returns `true` only when
// it genuinely recognised the wire; `handleWire` only counts THAT as
// handled. These tests drive a scripted mock drain socket end to end (auth
// handshake, a pushed `wire` frame, and asserting on what the channel sends
// back) to prove the ack decision directly, deterministically, with no live
// relay involved.
// ---------------------------------------------------------------------------

describe("handleWire's ack decision (via a scripted mock drain socket)", () => {
  /** Minimal scriptable stand-in for the drain WebSocket: records every
   *  frame the channel sends, and lets the test push server frames in by
   *  calling the listener the channel itself registered. */
  class MockDrainSocket implements RelayWebSocketLike {
    readyState = 1 // WS_OPEN
    sent: unknown[] = []
    private listeners = new Map<string, ((event: { data: unknown }) => void)[]>()
    send(data: string): void {
      this.sent.push(JSON.parse(data))
    }
    close(): void {
      this.readyState = 3
      this.emit('close', {})
    }
    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      const list = this.listeners.get(type) ?? []
      list.push(listener)
      this.listeners.set(type, list)
    }
    emit(type: string, event: { data?: unknown }): void {
      for (const l of this.listeners.get(type) ?? []) l(event as { data: unknown })
    }
    serverSend(msg: unknown): void {
      this.emit('message', { data: JSON.stringify(msg) })
    }
  }

  /** Boots a channel against a mock socket, drives the auth handshake (the
   *  mock isn't a real relay so it accepts any signature -- irrelevant to
   *  what this suite is testing), and returns the socket plus a settled
   *  channel ready to receive scripted `wire` frames. */
  async function connectedChannel() {
    const identity = createIdentity('https://example.invalid/relay')
    const sockets: MockDrainSocket[] = []
    const wsCtor = function (this: MockDrainSocket) {
      const s = new MockDrainSocket()
      sockets.push(s)
      return s
    } as unknown as new (url: string) => RelayWebSocketLike

    const channel = createRelayChannel({ wsCtor, fetchImpl: undefined })
    const connectPromise = channel.connect(identity)
    // The mock's constructor already pushed itself into `sockets`
    // synchronously (createRelayChannel calls `new wsCtor(url)` inside
    // connect()), so it's available immediately, before challenge/auth_ok.
    const socket = sockets[0]
    socket.serverSend({ type: 'challenge', nonce: 'bW9jay1ub25jZQ' }) // 'mock-nonce' base64url-ish, content unchecked by this mock
    // Let the channel's signChallenge()+send('auth') round trip run.
    await Promise.resolve()
    socket.serverSend({ type: 'auth_ok' })
    await connectPromise
    return { identity, channel, socket }
  }

  /** Pushes one `{type:'wire', id, wire}` frame in and waits long enough for
   *  `handleWire`'s async chain (an `await` for the resolver, another for
   *  decrypt) to settle before the test inspects `socket.sent`. */
  async function pushWireAndSettle(socket: MockDrainSocket, id: string, wire: string): Promise<void> {
    socket.serverSend({ type: 'wire', id, wire })
    // handleWire is `void`-dispatched from the message handler
    // (`void handleWire(...).then(...)`), and its chain includes a REAL
    // `crypto.subtle.decrypt` call (decryptEnvelope), which does not
    // necessarily settle within pure microtask turns -- macrotask ticks are
    // the reliable way to let it fully resolve before asserting.
    //
    // Several short ticks rather than one 10ms one: a single fixed sleep was
    // enough on an idle machine but flaked under a fully loaded parallel
    // suite (WebCrypto is dispatched off-thread, so the wall-clock budget it
    // needs is not constant). Same total order of magnitude, ~5x the
    // headroom, and it still returns as soon as the chain has settled.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  function acksFor(socket: MockDrainSocket, id: string): boolean {
    return socket.sent.some((m) => {
      const msg = m as { type?: string; ids?: string[] }
      return msg.type === 'ack' && Array.isArray(msg.ids) && msg.ids.includes(id)
    })
  }

  it('acks a wire when onEnvelope successfully decrypts it (baseline, unaffected by this fix)', async () => {
    const { identity, channel, socket } = await connectedChannel()
    const pairKey = await derivePairKey('sender-nonce', 'recipient-nonce')
    const received: QueryEnvelope[] = []
    channel.onEnvelope(pairKey, (envelope) => {
      if (envelope.t === 'query') received.push(envelope)
    })
    const payload = await encryptEnvelope(makeQuery('qid-baseline-ok1'), pairKey)
    const outer = buildOuterWire(identity.did, 'did:peer:2.Vsender.Esender.Ssender', payload)

    await pushWireAndSettle(socket, 'wire-001', outer)

    expect(received).toHaveLength(1)
    expect(acksFor(socket, 'wire-001')).toBe(true)
  })

  it('does NOT ack a wire when onEnvelope fails to decrypt it and no raw sink is registered (baseline: un-acked means the relay will redeliver it)', async () => {
    const { identity, channel, socket } = await connectedChannel()
    const wrongKey = await derivePairKey('some-other-nonce', 'entirely-unrelated')
    const rightKey = await derivePairKey('sender-nonce', 'recipient-nonce')
    channel.onEnvelope(wrongKey, () => { /* never fires -- decrypt fails under the wrong key */ })
    const payload = await encryptEnvelope(makeQuery('qid-baseline-fail1'), rightKey)
    const outer = buildOuterWire(identity.did, 'did:peer:2.Vsender.Esender.Ssender', payload)

    await pushWireAndSettle(socket, 'wire-002', outer)

    expect(acksFor(socket, 'wire-002')).toBe(false)
  })

  it(
    'THE BUG (pre-fix would have failed here): a raw sink that does NOT recognise a wire must not cause it to be acked -- ' +
    'main.ts\'s handleRawWire returns false/void for every wire that is not a connect-ack, i.e. every ordinary query/answer',
    async () => {
      const { identity, channel, socket } = await connectedChannel()
      const wrongKey = await derivePairKey('some-other-nonce', 'entirely-unrelated')
      const rightKey = await derivePairKey('sender-nonce', 'recipient-nonce')
      channel.onEnvelope(wrongKey, () => { /* never fires -- decrypt fails under the wrong key, simulating an as-yet-unresolvable pair key */ })
      // The exact shape of main.ts's handleRawWire for a non-connect-ack wire:
      // it looks, does not recognise the payload, and returns without acting.
      channel.onRawWire(() => { /* looked, did nothing -- returns void, same as handleRawWire's early `return` */ })
      const payload = await encryptEnvelope(makeQuery('qid-the-bug-1'), rightKey)
      const outer = buildOuterWire(identity.did, 'did:peer:2.Vsender.Esender.Ssender', payload)

      await pushWireAndSettle(socket, 'wire-003', outer)

      // A wire nothing actually processed must stay un-acked so the relay
      // redelivers it on the next authenticated drain -- see relay_server.ts's
      // at-least-once design. Acking it here (the pre-fix behaviour, since a
      // raw sink was registered at all) would silently and permanently drop it.
      expect(acksFor(socket, 'wire-003')).toBe(false)
    },
  )

  it('a raw sink that DOES recognise a wire (returns true) still acks it, even though onEnvelope could not decrypt it (the one legitimate case this exists for: the connect-ack bootstrap)', async () => {
    const { identity, channel, socket } = await connectedChannel()
    const wrongKey = await derivePairKey('some-other-nonce', 'entirely-unrelated')
    channel.onEnvelope(wrongKey, () => { /* no key known yet for this brand-new peer */ })
    channel.onRawWire(() => true) // recognised and processed it, e.g. a connect-ack
    const payload = await encryptEnvelope(makeQuery('qid-recognised-1'), wrongKey) // content irrelevant -- onRawWire doesn't decrypt
    const outer = buildOuterWire(identity.did, 'did:peer:2.Vsender.Esender.Ssender', payload)

    await pushWireAndSettle(socket, 'wire-004', outer)

    expect(acksFor(socket, 'wire-004')).toBe(true)
  })
})
