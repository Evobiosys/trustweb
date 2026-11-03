// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// @vitest-environment node
//
// The demo's relay sends are signed (sender auth v2, SPEC F9): the bytes the
// demo signs must be exactly the bytes the relay verifies. Node environment
// because this file imports transport's reference implementation side by
// side (as did_interop.test.ts does), and uses Node's Response.
import { describe, expect, it } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sendSigningInputV2 as serverSendSigningInputV2 } from '../../../packages/transport/src/relay_send_auth'
import { createIdentity } from '../src/did'
import { fromB64u } from '../src/crypto'
import { buildOuterWire, createRelayChannel } from '../src/relay'
import type { RelayWebSocketLike } from '../src/relay'
import { SEND_AUTH_HEADERS, sendSigningInputV2, signSend } from '../src/relay_send_auth'

const AUD = 'https://relay.example'

describe('demo signSend (v2)', () => {
  it('signs the 7-line v2 input with the DID key; the bytes equal transport\'s sendSigningInputV2', () => {
    const id = createIdentity('https://relay.invalid/demo')
    const wire = buildOuterWire('did:peer:2.recipient', id.did, 'cGF5bG9hZA')
    const h = signSend(id, wire, { aud: AUD, now: 1_800_000_000_000, nonce: 'nonce-0123456789abc' })

    expect(h[SEND_AUTH_HEADERS.did]).toBe(id.did)
    expect(h[SEND_AUTH_HEADERS.aud]).toBe(AUD)
    expect(h[SEND_AUTH_HEADERS.ts]).toBe('1800000000000')
    expect(h[SEND_AUTH_HEADERS.nonce]).toBe('nonce-0123456789abc')
    expect(SEND_AUTH_HEADERS.kid in h).toBe(false)

    const p = { did: id.did, aud: AUD, ts: '1800000000000', nonce: 'nonce-0123456789abc', wire }
    const input = sendSigningInputV2(p)
    expect(Array.from(input)).toEqual(Array.from(serverSendSigningInputV2(p)))
    expect(new TextDecoder().decode(input).startsWith('trustweb-relay-send/v2\n')).toBe(true)
    expect(ed25519.verify(fromB64u(h[SEND_AUTH_HEADERS.sig]), input, id.signing.publicKey)).toBe(true)
  })

  it('uses a fresh, relay-acceptable nonce per call', () => {
    const id = createIdentity('https://relay.invalid/demo')
    const a = signSend(id, 'w', { aud: AUD })
    const b = signSend(id, 'w', { aud: AUD })
    expect(a[SEND_AUTH_HEADERS.nonce]).not.toBe(b[SEND_AUTH_HEADERS.nonce])
    expect(a[SEND_AUTH_HEADERS.nonce]).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  })
})

describe('createRelayChannel sends are signed', () => {
  /** Just enough drain socket to get connect() through challenge -> auth_ok. */
  class HandshakeSocket implements RelayWebSocketLike {
    readyState = 1
    private listeners = new Map<string, ((event: { data: unknown }) => void)[]>()
    send(): void {}
    close(): void {
      this.readyState = 3
      for (const l of this.listeners.get('close') ?? []) l({ data: undefined })
    }
    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }
    serverSend(msg: unknown): void {
      for (const l of this.listeners.get('message') ?? []) l({ data: JSON.stringify(msg) })
    }
  }

  interface SeenPost {
    url: string
    body: string
    headers: Record<string, string>
  }

  async function connectedChannel(answers: Array<() => Response>, now?: () => number) {
    const identity = createIdentity('https://relay.invalid/demo')
    const sockets: HandshakeSocket[] = []
    const wsCtor = function () {
      const s = new HandshakeSocket()
      sockets.push(s)
      return s
    } as unknown as new (url: string) => RelayWebSocketLike
    const seen: SeenPost[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: String(init?.body), headers: { ...(init?.headers as Record<string, string>) } })
      const next = answers.shift()
      if (!next) throw new Error('unexpected extra POST')
      return next()
    }) as typeof fetch

    const channel = createRelayChannel({ relayOrigin: 'https://Relay.Example:443', wsCtor, fetchImpl, ...(now ? { now } : {}) })
    const connecting = channel.connect(identity)
    sockets[0].serverSend({ type: 'challenge', nonce: 'bW9jay1ub25jZQ' })
    await Promise.resolve()
    sockets[0].serverSend({ type: 'auth_ok' })
    await connecting
    return { identity, channel, seen }
  }

  const accepted = () => new Response(JSON.stringify({ routed: 'accepted' }), { status: 202, headers: { 'content-type': 'application/json' } })

  it('POSTs the did/aud/ts/nonce/sig headers, aud = the ingress origin, and the signature verifies over the posted body', async () => {
    const { identity, channel, seen } = await connectedChannel([accepted])
    await channel.sendRaw('did:peer:2.recipient', 'cGF5bG9hZA')

    expect(seen).toHaveLength(1)
    const [post] = seen
    expect(post.url).toBe('https://relay.example/relay/send')
    for (const h of [SEND_AUTH_HEADERS.did, SEND_AUTH_HEADERS.aud, SEND_AUTH_HEADERS.ts, SEND_AUTH_HEADERS.nonce, SEND_AUTH_HEADERS.sig]) {
      expect(typeof post.headers[h]).toBe('string')
    }
    expect(post.headers[SEND_AUTH_HEADERS.did]).toBe(identity.did)
    expect(post.headers[SEND_AUTH_HEADERS.aud]).toBe('https://relay.example') // lower-cased, default port dropped
    const input = serverSendSigningInputV2({
      did: identity.did,
      aud: post.headers[SEND_AUTH_HEADERS.aud],
      ts: post.headers[SEND_AUTH_HEADERS.ts],
      nonce: post.headers[SEND_AUTH_HEADERS.nonce],
      wire: post.body,
    })
    expect(ed25519.verify(fromB64u(post.headers[SEND_AUTH_HEADERS.sig]), input, identity.signing.publicKey)).toBe(true)
    channel.close()
  })

  it('a 401 stale with a Date header is retried ONCE, re-signed on the relay clock; a second stale is final', async () => {
    const relayNow = Date.UTC(2026, 10, 3, 12, 0, 0)
    const stale = () =>
      new Response(JSON.stringify({ routed: 'rejected', reason: 'sender authentication failed: stale' }), {
        status: 401,
        headers: { 'content-type': 'application/json', date: new Date(relayNow).toUTCString() },
      })
    const skewedNow = () => relayNow - 10 * 60_000

    const ok = await connectedChannel([stale, accepted], skewedNow)
    await ok.channel.sendRaw('did:peer:2.recipient', 'cGF5bG9hZA')
    expect(ok.seen).toHaveLength(2)
    expect(ok.seen[0].headers[SEND_AUTH_HEADERS.ts]).toBe(String(skewedNow()))
    expect(ok.seen[1].headers[SEND_AUTH_HEADERS.ts]).toBe(String(relayNow))
    expect(ok.seen[1].headers[SEND_AUTH_HEADERS.nonce]).not.toBe(ok.seen[0].headers[SEND_AUTH_HEADERS.nonce])
    ok.channel.close()

    const twice = await connectedChannel([stale, stale], skewedNow)
    await expect(twice.channel.sendRaw('did:peer:2.recipient', 'cGF5bG9hZA')).rejects.toThrow(/rejected/)
    expect(twice.seen).toHaveLength(2)
    twice.channel.close()
  })
})
