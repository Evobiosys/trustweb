// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Device sync v2, the crypto part (src/sync_e2ee.ts): pairing code and link, key schedule, sealed frames, padding, replay guard. */
import {
  BUCKETS, REPLAY_WINDOW, admit, derivePairKeys, isReplay, nextSeq, offerCode, offerKey, offerLink, openFrame, padLen, parseOffer, peekFrame, sealFrame,
} from '../../src/sync_e2ee.ts'

const te = new TextEncoder()
const td = new TextDecoder()
const b64u = (b) => Buffer.from(b).toString('base64url')

/** A test device: an X25519 key pair from WebCrypto and a did:peer:2-shaped name for it (no real person, no real DID). */
async function device() {
  const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { did: 'did:peer:2.Ez6LS' + b64u(pub), pub, priv: kp.privateKey }
}
async function ecdh(me, them) {
  const pk = await crypto.subtle.importKey('raw', them.pub, { name: 'X25519' }, false, [])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pk }, me.priv, 256))
}
async function pair(epoch = 7) {
  const a = await device()
  const b = await device()
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const ka = await derivePairKeys({ ecdh: await ecdh(a, b), secret, myDid: a.did, theirDid: b.did, epoch })
  const kb = await derivePairKeys({ ecdh: await ecdh(b, a), secret, myDid: b.did, theirDid: a.did, epoch })
  return { a, b, secret, ka, kb }
}

describe('pairing code and link', () => {
  it('round-trips the offering DID and a 32-byte secret, as a code and as a link whose secret sits in the #fragment', async () => {
    const { did } = await device()
    const secret = b64u(crypto.getRandomValues(new Uint8Array(32)))
    const code = offerCode(did, secret)
    expect(code.startsWith('TWD2~')).toBe(true)
    expect(parseOffer(code)).toEqual({ did, secret })
    const link = offerLink('https://app.example.test', code)
    expect(new URL(link).search).toBe('')
    expect(new URL(link).hash.length).toBeGreaterThan(40)
    expect(parseOffer(link)).toEqual({ did, secret })
  })
  it('refuses anything else: a v1 code, a short secret, a non-peer DID, extra fields', async () => {
    const { did } = await device()
    const s = b64u(crypto.getRandomValues(new Uint8Array(32)))
    expect(parseOffer(`TWD1~${did}~${s}`)).toBeNull()
    expect(parseOffer(`TWD2~${did}~abc`)).toBeNull()
    expect(parseOffer(`TWD2~did:web:example.test~${s}`)).toBeNull()
    expect(parseOffer(`TWD2~${did}~${s}~more`)).toBeNull()
    expect(parseOffer('https://app.example.test/#nothing')).toBeNull()
  })
})

describe('key schedule', () => {
  it('both devices derive the same six-digit check and mirrored direction keys', async () => {
    const { a, b, ka, kb } = await pair()
    expect(ka.sas).toMatch(/^\d{3} \d{3}$/)
    expect(ka.sas).toBe(kb.sas)
    const f = await sealFrame(ka.sendKey, { ep: 7, seq: 1 }, a.did, b.did, te.encode('hi'))
    expect(td.decode((await openFrame(kb.recvKey, a.did, b.did, f)).plaintext)).toBe('hi')
  })
  it('a different secret, epoch or substituted key gives a different check (what the person compares)', async () => {
    const { a, b, secret, ka } = await pair()
    const m = await device()
    const other = await derivePairKeys({ ecdh: await ecdh(a, b), secret: crypto.getRandomValues(new Uint8Array(32)), myDid: a.did, theirDid: b.did, epoch: 7 })
    const ep = await derivePairKeys({ ecdh: await ecdh(a, b), secret, myDid: a.did, theirDid: b.did, epoch: 8 })
    const mitm = await derivePairKeys({ ecdh: await ecdh(a, m), secret, myDid: a.did, theirDid: m.did, epoch: 7 })
    expect(new Set([ka.sas, other.sas, ep.sas, mitm.sas]).size).toBe(4)
  })
  it('a frame a device sent cannot be opened as one it received (no reflection)', async () => {
    const { a, b, ka } = await pair()
    const f = await sealFrame(ka.sendKey, { ep: 7, seq: 1 }, a.did, b.did, te.encode('hello'))
    expect(await openFrame(ka.recvKey, b.did, a.did, f)).toBeNull()
    expect(await openFrame(ka.recvKey, a.did, b.did, f)).toBeNull()
  })
  it('the offer key depends on the secret and the offering DID', async () => {
    const { did } = await device()
    const s = crypto.getRandomValues(new Uint8Array(32))
    const k1 = await offerKey(s, did)
    const k2 = await offerKey(s, did + 'x')
    const f = await sealFrame(k1, { ep: 0, seq: 0 }, 'did:peer:2.from', did, te.encode('pair'))
    expect(await openFrame(k1, 'did:peer:2.from', did, f)).not.toBeNull()
    expect(await openFrame(k2, 'did:peer:2.from', did, f)).toBeNull()
  })
})

