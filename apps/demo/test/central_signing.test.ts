// The device half of the B-20 option A signing scheme.
//
// THE GOLDEN VECTOR below is the cross-implementation contract with
// packages/wot-policy. apps/demo does not depend on that package (its own
// central/types.ts explains why the shapes are mirrored rather than imported),
// so the identical expected string is asserted in BOTH
// packages/wot-policy/test/signing.test.ts and here. Change either
// canonicaliser and both suites fail, which is the point.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import * as client from '../src/central/client'
import {
  CLEAR_ALL_TARGET,
  SIGNATURE_TTL_MS,
  SIGNING_KEY_STORAGE_KEY,
  canonicalActionMessage,
  canonicalActionString,
  forgetSigningKey,
  getOrCreateSigningKey,
  newNonce,
  resetSigningKeyCache,
  signClear,
  signWithdraw,
  type SignedActionPayload,
  type SignedActionRequest,
} from '../src/central/signing'
import { kvDel, kvGet } from '../src/db'
import { fromB64u } from '../src/crypto'

const GOLDEN_PAYLOAD: SignedActionPayload = {
  action: 'withdraw',
  target: 'decl-42',
  authorCommitment: 'commit-abc',
  nonce: 'nonce-0123456789abcdef',
  expiresAt: 1757155200000,
}

const GOLDEN_CANONICAL =
  '["ew-central-signed-action-v1","withdraw","decl-42","commit-abc","nonce-0123456789abcdef",1757155200000]'

async function freshDevice(): Promise<void> {
  resetSigningKeyCache()
  await kvDel(SIGNING_KEY_STORAGE_KEY)
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await freshDevice()
})

// ---------------------------------------------------------------------------
// Canonicalisation
// ---------------------------------------------------------------------------

describe('canonicalisation mirrors @resource-web/wot-policy', () => {
  it('matches the golden vector byte for byte', () => {
    expect(canonicalActionString(GOLDEN_PAYLOAD)).toBe(GOLDEN_CANONICAL)
    expect(new TextDecoder().decode(canonicalActionMessage(GOLDEN_PAYLOAD))).toBe(GOLDEN_CANONICAL)
  })

  it('does not depend on the key order the payload object was built in', () => {
    const reordered = {
      expiresAt: GOLDEN_PAYLOAD.expiresAt,
      nonce: GOLDEN_PAYLOAD.nonce,
      authorCommitment: GOLDEN_PAYLOAD.authorCommitment,
      target: GOLDEN_PAYLOAD.target,
      action: GOLDEN_PAYLOAD.action,
    } as SignedActionPayload
    expect(canonicalActionString(reordered)).toBe(GOLDEN_CANONICAL)
  })
})

describe('newNonce', () => {
  it('produces a distinct, long-enough value every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()))
    expect(seen.size).toBe(200)
    for (const nonce of seen) expect(nonce.length).toBeGreaterThanOrEqual(16)
  })
})

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

describe('the device signing key', () => {
  beforeEach(async () => {
    await freshDevice()
  })

  it('generates once and is stable across calls and across a cache reset', async () => {
    const first = await getOrCreateSigningKey()
    const second = await getOrCreateSigningKey()
    expect(second.publicKeyB64u).toBe(first.publicKeyB64u)

    resetSigningKeyCache() // simulates a page reload with storage intact
    const afterReload = await getOrCreateSigningKey()
    expect(afterReload.publicKeyB64u).toBe(first.publicKeyB64u)
  })

  it('registers a raw 32-byte Ed25519 public key, the shape the server validates', async () => {
    const key = await getOrCreateSigningKey()
    expect(fromB64u(key.publicKeyB64u)).toHaveLength(32)
  })

  it('takes the Web Crypto path here, and never persists a private key on it', async () => {
    // Node 26 and every current browser target have Ed25519 in Web Crypto. If
    // this ever fails, the device fell back to @noble/curves and the stored
    // record holds secret BYTES -- honest labelling, not a silent downgrade.
    const key = await getOrCreateSigningKey()
    expect(key.backend).toBe('webcrypto-ed25519')
    const stored = (await kvGet<Record<string, unknown>>(SIGNING_KEY_STORAGE_KEY)) ?? {}
    expect(stored.secretKeyB64u).toBeUndefined()
    expect((stored.privateKey as CryptoKey).extractable).toBe(false)
  })

  it('forgetSigningKey erases it, and the next use mints a different one', async () => {
    const before = await getOrCreateSigningKey()
    await forgetSigningKey()
    expect(await kvGet(SIGNING_KEY_STORAGE_KEY)).toBeUndefined()
    const after = await getOrCreateSigningKey()
    expect(after.publicKeyB64u).not.toBe(before.publicKeyB64u)
  })
})

