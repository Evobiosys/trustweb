import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../src/central/client'
import { coarsenForPublish, sealBody, type CoarsenInput } from '../src/central/coarsen'
import { fromB64u } from '../src/crypto'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

async function makeKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

function throwingFetch(): typeof fetch {
  return vi.fn(() => {
    throw new Error('network must never be touched here')
  }) as unknown as typeof fetch
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// (a) mode off -> every entry point disabled, network never touched
// ---------------------------------------------------------------------------

describe('client adapter -- centralMode off', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_WOT_CENTRAL', undefined as unknown as string)
    vi.stubGlobal('fetch', throwingFetch())
  })

  it('publish() returns disabled without touching the network', async () => {
    const result = await client.publish({
      facets: { category: 'x', regionCode: 'AT-9', authorCommitment: 'abc', sensitive: false },
      sealedBody: 'sealed',
    })
    expect(result).toEqual({ kind: 'disabled' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('withdraw() returns disabled without touching the network', async () => {
    // Second argument is the authorCommitment now, not a caller-built proof.
    const result = await client.withdraw('decl-1', 'author-commitment-1')
    expect(result).toEqual({ kind: 'disabled' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('backtrace() returns disabled without touching the network', async () => {
    const result = await client.backtrace('author-commitment-1')
    expect(result).toEqual({ kind: 'disabled' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('clearAll() returns disabled without touching the network', async () => {
    // One argument since B-20: the signed proof is built inside clearAll from
    // the device's own key, never handed in by a caller.
    const result = await client.clearAll('author-commitment-1')
    expect(result).toEqual({ kind: 'disabled' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('queryCentral() returns disabled without touching the network', async () => {
    const result = await client.queryCentral({
      category: 'x',
      regionCode: 'AT-9',
      authorCommitment: 'abc',
      sensitive: true,
    })
    expect(result).toEqual({ kind: 'disabled' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('also stays disabled for any non-"on" value, not just unset', async () => {
    for (const bad of ['On', 'ON', 'true', '1', 'off', ' on', 'on ']) {
      vi.stubEnv('VITE_WOT_CENTRAL', bad)
      const result = await client.publish({
        facets: { category: 'x', regionCode: 'AT-9', authorCommitment: 'abc', sensitive: false },
        sealedBody: 'sealed',
      })
      expect(result).toEqual({ kind: 'disabled' })
    }
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (b) coarsenForPublish drops everything it must drop
// ---------------------------------------------------------------------------

describe('coarsenForPublish', () => {
  const FORBIDDEN_ADDRESS = 'Geologengasse 17/4'
  const FORBIDDEN_AUTHOR = 'Marlene Huber'
  const FORBIDDEN_RAW_TEXT = 'ich habe grad ein zimmer frei bei mir in der Geologengasse, ruf mich an unter 0664 1234567'
  const FORBIDDEN_CONTACT = '+43 664 1234567'
  const FORBIDDEN_INCIDENTAL = 'das war eigentlich nur ein Scherz zwischen uns'
  const ABSTRACTION = 'Zimmer frei, grob 9. Bezirk'

  function makeInput(key: CryptoKey): CoarsenInput {
    return {
      match: {
        rawText: FORBIDDEN_RAW_TEXT,
        authorNames: [FORBIDDEN_AUTHOR],
        addresses: [FORBIDDEN_ADDRESS],
        contactIdentifiers: [FORBIDDEN_CONTACT],
        incidentalFreeText: [FORBIDDEN_INCIDENTAL],
      },
      form: {
        category: 'accommodation.sublet',
        regionCode: 'AT-9',
        sensitive: false,
        holderDid: 'did:peer:2.holder-test',
        abstractionText: ABSTRACTION,
      },
      key,
    }
  }

  it('never lets forbidden fields into facets', async () => {
    const key = await makeKey()
    const { facets } = await coarsenForPublish(makeInput(key))
    const serializedFacets = JSON.stringify(facets)
    for (const forbidden of [
      FORBIDDEN_ADDRESS,
      FORBIDDEN_AUTHOR,
      FORBIDDEN_RAW_TEXT,
      FORBIDDEN_CONTACT,
      FORBIDDEN_INCIDENTAL,
    ]) {
      expect(serializedFacets).not.toContain(forbidden)
    }
  })

  it('never lets forbidden fields into the sealed body -- decrypted plaintext is exactly the typed abstraction', async () => {
    const key = await makeKey()
    const { sealedBody } = await coarsenForPublish(makeInput(key))

    const combined = fromB64u(sealedBody)
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const plaintextBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    )
    const plaintext = new TextDecoder().decode(plaintextBuf)

    // Exactly the holder's typed abstraction -- nothing appended, nothing mixed in.
    expect(plaintext).toBe(ABSTRACTION)

    for (const forbidden of [
      FORBIDDEN_ADDRESS,
      FORBIDDEN_AUTHOR,
      FORBIDDEN_RAW_TEXT,
      FORBIDDEN_CONTACT,
      FORBIDDEN_INCIDENTAL,
    ]) {
      expect(plaintext).not.toContain(forbidden)
      // Also assert against the raw wire string: ciphertext is opaque, but
      // this pins the claim down rather than only trusting AES-GCM opacity.
      expect(sealedBody).not.toContain(forbidden)
    }
  })

  it('produces an authorCommitment that never contains the raw holder DID', async () => {
    const key = await makeKey()
    const input = makeInput(key)
    const { facets } = await coarsenForPublish(input)
    expect(facets.authorCommitment).not.toContain(input.form.holderDid)
    // Deterministic: same DID -> same commitment, needed for k-anon counting
    // and for backtrace/clearAll to key off the same value.
    const { facets: facets2 } = await coarsenForPublish(makeInput(key))
    expect(facets2.authorCommitment).toBe(facets.authorCommitment)
  })
})

// ---------------------------------------------------------------------------
// (c) two seals of the same plaintext -> different IVs
// ---------------------------------------------------------------------------

describe('sealBody', () => {
  it('never derives the IV from an id -- two seals of the same plaintext get different IVs', async () => {
    const key = await makeKey()
    const sealedOne = await sealBody(key, 'same plaintext, sealed twice')
    const sealedTwo = await sealBody(key, 'same plaintext, sealed twice')

    const ivOne = fromB64u(sealedOne).slice(0, 12)
    const ivTwo = fromB64u(sealedTwo).slice(0, 12)

    expect(sealedOne).not.toBe(sealedTwo)
    expect(Array.from(ivOne)).not.toEqual(Array.from(ivTwo))
  })
})

// ---------------------------------------------------------------------------
// (d) residency refusal
// ---------------------------------------------------------------------------

describe('client adapter -- residency gate', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_WOT_CENTRAL', 'on')
  })

  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }

  it('refuses to publish when GET /jurisdiction reports a residency outside the allowlist', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/jurisdiction')) {
        return jsonResponse(200, { instanceId: 'us-1', residency: 'US' })
      }
      throw new Error(`unexpected fetch call to ${url} -- publish must not proceed past the residency check`)
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await client.publish({
      facets: { category: 'x', regionCode: 'AT-9', authorCommitment: 'abc', sensitive: false },
      sealedBody: 'sealed',
    })

    expect(result).toEqual({ kind: 'refused', reason: 'residency-not-allowed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/jurisdiction')
  })

  it('proceeds to publish when residency is in the default allowlist', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/jurisdiction')) {
        return jsonResponse(200, { instanceId: 'at-1', residency: 'AT' })
      }
      if (url.includes('/declarations')) {
        return jsonResponse(201, {
          id: 'decl-1',
          publishedAt: Date.now(),
          instanceId: 'at-1',
          residency: 'AT',
        })
      }
      throw new Error(`unexpected fetch call to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await client.publish({
      facets: { category: 'x', regionCode: 'AT-9', authorCommitment: 'abc', sensitive: false },
      sealedBody: 'sealed',
    })

    expect(result).toEqual({
      kind: 'ok',
      data: { id: 'decl-1', publishedAt: expect.any(Number), instanceId: 'at-1', residency: 'AT' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
