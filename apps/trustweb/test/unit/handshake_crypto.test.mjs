// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 handshake-crypto: the connect handshake is sealed with a key derived from the QR secret and both key-agreement public keys
 * (HKDF over X25519 + QR secret), AES-GCM with a random nonce and the transcript (mode, both DIDs) as additional data.
 * Fake identities only.
 */
import { createIdentity } from '../../../demo/src/did.ts'
import { buildConnectLinkUrl } from '../../../demo/src/connect_link.ts'
import { connectLinkOf } from '../../src/add_by_code.ts'
import {
  HANDSHAKE_PLAINTEXT_FALLBACK, HANDSHAKE_WIRE, HandshakeError, deriveHandshakeKey, linkHandshake, openConnectAck, openHandshake, parseHandshakeWire,
  qrSecretOf, rememberHandshakeNonce, sealConnectAck, sealHandshake, HS_NONCE_LEDGER_MAX, handshakeStatus,
} from '../../src/handshake_crypto.ts'

const te = new TextEncoder()
const td = new TextDecoder()
const bytes = (n, v) => new Uint8Array(n).fill(v)
const ack = (id, name, did) => ({ v: 1, t: 'connect-ack', from: { id, displayName: name }, did })
const reason = async (p) => { try { await p; return 'ok' } catch (e) { return e instanceof HandshakeError ? e.reason : 'other:' + String(e) } }

