// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b hide-from-crypto (43b-D7): the sealed exclusion list of an ask. Fake identities only. */
import { createIdentity } from '../../../demo/src/did.ts'
import { HIDE_BLOB_REQUIRED, HideFromNet } from '../../src/hide_from_net.ts'
import { toB64u } from '../../../demo/src/crypto.ts'
import {
  ASK_EXCLUSION_V, HIDE_BLOB_MAX_JSON, HIDE_BUCKET, HIDE_TAGS_MAX, blobHash, deriveHopSecret, isExcluded, makeTamperReport, newAskSecret,
  openHideReport, parseHideReportWire, sealHideReport, signAskExclusion, tagSet, verifyAskExclusion, verifyLevelKey, verifyTamperReport,
} from '../../src/hide_from_crypto.ts'

const ORIGIN = 'https://relay.example/relay'
const asker = createIdentity(ORIGIN)
const friend = createIdentity(ORIGIN)
const fof = createIdentity(ORIGIN)
const hidden = createIdentity(ORIGIN)
const other = createIdentity(ORIGIN)
const ROOT = 'rootRoot1234'
const NOW = 1_800_000_000_000

async function blobFor(dids = [hidden.did], maxHops = 3, s0 = newAskSecret()) {
  const blob = await signAskExclusion(asker, { root: ROOT, maxHops, issuedAt: NOW, s0, dids })
  return { blob, s0 }
}
const ctx = (over = {}) => ({ root: ROOT, maxHops: 3, hop: 1, now: NOW + 1000, senderDid: friend.did, ...over })

