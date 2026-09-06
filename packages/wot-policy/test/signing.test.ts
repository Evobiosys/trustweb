// Unit tests for the signed withdraw/clear scheme (B-20 option A).
//
// THE GOLDEN VECTOR below is the cross-implementation contract. The identical
// string is asserted in apps/demo/test/central_signing.test.ts against
// apps/demo/src/central/signing.ts's own canonicaliser. apps/demo does not
// depend on this package (see apps/demo/src/central/types.ts on why the shapes
// are mirrored rather than imported), so this pair of assertions is what keeps
// the two canonicalisers from drifting apart silently. Change one, both suites
// fail.

import { describe, expect, it } from 'vitest'
import {
  CLEAR_ALL_TARGET,
  SIGNATURE_CLOCK_SKEW_MS,
  SIGNATURE_MAX_TTL_MS,
  canonicalActionMessage,
  canonicalActionString,
  fromB64u,
  toB64u,
  validateSignedActionRequest,
  verifyEd25519,
  verifySignedAction,
  type SignedActionPayload,
} from '../src/index'

const GOLDEN_PAYLOAD: SignedActionPayload = {
  action: 'withdraw',
  target: 'decl-42',
  authorCommitment: 'commit-abc',
  nonce: 'nonce-0123456789abcdef',
  expiresAt: 1757155200000,
}

const GOLDEN_CANONICAL =
  '["ew-central-signed-action-v1","withdraw","decl-42","commit-abc","nonce-0123456789abcdef",1757155200000]'

interface TestKey {
  publicKeyB64u: string
  sign(message: Uint8Array): Promise<string>
}

async function makeKey(): Promise<TestKey> {
  const pair = (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey))
  return {
    publicKeyB64u: toB64u(raw),
    async sign(message: Uint8Array): Promise<string> {
      const sig = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message)
      return toB64u(new Uint8Array(sig))
    },
  }
}

function payload(overrides: Partial<SignedActionPayload> = {}): SignedActionPayload {
  return { ...GOLDEN_PAYLOAD, expiresAt: Date.now() + 60_000, ...overrides }
}

describe('canonicalisation', () => {
  it('matches the golden vector byte for byte', () => {
    expect(canonicalActionString(GOLDEN_PAYLOAD)).toBe(GOLDEN_CANONICAL)
    expect(new TextDecoder().decode(canonicalActionMessage(GOLDEN_PAYLOAD))).toBe(GOLDEN_CANONICAL)
  })

  it('is independent of the object key order the caller happened to build', () => {
    const reordered = {
      expiresAt: GOLDEN_PAYLOAD.expiresAt,
      nonce: GOLDEN_PAYLOAD.nonce,
      authorCommitment: GOLDEN_PAYLOAD.authorCommitment,
      target: GOLDEN_PAYLOAD.target,
      action: GOLDEN_PAYLOAD.action,
    } as SignedActionPayload
    expect(canonicalActionString(reordered)).toBe(GOLDEN_CANONICAL)
  })

  it('cannot be forged by shifting a field boundary from inside a value', () => {
    // A `k=v` newline encoding would let a target smuggle its own extra field.
    const sneaky = canonicalActionString(
      payload({ target: 'x","commit-abc","nonce-0123456789abcdef', expiresAt: 1 }),
    )
    expect(sneaky).not.toBe(canonicalActionString(payload({ target: 'x', expiresAt: 1 })))
    expect(JSON.parse(sneaky)).toHaveLength(6)
  })

  it('a withdraw and a clear over the same target never share a message', () => {
    const a = canonicalActionString(payload({ action: 'withdraw', target: CLEAR_ALL_TARGET }))
    const b = canonicalActionString(payload({ action: 'clear', target: CLEAR_ALL_TARGET }))
    expect(a).not.toBe(b)
  })
})

describe('base64url', () => {
  it('round-trips arbitrary byte lengths', () => {
    for (const len of [0, 1, 2, 3, 31, 32, 64, 65]) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(len))
      expect(Array.from(fromB64u(toB64u(bytes)) ?? [])).toEqual(Array.from(bytes))
    }
  })

  it('returns null on a character outside the alphabet instead of throwing', () => {
    expect(fromB64u('abc$def')).toBeNull()
    expect(fromB64u('abc=')).toBeNull() // padded base64 is not this encoding
  })

  it('rejects non-canonical spellings of the same bytes', () => {
    // 32 zero bytes encode to 43 'A's; the last character carries two unused
    // bits. A lenient decoder would accept four spellings of one key, which
    // would be four separate rate-limit budgets and a silent mismatch against
    // the registered holderPubKey. Only the canonical spelling decodes.
    const canonical = toB64u(new Uint8Array(32))
    expect(canonical).toHaveLength(43)
    expect(fromB64u(canonical)).toHaveLength(32)
    for (const variant of ['B', 'C', 'D']) {
      expect(fromB64u(canonical.slice(0, -1) + variant), variant).toBeNull()
    }
  })

  it('rejects a length no byte string can encode to', () => {
    expect(fromB64u('AAAAA')).toBeNull() // 5 chars: 4 chars plus a lone one
  })
})

describe('verifyEd25519', () => {
  it('accepts a signature made with the matching key', async () => {
    const key = await makeKey()
    const msg = canonicalActionMessage(GOLDEN_PAYLOAD)
    expect(await verifyEd25519(key.publicKeyB64u, await key.sign(msg), msg)).toBe(true)
  })

  it('rejects a signature made with a different key', async () => {
    const a = await makeKey()
    const b = await makeKey()
    const msg = canonicalActionMessage(GOLDEN_PAYLOAD)
    expect(await verifyEd25519(b.publicKeyB64u, await a.sign(msg), msg)).toBe(false)
  })

  it('rejects malformed key or signature encodings without throwing', async () => {
    const key = await makeKey()
    const msg = canonicalActionMessage(GOLDEN_PAYLOAD)
    const sig = await key.sign(msg)
    expect(await verifyEd25519('not-base64url!!', sig, msg)).toBe(false)
    expect(await verifyEd25519(key.publicKeyB64u, 'short', msg)).toBe(false)
    expect(await verifyEd25519(toB64u(new Uint8Array(31)), sig, msg)).toBe(false)
  })
})