describe('sealed frames', () => {
  it('round-trips and carries epoch and sequence in the clear header, bound into the seal', async () => {
    const { a, b, ka, kb } = await pair()
    const seq = nextSeq(0, 1_800_000_000_000)
    const f = await sealFrame(ka.sendKey, { ep: 7, seq }, a.did, b.did, te.encode('{"t":"have"}'))
    expect(peekFrame(f)).toEqual({ ep: 7, seq })
    const o = await openFrame(kb.recvKey, a.did, b.did, f)
    expect(o).toMatchObject({ ep: 7, seq })
    expect(td.decode(o.plaintext)).toBe('{"t":"have"}')
  })
  it('the relay sees no plaintext: a marker in the payload never shows in the wire', async () => {
    const { a, b, ka } = await pair()
    const marker = 'EXAMPLE-NOTE-MARKER'
    const f = await sealFrame(ka.sendKey, { ep: 7, seq: 1 }, a.did, b.did, te.encode(marker.repeat(20)))
    expect(f.includes(marker)).toBe(false)
    expect(Buffer.from(f, 'base64url').toString('latin1').includes(marker)).toBe(false)
  })
  it('any flipped byte, a swapped sender or recipient, or a rewritten header fails to open', async () => {
    const { a, b, ka, kb } = await pair()
    const f = await sealFrame(ka.sendKey, { ep: 7, seq: 5 }, a.did, b.did, te.encode('payload'))
    const raw = Buffer.from(f, 'base64url')
    for (const i of [0, 3, 10, 14, raw.length - 1]) {
      const t = Buffer.from(raw)
      t[i] ^= 1
      expect(await openFrame(kb.recvKey, a.did, b.did, t.toString('base64url'))).toBeNull()
    }
    expect(await openFrame(kb.recvKey, b.did, a.did, f)).toBeNull()
    expect(await openFrame(kb.recvKey, a.did, 'did:peer:2.someone-else', f)).toBeNull()
    expect(await openFrame(kb.recvKey, a.did, b.did, 'not base64 ~~~')).toBeNull()
    expect(await openFrame(kb.recvKey, a.did, b.did, '')).toBeNull()
  })
  it('pads to fixed buckets so the relay learns a size class, not a size', async () => {
    const { a, b, ka } = await pair()
    const one = await sealFrame(ka.sendKey, { ep: 7, seq: 1 }, a.did, b.did, te.encode('x'))
    const many = await sealFrame(ka.sendKey, { ep: 7, seq: 2 }, a.did, b.did, te.encode('x'.repeat(200)))
    expect(one.length).toBe(many.length)
    expect(padLen(1)).toBe(BUCKETS[0])
    expect(padLen(BUCKETS[0] - 4)).toBe(BUCKETS[0])
    expect(padLen(BUCKETS[0] - 3)).toBe(BUCKETS[1])
    expect(padLen(BUCKETS[BUCKETS.length - 1] + 1) % BUCKETS[BUCKETS.length - 1]).toBe(0)
  })
  it('the largest frame the link sends stays under the relay limit of 128 KB on the wire', async () => {
    const { a, b, ka } = await pair()
    const f = await sealFrame(ka.sendKey, { ep: 7, seq: 1 }, a.did, b.did, new Uint8Array(BUCKETS[BUCKETS.length - 1] - 4))
    expect(f.length).toBeLessThan(128 * 1024)
  })
})

describe('replay guard', () => {
  it('accepts each sequence number once, in any order, and refuses repeats', () => {
    let st = { floor: 0, seen: [] }
    for (const s of [5, 3, 9]) {
      expect(isReplay(st, s)).toBe(false)
      st = admit(st, s)
    }
    for (const s of [5, 3, 9, 0]) expect(isReplay(st, s)).toBe(true)
    expect(isReplay(st, 4)).toBe(false)
  })
  it('a bounded window: once it is full, everything at or under the oldest it forgot is refused', () => {
    let st = { floor: 0, seen: [] }
    for (let s = 1; s <= REPLAY_WINDOW + 10; s++) st = admit(st, s * 10)
    expect(st.seen.length).toBe(REPLAY_WINDOW)
    expect(st.floor).toBe(100)
    expect(isReplay(st, 95)).toBe(true)
    expect(isReplay(st, 105)).toBe(false)
  })
  it('admit does not change the state it was given', () => {
    const st = { floor: 0, seen: [1] }
    admit(st, 2)
    expect(st).toEqual({ floor: 0, seen: [1] })
  })
  it('the send counter only grows, also after a restore from an older backup', () => {
    const t = 1_800_000_000_000
    const s1 = nextSeq(0, t)
    const s2 = nextSeq(s1, t)
    expect(s2).toBeGreaterThan(s1)
    const restored = nextSeq(0, t + 60_000)
    expect(restored).toBeGreaterThan(s2)
    expect(Number.isSafeInteger(nextSeq(0, 4_000_000_000_000))).toBe(true)
  })
})