describe('hide_from_crypto: the exclusion list as signed keyed tags', () => {
  it('round trip: a signed blob verifies; the hidden DID tests excluded at every level, another DID does not', async () => {
    const { blob, s0 } = await blobFor()
    expect(blob.v).toBe(ASK_EXCLUSION_V)
    expect(verifyAskExclusion(blob, ctx())).toBe('ok')
    expect(verifyAskExclusion(blob, ctx({ hop: 0, senderDid: asker.did }))).toBe('ok')
    for (const level of [1, 2]) {
      const sk = deriveHopSecret(s0, ROOT, level)
      expect(await isExcluded(blob, level, sk, [hidden.did])).toBe(true)
      expect(await isExcluded(blob, level, sk, [other.did, fof.did])).toBe(false)
      expect(await isExcluded(blob, level, sk, [other.did, hidden.did])).toBe(true)
    }
  })

  it('a friend cannot read E: the blob holds no DID but the asker\'s, tags differ per level, the set is padded to a bucket', async () => {
    const { blob, s0 } = await blobFor([hidden.did], 4)
    const json = JSON.stringify(blob)
    expect(json).not.toContain(hidden.did)
    expect(blob.t).toHaveLength(3) // levels 1..maxHops-1
    for (const level of blob.t) expect(level).toHaveLength(HIDE_BUCKET)
    const flat = blob.t.flat()
    expect(new Set(flat).size).toBe(flat.length) // the hidden person's tag is never the same twice
    // the wrong level's secret finds nothing; the level secret of level 2 cannot go back to level 1
    expect(await isExcluded(blob, 1, deriveHopSecret(s0, ROOT, 2), [hidden.did])).toBe(false)
    // an empty list looks the same as a list of one
    const empty = await blobFor([], 4)
    expect(empty.blob.t.map((l) => l.length)).toEqual(blob.t.map((l) => l.length))
    expect(await isExcluded(empty.blob, 1, deriveHopSecret(empty.s0, ROOT, 1), [hidden.did])).toBe(false)
  })

  it('tag sets of two asks for the same person share no tag (a per-ask secret)', async () => {
    const a = await tagSet(newAskSecret(), [hidden.did, other.did])
    const b = await tagSet(newAskSecret(), [hidden.did, other.did])
    expect(a.filter((t) => b.includes(t))).toEqual([])
  })

  it('a tampered blob fails: a tag removed or changed, the reach raised, another root, another asker, re-signed by a forwarder', async () => {
    const { blob } = await blobFor()
    const minus = { ...blob, t: [blob.t[0].slice(1).concat([toB64u(new Uint8Array(16))]), blob.t[1]] }
    expect(verifyAskExclusion(minus, ctx())).toBe('tampered')
    expect(verifyAskExclusion({ ...blob, m: 4 }, ctx({ maxHops: 4 }))).toBe('tampered')
    expect(verifyAskExclusion(blob, ctx({ maxHops: 4 }))).toBe('tampered')
    expect(verifyAskExclusion(blob, ctx({ root: 'otherRoot99' }))).toBe('tampered')
    // ci-fix-44: change the first char (R); the old `slice(0, -2) + 'AA'` zeroed S's top byte, already 0 in ~1 of 16 signatures (no-op tamper)
    expect(verifyAskExclusion({ ...blob, g: (blob.g[0] === 'A' ? 'B' : 'A') + blob.g.slice(1) }, ctx())).toBe('tampered')
    // the direct contact receives it from the asker only
    expect(verifyAskExclusion(blob, ctx({ hop: 0, senderDid: friend.did }))).toBe('tampered')
    // a forwarder that signs its own empty list as "the asker" is caught by the next device (the asker is not the sender further out)
    const forged = await signAskExclusion(friend, { root: ROOT, maxHops: 3, issuedAt: NOW, s0: newAskSecret(), dids: [] })
    expect(verifyAskExclusion(forged, ctx({ senderDid: friend.did }))).toBe('tampered')
    expect(verifyAskExclusion(null, ctx())).toBe('tampered')
    expect(verifyAskExclusion({ ...blob, x: NOW - 1 }, ctx())).toBe('tampered')
    expect(verifyAskExclusion(blob, ctx({ now: blob.x + 1 }))).toBe('tampered')
  })

  it('review-44: the level secret is bound to the signed blob: a forwarder handing on another key is caught', async () => {
    const { blob, s0 } = await blobFor([hidden.did], 4)
    for (const level of [0, 1, 2, 3]) expect(await verifyLevelKey(blob, level, deriveHopSecret(s0, ROOT, level))).toBe(true)
    expect(await verifyLevelKey(blob, 1, newAskSecret())).toBe(false)
    expect(await verifyLevelKey(blob, 1, deriveHopSecret(s0, ROOT, 2))).toBe(false)
    expect(await verifyLevelKey(blob, 4, deriveHopSecret(s0, ROOT, 4))).toBe(false)
    // the commitments are signed: swapping one breaks the signature
    expect(verifyAskExclusion({ ...blob, k: [...blob.k].reverse() }, ctx({ maxHops: 4 }))).toBe('tampered')
    expect(verifyAskExclusion({ ...blob, k: blob.k.slice(1) }, ctx({ maxHops: 4 }))).toBe('tampered')
  })

  it('an unknown version is "unsupported" (never forwarded unverified)', async () => {
    const { blob } = await blobFor()
    expect(verifyAskExclusion({ ...blob, v: ASK_EXCLUSION_V + 1 }, ctx())).toBe('unsupported')
  })

  it('size: HIDE_TAGS_MAX hidden at the furthest reach stays under HIDE_BLOB_MAX_JSON; more is refused', async () => {
    const many = Array.from({ length: HIDE_TAGS_MAX }, () => createIdentity(ORIGIN).did)
    const { blob } = await blobFor(many, 6)
    expect(JSON.stringify(blob).length).toBeLessThanOrEqual(HIDE_BLOB_MAX_JSON)
    await expect(blobFor([...many, other.did], 2)).rejects.toThrow(RangeError)
  })
})