describe('validateSignedActionRequest', () => {
  it('rejects a nonce short enough to be guessable', () => {
    expect(
      validateSignedActionRequest({ payload: payload({ nonce: 'short' }), signature: 'a', publicKey: 'b' }),
    ).toBeNull()
  })

  it('rejects a non-finite expiresAt', () => {
    const bad = { ...payload(), expiresAt: Number.POSITIVE_INFINITY }
    expect(validateSignedActionRequest({ payload: bad, signature: 'a', publicKey: 'b' })).toBeNull()
  })
})

describe('verifySignedAction', () => {
  async function signed(p: SignedActionPayload, key: TestKey) {
    return { payload: p, signature: await key.sign(canonicalActionMessage(p)), publicKey: key.publicKeyB64u }
  }

  it('accepts a fresh, well-formed, correctly signed withdraw', async () => {
    const key = await makeKey()
    const p = payload()
    const verdict = await verifySignedAction({
      body: await signed(p, key),
      expectedAction: 'withdraw',
      expectedTarget: p.target,
    })
    expect(verdict.kind).toBe('ok')
  })

  it('rejects an unsigned body with signature-required, the old clients migration path', async () => {
    for (const body of [{}, { proof: 'placeholder-signed-withdrawal-proof' }, undefined, null]) {
      const verdict = await verifySignedAction({
        body,
        expectedAction: 'withdraw',
        expectedTarget: 'decl-42',
      })
      expect(verdict).toEqual({ kind: 'rejected', reason: 'signature-required' })
    }
  })

  it('rejects a present-but-broken signed body as malformed, not as unsigned', async () => {
    const verdict = await verifySignedAction({
      body: { payload: { action: 'withdraw' }, signature: 'x', publicKey: 'y' },
      expectedAction: 'withdraw',
      expectedTarget: 'decl-42',
    })
    expect(verdict).toEqual({ kind: 'rejected', reason: 'malformed-signed-action' })
  })

  it('rejects a signature over a different target: no reaching across declarations', async () => {
    const key = await makeKey()
    const p = payload({ target: 'someone-elses-declaration' })
    const verdict = await verifySignedAction({
      body: await signed(p, key),
      expectedAction: 'withdraw',
      expectedTarget: 'decl-42',
    })
    expect(verdict).toEqual({ kind: 'rejected', reason: 'action-mismatch' })
  })

  it('rejects a withdraw signature replayed at the clear endpoint', async () => {
    const key = await makeKey()
    const p = payload({ action: 'withdraw', target: CLEAR_ALL_TARGET })
    const verdict = await verifySignedAction({
      body: await signed(p, key),
      expectedAction: 'clear',
      expectedTarget: CLEAR_ALL_TARGET,
    })
    expect(verdict).toEqual({ kind: 'rejected', reason: 'action-mismatch' })
  })

  it('rejects an expired signature', async () => {
    const key = await makeKey()
    // Past the expiry AND past the clock-skew allowance: a signature merely a
    // second stale is deliberately still accepted, so a device whose clock lags
    // the server is not locked out of withdrawing forever.
    const p = payload({ expiresAt: Date.now() - (SIGNATURE_CLOCK_SKEW_MS + 5_000) })
    const verdict = await verifySignedAction({
      body: await signed(p, key),
      expectedAction: 'withdraw',
      expectedTarget: p.target,
    })
    expect(verdict).toEqual({ kind: 'rejected', reason: 'expired' })
  })

  it('tolerates a signature slightly stale, so a lagging device clock is not a lockout', async () => {
    const key = await makeKey()
    const p = payload({ expiresAt: Date.now() - Math.floor(SIGNATURE_CLOCK_SKEW_MS / 2) })
    const verdict = await verifySignedAction({
      body: await signed(p, key),
      expectedAction: 'withdraw',
      expectedTarget: p.target,
    })
    expect(verdict.kind).toBe('ok')
  })

  it('rejects a far-future expiry: a signed action is not a bearer token', async () => {
    const key = await makeKey()
    const p = payload({ expiresAt: Date.now() + SIGNATURE_MAX_TTL_MS * 100 })
    const verdict = await verifySignedAction({
      body: await signed(p, key),
      expectedAction: 'withdraw',
      expectedTarget: p.target,
    })
    expect(verdict).toEqual({ kind: 'rejected', reason: 'expiry-too-far' })
  })

  it('rejects a payload tampered with after signing', async () => {
    const key = await makeKey()
    const p = payload()
    const body = await signed(p, key)
    body.payload = { ...p, authorCommitment: 'someone-else' }
    const verdict = await verifySignedAction({
      body,
      expectedAction: 'withdraw',
      expectedTarget: p.target,
    })
    expect(verdict).toEqual({ kind: 'rejected', reason: 'signature-invalid' })
  })

  it('rejects a good signature presented under a different public key', async () => {
    const a = await makeKey()
    const b = await makeKey()
    const p = payload()
    const body = await signed(p, a)
    body.publicKey = b.publicKeyB64u
    const verdict = await verifySignedAction({
      body,
      expectedAction: 'withdraw',
      expectedTarget: p.target,
    })
    expect(verdict).toEqual({ kind: 'rejected', reason: 'signature-invalid' })
  })
})
