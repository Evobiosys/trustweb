import { describe, expect, it } from 'vitest'
import { decodeFromQr, encodeForQr, type Envelope } from '../src/wire'
import {
  derivePairKey,
  fromB64u,
  open,
  randomBytes,
  randomId,
  seal,
  toB64u,
} from '../src/crypto'
import type { AnswerEnvelope, ConnectAckEnvelope, ConnectEnvelope, QueryEnvelope } from '../src/types'
import { FREE_TEXT_MAX_LEN } from '../src/types'

// ---------------------------------------------------------------------------
// crypto.ts -- no dedicated test file was allotted to this deliverable, so
// its primitives are exercised here (gate_identity/gate_timing exercise the
// crypto path end to end, but the base64url round-trip and seal/open edge
// cases deserve direct coverage).
// ---------------------------------------------------------------------------

describe('toB64u / fromB64u', () => {
  it('round-trips 1000 random buffers of varying length', () => {
    for (let i = 0; i < 1000; i++) {
      const len = Math.floor(Math.random() * 300) // includes 0
      const bytes = randomBytes(len)
      const encoded = toB64u(bytes)
      expect(encoded).not.toMatch(/[+/=]/)
      const decoded = fromB64u(encoded)
      expect(Array.from(decoded)).toEqual(Array.from(bytes))
    }
  })

  it('round-trips fixed edge-case lengths 0, 1, 2, 3', () => {
    for (const len of [0, 1, 2, 3]) {
      const bytes = randomBytes(len)
      expect(Array.from(fromB64u(toB64u(bytes)))).toEqual(Array.from(bytes))
    }
  })

  it('fromB64u throws on an invalid character (callers must catch)', () => {
    expect(() => fromB64u('not valid b64u!')).toThrow()
  })
})

describe('randomBytes / randomId', () => {
  it('randomBytes returns the requested length and is not all-zero', () => {
    const bytes = randomBytes(32)
    expect(bytes.length).toBe(32)
    expect(bytes.some((b) => b !== 0)).toBe(true)
  })

  it('randomId returns exactly the requested character length', () => {
    for (const len of [1, 8, 16, 33]) {
      expect(randomId(len).length).toBe(len)
    }
  })

  it('randomId(0) is an empty string', () => {
    expect(randomId(0)).toBe('')
  })
})

describe('derivePairKey', () => {
  it('is symmetric: (a, b) and (b, a) derive usable-identically keys', async () => {
    const keyAB = await derivePairKey('nonce-a', 'nonce-b')
    const keyBA = await derivePairKey('nonce-b', 'nonce-a')

    const iv = new Uint8Array(12)
    const plaintext = new TextEncoder().encode('symmetry check')
    const ctAB = await seal(keyAB, iv, plaintext)
    const opened = await open(keyBA, iv, ctAB)

    expect(opened).not.toBeNull()
    expect(new TextDecoder().decode(opened as Uint8Array)).toBe('symmetry check')
  })

  it('different nonce pairs derive different keys', async () => {
    const key1 = await derivePairKey('n1', 'n2')
    const key2 = await derivePairKey('n1', 'n3')
    const iv = new Uint8Array(12)
    const plaintext = new TextEncoder().encode('hello')
    const ct = await seal(key1, iv, plaintext)
    const opened = await open(key2, iv, ct)
    expect(opened).toBeNull()
  })
})