describe('handshake primitives', () => {
  const qs = bytes(16, 7)
  const ephA = bytes(32, 1)
  const ephB = bytes(32, 2)
  const dh = bytes(32, 3)
  const tr = te.encode('transcript')

  it('round trip', async () => {
    const key = await deriveHandshakeKey(qs, ephA, ephB, dh)
    const box = await sealHandshake(te.encode('hello'), key, tr)
    expect(box.n).toHaveLength(12)
    expect(td.decode((await openHandshake(box, key, tr, [])))).toBe('hello')
  })
  it('a wrong key fails (other QR secret, other public key, other shared secret)', async () => {
    const key = await deriveHandshakeKey(qs, ephA, ephB, dh)
    const box = await sealHandshake(te.encode('hello'), key, tr)
    for (const other of [
      await deriveHandshakeKey(bytes(16, 8), ephA, ephB, dh),
      await deriveHandshakeKey(qs, bytes(32, 9), ephB, dh),
      await deriveHandshakeKey(qs, ephA, ephB, bytes(32, 4)),
    ]) expect(await reason(openHandshake(box, other, tr, []))).toBe('tampered')
  })
  it('a tampered byte (ciphertext, nonce or transcript) fails', async () => {
    const key = await deriveHandshakeKey(qs, ephA, ephB, dh)
    const box = await sealHandshake(te.encode('hello'), key, tr)
    const c = box.c.slice(); c[0] ^= 1
    const n = box.n.slice(); n[3] ^= 1
    expect(await reason(openHandshake({ n: box.n, c }, key, tr, []))).toBe('tampered')
    expect(await reason(openHandshake({ n, c: box.c }, key, tr, []))).toBe('tampered')
    expect(await reason(openHandshake(box, key, te.encode('transcripT'), []))).toBe('tampered')
  })
  it('a replay (same nonce seen before) fails', async () => {
    const key = await deriveHandshakeKey(qs, ephA, ephB, dh)
    const box = await sealHandshake(te.encode('hello'), key, tr)
    await openHandshake(box, key, tr, [])
    const seen = rememberHandshakeNonce([], box.n)
    expect(await reason(openHandshake(box, key, tr, seen))).toBe('replay')
  })
  it('the nonce ledger is bounded', () => {
    let seen = []
    for (let i = 0; i < HS_NONCE_LEDGER_MAX + 5; i++) seen = rememberHandshakeNonce(seen, Uint8Array.of(i & 255, i >> 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
    expect(seen).toHaveLength(HS_NONCE_LEDGER_MAX)
  })
})

describe('QR payload v2', () => {
  const shower = createIdentity('http://127.0.0.1/relay')
  it('the QR secret is derived from the identity: stable, 16 bytes, not the key itself', () => {
    const k = qrSecretOf(shower)
    expect(k).toBe(qrSecretOf(shower))
    expect(k).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(k).not.toBe(qrSecretOf(createIdentity('http://127.0.0.1/relay')))
  })
  it('the connect link carries the secret as k=; connectLinkOf reads it; a link without it reads as null (an app before v2)', () => {
    const url = buildConnectLinkUrl('https://app.example/', shower.did, { id: 'abc', displayName: 'Shown' }, qrSecretOf(shower))
    expect(new URL(url).searchParams.get('k')).toBe(qrSecretOf(shower))
    expect(connectLinkOf(new URL(url).search).qk).toBe(qrSecretOf(shower))
    const old = buildConnectLinkUrl('https://app.example/', shower.did, { id: 'abc', displayName: 'Shown' })
    expect(connectLinkOf(new URL(old).search).qk).toBeNull()
  })
  it('linkHandshake: a v2 link is qr mode, a DID add is did mode, an old QR is unsupported (never silently plaintext)', () => {
    expect(HANDSHAKE_PLAINTEXT_FALLBACK).toBe(false)
    expect(linkHandshake({ did: 'x', from: { id: 'a', displayName: '' }, qk: 'k' })).toBe('qr')
    expect(linkHandshake({ did: 'x', from: { id: 'a', displayName: '' } })).toBe('did')
    expect(linkHandshake({ did: 'x', from: { id: 'a', displayName: '' }, qk: null })).toBe('unsupported')
  })
})

describe('sealed connect-ack (connect-ack2)', () => {
  const shower = createIdentity('http://127.0.0.1/relay')
  const scanner = createIdentity('http://127.0.0.1/relay')
  const plain = ack('scan0001', 'Scanner Person', scanner.did)

  it('opens on the shower with its own QR secret; the wire holds no name, no id', async () => {
    const wire = await sealConnectAck(plain, scanner, shower.did, qrSecretOf(shower))
    expect(wire).not.toContain('Scanner')
    expect(wire).not.toContain('scan0001')
    const w = parseHandshakeWire(wire)
    expect(w).toMatchObject({ t: HANDSHAKE_WIRE, hv: 2, m: 'qr' })
    const got = await openConnectAck(w, shower, scanner.did, [])
    expect(got.ack).toEqual(plain)
    expect(got.mode).toBe('qr')
  })
  it('pads: a long and a short name give the same wire length', async () => {
    const a = await sealConnectAck(ack('scan0001', 'A', scanner.did), scanner, shower.did, qrSecretOf(shower))
    const b = await sealConnectAck(ack('scan0001', 'A much longer display name here', scanner.did), scanner, shower.did, qrSecretOf(shower))
    expect(a.length).toBe(b.length)
  })
  it('did mode (no QR) opens too', async () => {
    const got = await openConnectAck(parseHandshakeWire(await sealConnectAck(plain, scanner, shower.did)), shower, scanner.did, [])
    expect(got.mode).toBe('did')
  })
  it('a wrong QR secret, another receiver, another claimed sender, or a flipped byte fail closed', async () => {
    const other = createIdentity('http://127.0.0.1/relay')
    const wrongQr = parseHandshakeWire(await sealConnectAck(plain, scanner, shower.did, qrSecretOf(other)))
    expect(await reason(openConnectAck(wrongQr, shower, scanner.did, []))).toBe('tampered')
    const good = parseHandshakeWire(await sealConnectAck(plain, scanner, shower.did, qrSecretOf(shower)))
    expect(await reason(openConnectAck(good, other, scanner.did, []))).toBe('tampered')
    expect(await reason(openConnectAck(good, shower, other.did, []))).toBe('tampered')
    const c = good.c.slice(0, 10) + (good.c[10] === 'A' ? 'B' : 'A') + good.c.slice(11)
    expect(await reason(openConnectAck({ ...good, c }, shower, scanner.did, []))).toBe('tampered')
  })
  it('review-44: the sender is authenticated: a relay or QR holder sealing in another DID\'s name fails (static-static DH in the key)', async () => {
    const mallory = createIdentity('http://127.0.0.1/relay')
    // Mallory knows the QR secret (it sits on every shared link) and claims to be the scanner, but holds only her own keys.
    const posing = { ...mallory, did: scanner.did }
    for (const qk of [qrSecretOf(shower), undefined]) {
      const w = parseHandshakeWire(await sealConnectAck(plain, posing, shower.did, qk))
      expect(await reason(openConnectAck(w, shower, scanner.did, []))).toBe('tampered')
    }
  })
  it('an inner ack naming another DID than the sender is a mismatch', async () => {
    const other = createIdentity('http://127.0.0.1/relay')
    const w = parseHandshakeWire(await sealConnectAck(ack('x', 'X', other.did), scanner, shower.did, qrSecretOf(shower)))
    expect(await reason(openConnectAck(w, shower, scanner.did, []))).toBe('mismatch')
  })
  it('a replayed wire fails', async () => {
    const w = parseHandshakeWire(await sealConnectAck(plain, scanner, shower.did, qrSecretOf(shower)))
    const first = await openConnectAck(w, shower, scanner.did, [])
    expect(await reason(openConnectAck(w, shower, scanner.did, first.seen))).toBe('replay')
  })
  it('parseHandshakeWire rejects anything else', () => {
    expect(parseHandshakeWire('{"v":1,"t":"connect-ack"}')).toBeNull()
    expect(parseHandshakeWire('nope')).toBeNull()
    expect(parseHandshakeWire(JSON.stringify({ v: 1, t: HANDSHAKE_WIRE, hv: 2, m: 'zz', e: 'a', n: 'b', c: 'c' }))).toBeNull()
  })
})

describe('handshakeStatus (MCP handshake_status)', () => {
  it('lists the connections not heard from yet with encrypted true/false, and the refused handshakes', () => {
    const s = {
      peers: [
        { id: 'p1', displayName: 'One', did: 'd1', ring: 'acquaintance', connectedAt: 1, handshake: 'qr' },
        { id: 'p2', displayName: 'Two', did: 'd2', ring: 'acquaintance', connectedAt: 2 },
        { id: 'p3', displayName: 'Three', did: 'd3', ring: 'acquaintance', connectedAt: 3, heardAt: 4, handshake: 'did' },
      ],
      handshakeLog: [{ at: 5, reason: 'tampered', from: 'abcd1234' }],
    }
    expect(handshakeStatus(s)).toEqual({
      version: 2,
      pending: [{ id: 'p1', name: 'One', encrypted: true, mode: 'qr' }, { id: 'p2', name: 'Two', encrypted: false, mode: null }],
      refused: [{ at: 5, reason: 'tampered', from: 'abcd1234' }],
    })
  })
})