describe('hide_from_crypto: the tamper report', () => {
  async function report(over = {}) {
    const { blob, s0 } = await blobFor()
    const received = { ...blob, t: [[], blob.t[1]] }
    const sk = deriveHopSecret(s0, ROOT, 1)
    const rep = await makeTamperReport({ root: ROOT, hop: 1, received, why: 'tampered', sk, at: NOW + 2000, ...over })
    return { blob, s0, rep, sentHash: await blobHash(blob) }
  }
  const vctx = (r, over = {}) => ({ root: ROOT, s0: r.s0, sentHash: r.sentHash, seen: [], now: NOW + 3000, ...over })

  it('a genuine report verifies (MAC with the level secret) and records its nonce', async () => {
    const r = await report()
    const got = await verifyTamperReport(r.rep, vctx(r))
    expect(got.ok).toBe(true)
    expect(got.seen).toEqual([r.rep.n])
    expect(got.report).toMatchObject({ hop: 1, why: 'tampered' })
  })

  it('a forged report is rejected: no level secret, a changed field, another ask, the genuine blob\'s hash', async () => {
    const r = await report()
    expect((await verifyTamperReport({ ...r.rep, hop: 2 }, vctx(r))).ok).toBe(false)
    expect((await verifyTamperReport({ ...r.rep, why: 'unsupported' }, vctx(r))).ok).toBe(false)
    expect((await verifyTamperReport(r.rep, vctx(r, { root: 'otherRoot99' }))).ok).toBe(false)
    const guessed = await makeTamperReport({ root: ROOT, hop: 1, received: {}, why: 'tampered', sk: newAskSecret(), at: NOW })
    expect((await verifyTamperReport(guessed, vctx(r))).ok).toBe(false)
    const honestBlob = await makeTamperReport({ root: ROOT, hop: 1, received: r.blob, why: 'tampered', sk: deriveHopSecret(r.s0, ROOT, 1), at: NOW })
    expect((await verifyTamperReport(honestBlob, vctx(r)))).toMatchObject({ ok: false, reason: 'not-tampered' })
    expect((await verifyTamperReport('junk', vctx(r))).ok).toBe(false)
  })

  it('a replayed report is rejected', async () => {
    const r = await report()
    const first = await verifyTamperReport(r.rep, vctx(r))
    expect(await verifyTamperReport(r.rep, vctx(r, { seen: first.seen }))).toMatchObject({ ok: false, reason: 'replay' })
  })

  it('answers-44a (Q3): the report names nobody: no reporter DID, no signature; hop index and blob hash stay', async () => {
    const r = await report()
    expect(Object.keys(r.rep).sort()).toEqual(['at', 'h', 'hop', 'mac', 'n', 'r', 'v', 'why'])
    expect(JSON.stringify(r.rep)).not.toContain(fof.did)
    expect(r.rep.hop).toBe(1)
    expect(r.rep.h).toBe(await blobHash({ ...r.blob, t: [[], r.blob.t[1]] }))
  })

  it('answers-44a (Q3): sealed straight to the asker\'s DID: only the asker opens it, the wire names no reporter, a changed byte fails', async () => {
    const r = await report()
    const wire = await sealHideReport(r.rep, asker.did)
    expect(wire).not.toContain(fof.did)
    expect(wire).not.toContain(asker.did)
    const parsed = parseHideReportWire(wire)
    expect(parsed).not.toBeNull()
    expect(await openHideReport(parsed, asker)).toEqual(r.rep)
    expect(await openHideReport(parsed, other)).toBeNull()
    const c = parsed.c
    const flipped = { ...parsed, c: (c[0] === 'A' ? 'B' : 'A') + c.slice(1) }
    expect(await openHideReport(flipped, asker)).toBeNull()
    expect(parseHideReportWire('{"t":"connect-ack2"}')).toBeNull()
    expect(parseHideReportWire('junk')).toBeNull()
    expect(parseHideReportWire(JSON.stringify({ ...JSON.parse(wire), c: 'A'.repeat(5000) }))).toBeNull()
  })
})

describe('review-44: an ask without a blob (a build before wave 44, or stripped on the way)', () => {
  it('HIDE_BLOB_REQUIRED is off (Q for Jakob): honoured past hop 0 while older phones are about; on: dropped', async () => {
    expect(HIDE_BLOB_REQUIRED).toBe(false)
    const net = new HideFromNet({ identity: () => friend, state: () => ({}), save: () => {}, send: async () => {} })
    expect((await net.gate({ qid: 'q1234567' }, { root: ROOT, maxHops: 3, hop: 1, senderDid: friend.did, now: NOW })).drop).toBe(false)
  })
})