// ---------------------------------------------------------------------------
// Signatures, and their interoperability with the repo's existing Ed25519
// ---------------------------------------------------------------------------

describe('signatures', () => {
  beforeEach(async () => {
    await freshDevice()
  })

  it('a Web Crypto signature verifies under @noble/curves, the repos existing Ed25519', async () => {
    // The server verifies through Web Crypto; ../did.ts signs through
    // @noble/curves. This asserts the two are the same wire format rather than
    // taking it on trust, which is what licenses the fallback path in signing.ts.
    const key = await getOrCreateSigningKey()
    const signed = await signWithdraw(key, 'decl-1', 'commit-1')
    const message = canonicalActionMessage(signed.payload)
    expect(ed25519.verify(fromB64u(signed.signature), message, fromB64u(signed.publicKey))).toBe(true)
  })

  it('a @noble/curves signature verifies under Web Crypto, the direction the server uses', async () => {
    const secret = ed25519.utils.randomSecretKey()
    const publicKey = ed25519.getPublicKey(secret)
    const message = canonicalActionMessage(GOLDEN_PAYLOAD)
    const sig = ed25519.sign(message, secret)
    // Copied into standalone ArrayBuffers: Web Crypto's TypeScript signature
    // wants a BufferSource, which since TS 5.7 excludes a possibly
    // SharedArrayBuffer-backed Uint8Array.
    const buf = (b: Uint8Array): ArrayBuffer => {
      const out = new ArrayBuffer(b.byteLength)
      new Uint8Array(out).set(b)
      return out
    }
    const imported = await globalThis.crypto.subtle.importKey('raw', buf(publicKey), { name: 'Ed25519' }, false, [
      'verify',
    ])
    expect(
      await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, imported, buf(sig), buf(message)),
    ).toBe(true)
  })

  it('a withdraw signature does not verify over a clear message, and vice versa', async () => {
    const key = await getOrCreateSigningKey()
    const signed = await signWithdraw(key, CLEAR_ALL_TARGET, 'commit-1')
    const asClear = canonicalActionMessage({ ...signed.payload, action: 'clear' })
    expect(ed25519.verify(fromB64u(signed.signature), asClear, fromB64u(signed.publicKey))).toBe(false)
  })

  it('signs a clear over the all target and a short expiry', async () => {
    const key = await getOrCreateSigningKey()
    const before = Date.now()
    const signed = await signClear(key, 'commit-1')
    expect(signed.payload.action).toBe('clear')
    expect(signed.payload.target).toBe(CLEAR_ALL_TARGET)
    expect(signed.payload.expiresAt).toBeGreaterThanOrEqual(before + SIGNATURE_TTL_MS)
    expect(signed.payload.expiresAt).toBeLessThanOrEqual(Date.now() + SIGNATURE_TTL_MS)
  })

  it('never reuses a nonce across two signatures', async () => {
    const key = await getOrCreateSigningKey()
    const a = await signWithdraw(key, 'decl-1', 'commit-1')
    const b = await signWithdraw(key, 'decl-1', 'commit-1')
    expect(a.payload.nonce).not.toBe(b.payload.nonce)
  })
})