describe('seal / open', () => {
  it('round-trips plaintext', async () => {
    const key = await derivePairKey('a', 'b')
    const iv = randomBytes(12)
    const plaintext = new TextEncoder().encode('the quick brown fox')
    const ct = await seal(key, iv, plaintext)
    const opened = await open(key, iv, ct)
    expect(opened).not.toBeNull()
    expect(new TextDecoder().decode(opened as Uint8Array)).toBe('the quick brown fox')
  })

  it('open returns null (never throws) on a tampered ciphertext', async () => {
    const key = await derivePairKey('a', 'b')
    const iv = randomBytes(12)
    const ct = await seal(key, iv, new TextEncoder().encode('data'))
    const tampered = new Uint8Array(ct)
    tampered[0] ^= 0xff
    await expect(open(key, iv, tampered)).resolves.toBeNull()
  })

  it('open returns null on a wrong key', async () => {
    const key1 = await derivePairKey('a', 'b')
    const key2 = await derivePairKey('c', 'd')
    const iv = randomBytes(12)
    const ct = await seal(key1, iv, new TextEncoder().encode('data'))
    await expect(open(key2, iv, ct)).resolves.toBeNull()
  })

  it('open returns null on garbage input, never throws', async () => {
    const key = await derivePairKey('a', 'b')
    const iv = randomBytes(12)
    await expect(open(key, iv, new Uint8Array([1, 2, 3]))).resolves.toBeNull()
    await expect(open(key, iv, new Uint8Array(0))).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// wire.ts
// ---------------------------------------------------------------------------

const CONNECT: ConnectEnvelope = {
  v: 1,
  t: 'connect',
  from: { id: 'abcd1234', displayName: 'Alice' },
  nonce: 'nonce-connect-1',
}

const QUERY: QueryEnvelope = {
  v: 1,
  t: 'query',
  from: { id: 'ffff9999', displayName: 'Bob' },
  templateId: 'tmpl-1',
  templateVersion: 3,
  qid: 'qid-abc',
  issuedAt: 1735689600000,
}

const ANSWER: AnswerEnvelope = {
  v: 1,
  t: 'answer',
  qid: 'qid-abc',
  body: toB64u(randomBytes(540)),
}

const CONNECT_WITH_DID: ConnectEnvelope = {
  ...CONNECT,
  did: 'did:peer:2.Vz6Mkabc.Ez6LSabc.SeyJ0IjoiZG0ifQ',
}

// The one-scan connect-link ceremony's bootstrap message (connect_link.ts):
// sent unencrypted (relay.ts's sendRaw), so decodeFromQr is its ONLY
// validation layer -- unlike every other envelope here, there is no AEAD
// authentication catching a tampered field first.
const CONNECT_ACK: ConnectAckEnvelope = {
  v: 1,
  t: 'connect-ack',
  from: { id: 'marlene0', displayName: 'Marlene' },
  did: 'did:peer:2.Vz6Mkabc.Ez6LSabc.SeyJ0IjoiZG0ifQ',
}

describe('encodeForQr / decodeFromQr round trip', () => {
  it('round-trips a ConnectEnvelope', () => {
    expect(decodeFromQr(encodeForQr(CONNECT))).toEqual(CONNECT)
  })

  it('round-trips a ConnectEnvelope carrying the optional did field', () => {
    expect(decodeFromQr(encodeForQr(CONNECT_WITH_DID))).toEqual(CONNECT_WITH_DID)
  })

  it('a ConnectEnvelope with no did field parses with did left undefined (demo-1/qr-mode code)', () => {
    const decoded = decodeFromQr(encodeForQr(CONNECT))
    expect(decoded).not.toBeNull()
    expect((decoded as ConnectEnvelope).did).toBeUndefined()
    expect('did' in (decoded as ConnectEnvelope)).toBe(false)
  })

  it('rejects a ConnectEnvelope whose did field is present but malformed', () => {
    const badTypes = [123, '', null, {}, []]
    for (const bad of badTypes) {
      const raw = JSON.stringify({ v: 1, t: 'connect', from: CONNECT.from, nonce: CONNECT.nonce, did: bad })
      expect(decodeFromQr(raw)).toBeNull()
    }
  })

  it('round-trips a QueryEnvelope', () => {
    expect(decodeFromQr(encodeForQr(QUERY))).toEqual(QUERY)
  })

  it('round-trips a QueryEnvelope carrying the optional freeText field ("In die Runde fragen")', () => {
    const withFreeText: QueryEnvelope = { ...QUERY, freeText: 'Ski' }
    expect(decodeFromQr(encodeForQr(withFreeText))).toEqual(withFreeText)
  })

  it('a QueryEnvelope with no freeText field parses with freeText left undefined', () => {
    const decoded = decodeFromQr(encodeForQr(QUERY))
    expect(decoded).not.toBeNull()
    expect((decoded as QueryEnvelope).freeText).toBeUndefined()
    expect('freeText' in (decoded as QueryEnvelope)).toBe(false)
  })

  it('rejects a QueryEnvelope whose freeText field is present but malformed', () => {
    const badTypes = [123, '', null, {}, []]
    for (const bad of badTypes) {
      const raw = JSON.stringify({ ...QUERY, freeText: bad })
      expect(decodeFromQr(raw)).toBeNull()
    }
  })

  it('rejects a QueryEnvelope whose freeText exceeds FREE_TEXT_MAX_LEN', () => {
    const raw = JSON.stringify({ ...QUERY, freeText: 'x'.repeat(FREE_TEXT_MAX_LEN + 1) })
    expect(decodeFromQr(raw)).toBeNull()
  })

  it('accepts a QueryEnvelope whose freeText is exactly FREE_TEXT_MAX_LEN', () => {
    const withFreeText: QueryEnvelope = { ...QUERY, freeText: 'x'.repeat(FREE_TEXT_MAX_LEN) }
    expect(decodeFromQr(encodeForQr(withFreeText))).toEqual(withFreeText)
  })

  // Demo 21 (secondHop): QueryEnvelope.relayed, the I8 depth-cap marker --
  // types.ts's own doc comment on that field.
  it('round-trips a QueryEnvelope carrying relayed: true', () => {
    const relayed: QueryEnvelope = { ...QUERY, relayed: true }
    expect(decodeFromQr(encodeForQr(relayed))).toEqual(relayed)
  })

  it('a QueryEnvelope with no relayed field parses with relayed left undefined -- every demo before 21', () => {
    const decoded = decodeFromQr(encodeForQr(QUERY))
    expect(decoded).not.toBeNull()
    expect((decoded as QueryEnvelope).relayed).toBeUndefined()
    expect('relayed' in (decoded as QueryEnvelope)).toBe(false)
  })

  it('rejects a QueryEnvelope whose relayed field is present but not exactly true', () => {
    for (const bad of [false, 1, 0, 'true', null, {}, []]) {
      const raw = JSON.stringify({ ...QUERY, relayed: bad })
      expect(decodeFromQr(raw)).toBeNull()
    }
  })

  // cooldown.ts, 2026-09-06: QueryEnvelope.escalated, "this is very
  // important" -- same optional-`true`-only convention as `relayed` above.
  it('round-trips a QueryEnvelope carrying escalated: true', () => {
    const escalated: QueryEnvelope = { ...QUERY, escalated: true }
    expect(decodeFromQr(encodeForQr(escalated))).toEqual(escalated)
  })

  it('a QueryEnvelope with no escalated field parses with escalated left undefined -- every ordinary ask', () => {
    const decoded = decodeFromQr(encodeForQr(QUERY))
    expect(decoded).not.toBeNull()
    expect((decoded as QueryEnvelope).escalated).toBeUndefined()
    expect('escalated' in (decoded as QueryEnvelope)).toBe(false)
  })

  it('rejects a QueryEnvelope whose escalated field is present but not exactly true', () => {
    for (const bad of [false, 1, 0, 'true', null, {}, []]) {
      const raw = JSON.stringify({ ...QUERY, escalated: bad })
      expect(decodeFromQr(raw)).toBeNull()
    }
  })

  // TrustWeb wave 3: QueryEnvelope.direct, "ask only my direct contacts" --
  // same optional-`true`-only convention as `relayed` and `escalated` above.
  it('round-trips a QueryEnvelope carrying direct: true', () => {
    const direct: QueryEnvelope = { ...QUERY, direct: true }
    expect(decodeFromQr(encodeForQr(direct))).toEqual(direct)
  })

  it('a QueryEnvelope with no direct field parses with direct left undefined -- every ask before wave 3', () => {
    const decoded = decodeFromQr(encodeForQr(QUERY))
    expect(decoded).not.toBeNull()
    expect('direct' in (decoded as QueryEnvelope)).toBe(false)
  })

  it('rejects a QueryEnvelope whose direct field is present but not exactly true', () => {
    for (const bad of [false, 1, 0, 'true', null, {}, []]) {
      const raw = JSON.stringify({ ...QUERY, direct: bad })
      expect(decodeFromQr(raw)).toBeNull()
    }
  })

  it('round-trips an AnswerEnvelope', () => {
    expect(decodeFromQr(encodeForQr(ANSWER))).toEqual(ANSWER)
  })

  it('round-trips a ConnectAckEnvelope', () => {
    expect(decodeFromQr(encodeForQr(CONNECT_ACK))).toEqual(CONNECT_ACK)
  })
})

describe('decodeFromQr rejects a malformed ConnectAckEnvelope', () => {
  it('rejects a missing `did` (required here, unlike ConnectEnvelope.did)', () => {
    const bad = JSON.stringify({ v: 1, t: 'connect-ack', from: CONNECT_ACK.from })
    expect(decodeFromQr(bad)).toBeNull()
  })

  it.each([123, '', null, {}, []])('rejects a malformed `did`: %j', (bad) => {
    const raw = JSON.stringify({ v: 1, t: 'connect-ack', from: CONNECT_ACK.from, did: bad })
    expect(decodeFromQr(raw)).toBeNull()
  })

  it('rejects a missing `from`', () => {
    const bad = JSON.stringify({ v: 1, t: 'connect-ack', did: CONNECT_ACK.did })
    expect(decodeFromQr(bad)).toBeNull()
  })

  it('rejects a `from` missing displayName', () => {
    const bad = JSON.stringify({ v: 1, t: 'connect-ack', from: { id: 'x' }, did: CONNECT_ACK.did })
    expect(decodeFromQr(bad)).toBeNull()
  })

  it('rejects an empty `from.id`', () => {
    const bad = JSON.stringify({ v: 1, t: 'connect-ack', from: { id: '', displayName: 'X' }, did: CONNECT_ACK.did })
    expect(decodeFromQr(bad)).toBeNull()
  })
})

describe('decodeFromQr rejects malformed input', () => {
  it('rejects a wrong version', () => {
    const bad = JSON.stringify({ ...CONNECT, v: 2 })
    expect(decodeFromQr(bad)).toBeNull()
  })

  it('rejects an unknown envelope type', () => {
    const bad = JSON.stringify({ v: 1, t: 'not-a-real-type' })
    expect(decodeFromQr(bad)).toBeNull()
  })

  it('rejects missing required fields per type', () => {
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'connect' }))).toBeNull()
    expect(
      decodeFromQr(JSON.stringify({ v: 1, t: 'connect', from: { id: 'x' } })),
    ).toBeNull() // missing displayName
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'query', from: QUERY.from }))).toBeNull()
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'answer', qid: 'x' }))).toBeNull() // no body
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'connect-ack', from: CONNECT_ACK.from }))).toBeNull() // no did
  })

  it('rejects non-JSON garbage without throwing', () => {
    expect(() => decodeFromQr('not json at all {{{')).not.toThrow()
    expect(decodeFromQr('not json at all {{{')).toBeNull()
  })

  it('rejects a bare JSON primitive / array / null', () => {
    expect(decodeFromQr('null')).toBeNull()
    expect(decodeFromQr('42')).toBeNull()
    expect(decodeFromQr('"a string"')).toBeNull()
    expect(decodeFromQr('[1,2,3]')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(decodeFromQr('')).toBeNull()
  })

  it('fuzz: 200 random truncations of a valid envelope never throw', () => {
    const full = encodeForQr(ANSWER)
    for (let i = 0; i < 200; i++) {
      const cut = Math.floor(Math.random() * (full.length + 1))
      const truncated = full.slice(0, cut)
      let result: Envelope | null = null
      expect(() => {
        result = decodeFromQr(truncated)
      }).not.toThrow()
      if (cut < full.length) {
        // A genuine truncation is (almost) never still valid JSON matching
        // the full shape -- but we only assert the "never throws" contract
        // plus "well-typed-or-null", not that every truncation is rejected.
        expect(result === null || typeof result === 'object').toBe(true)
      }
    }
  })

  it('fuzz: 200 random single-character mutations never throw', () => {
    const full = encodeForQr(QUERY)
    const chars = full.split('')
    for (let i = 0; i < 200; i++) {
      const idx = Math.floor(Math.random() * chars.length)
      const mutated = chars.slice()
      mutated[idx] = String.fromCharCode(33 + Math.floor(Math.random() * 90))
      const candidate = mutated.join('')
      expect(() => decodeFromQr(candidate)).not.toThrow()
    }
  })
})