// ---------------------------------------------------------------------------
// The adapter: off means no key material at all
// ---------------------------------------------------------------------------

describe('central mode off', () => {
  beforeEach(async () => {
    await freshDevice()
    vi.stubEnv('VITE_WOT_CENTRAL', undefined as unknown as string)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network must never be touched here')
      }),
    )
  })

  it('mints no signing key: an opted-out device holds none', async () => {
    await client.publish({
      facets: { category: 'x', regionCode: 'AT-9', authorCommitment: 'abc', sensitive: false },
      sealedBody: 'sealed',
    })
    await client.withdraw('decl-1', 'abc')
    await client.clearAll('abc')
    expect(await kvGet(SIGNING_KEY_STORAGE_KEY)).toBeUndefined()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The adapter: what actually goes on the wire when the mode is on
// ---------------------------------------------------------------------------

interface CapturedCall {
  url: string
  method: string
  body: unknown
}

function stubServer(captured: CapturedCall[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (url.endsWith('/jurisdiction')) {
        return new Response(JSON.stringify({ instanceId: 'test', residency: 'AT' }), { status: 200 })
      }
      if (url.endsWith('/declarations') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'decl-1', publishedAt: 1, instanceId: 'test', residency: 'AT' }),
          { status: 201 },
        )
      }
      return new Response(null, { status: 204 })
    }),
  )
}

describe('central mode on: the wire shape', () => {
  let captured: CapturedCall[]

  beforeEach(async () => {
    await freshDevice()
    captured = []
    vi.stubEnv('VITE_WOT_CENTRAL', 'on')
    stubServer(captured)
  })

  it('publish registers this devices public key with the declaration', async () => {
    const result = await client.publish({
      facets: { category: 'x', regionCode: 'AT-9', authorCommitment: 'abc', sensitive: false },
      sealedBody: 'sealed',
    })
    expect(result.kind).toBe('ok')
    const key = await getOrCreateSigningKey()
    const publishCall = captured.find((c) => c.method === 'POST' && c.url.endsWith('/declarations'))
    expect((publishCall?.body as { holderPubKey: string }).holderPubKey).toBe(key.publicKeyB64u)
  })

  it('withdraw sends a signed payload, not a caller-supplied proof string', async () => {
    await client.withdraw('decl-1', 'commit-1')
    const call = captured.find((c) => c.method === 'DELETE')
    const body = call?.body as SignedActionRequest
    expect(body.payload).toMatchObject({ action: 'withdraw', target: 'decl-1', authorCommitment: 'commit-1' })
    expect(typeof body.signature).toBe('string')
    const message = canonicalActionMessage(body.payload)
    expect(ed25519.verify(fromB64u(body.signature), message, fromB64u(body.publicKey))).toBe(true)
  })

  it('clearAll carries the authorCommitment INSIDE the signature, never as a bare field', async () => {
    await client.clearAll('commit-1')
    const call = captured.find((c) => c.url.endsWith('/clear'))
    const body = call?.body as SignedActionRequest & { authorCommitment?: string }
    expect(body.authorCommitment).toBeUndefined()
    expect(body.payload).toMatchObject({ action: 'clear', target: CLEAR_ALL_TARGET, authorCommitment: 'commit-1' })
    const message = canonicalActionMessage(body.payload)
    expect(ed25519.verify(fromB64u(body.signature), message, fromB64u(body.publicKey))).toBe(true)
  })

  it('a 403 signature-required tells the holder her client is out of date, not just failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ reason: 'signature-required' }), { status: 403 })),
    )
    const result = await client.withdraw('decl-1', 'commit-1')
    expect(result).toMatchObject({ kind: 'error', status: 403 })
    expect((result as { message: string }).message).toContain('out of date')
  })

  it('a 429 says retry, so a rate-limited holder is not told her clear simply failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ reason: 'rate-limited' }), { status: 429 })),
    )
    const result = await client.clearAll('commit-1')
    expect((result as { message: string }).message).toContain('retry')
  })
})
