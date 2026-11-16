// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c social-hosting: the signed name record and the signed intent (pure; the signer and verifier are injected). */
import { createIdentity, signBytes, verifyDidSignature } from '../../../demo/src/did.ts'
import { makeIntent, makeRecord, newest, normName, verifyIntent, verifyRecord } from '../../src/name_record.ts'

const me = createIdentity('https://x.test')
const other = createIdentity('https://y.test')
const sign = (id) => (bytes) => signBytes(id, bytes)
const rec = (over = {}) => makeRecord(sign(me), { first: 'Ada', last: 'Lovelace', key: me.did, ts: 1000, open: true, srv: true, ...over })

describe('normName', () => {
  it('is case-insensitive and squashes spaces', () => {
    expect(normName('Ada', 'Lovelace')).toBe('ada lovelace')
    expect(normName('  ADA ', 'Love  lace')).toBe('ada love lace')
    expect(normName('Zoë', 'K')).toBe(normName('zoë', 'k'))
  })
})

describe('record', () => {
  it('verifies with the key inside its own did', () => {
    expect(verifyRecord(rec(), verifyDidSignature)).toBe(true)
  })
  it('hosts[] is advisory: changing it keeps the signature valid', () => {
    expect(verifyRecord({ ...rec(), hosts: ['did:a', 'did:b'] }, verifyDidSignature)).toBe(true)
  })
  it('any signed field changed breaks it', () => {
    for (const patch of [{ first: 'Eve' }, { last: 'X' }, { ts: 1001 }, { open: false }, { srv: false }, { key: other.did }]) {
      expect(verifyRecord({ ...rec(), ...patch }, verifyDidSignature)).toBe(false)
    }
  })
  it('a record signed by another key does not verify for this key', () => {
    const forged = makeRecord(sign(other), { first: 'Ada', last: 'Lovelace', key: me.did, ts: 5, open: true, srv: true })
    expect(verifyRecord(forged, verifyDidSignature)).toBe(false)
  })
  it('rejects bad shapes without throwing', () => {
    for (const bad of [null, 1, 'x', {}, { ...rec(), v: 2 }, { ...rec(), first: '' }, { ...rec(), last: 'x'.repeat(61) }, { ...rec(), ts: 'now' }, { ...rec(), hosts: 'a' }, { ...rec(), hosts: Array(21).fill('d') }, { ...rec(), sig: 3 }, { ...rec(), open: 1 }]) {
      expect(verifyRecord(bad, verifyDidSignature)).toBe(false)
    }
  })
  it('newest picks the highest ts among valid records only', () => {
    const a = rec({ ts: 1 }); const b = rec({ ts: 9 }); const c = { ...rec({ ts: 99 }), sig: 'AAAA' }
    expect(newest([a, b, c], verifyDidSignature)?.ts).toBe(9)
    expect(newest([c], verifyDidSignature)).toBeNull()
    expect(newest([], verifyDidSignature)).toBeNull()
  })
})

describe('intent', () => {
  const intent = (over = {}) => makeIntent(sign(me), { to: other.did, first: 'Ada', last: 'Lovelace', key: me.did, ts: 5, ...over })
  it('verifies and carries who wants to connect', () => {
    const i = intent()
    expect(i.to).toBe(other.did)
    expect(i.from).toEqual({ first: 'Ada', last: 'Lovelace', key: me.did })
    expect(verifyIntent(i, verifyDidSignature)).toBe(true)
  })
  it('a changed target, sender or time breaks it', () => {
    const i = intent()
    expect(verifyIntent({ ...i, to: me.did }, verifyDidSignature)).toBe(false)
    expect(verifyIntent({ ...i, from: { ...i.from, first: 'Eve' } }, verifyDidSignature)).toBe(false)
    expect(verifyIntent({ ...i, ts: 6 }, verifyDidSignature)).toBe(false)
    expect(verifyIntent(null, verifyDidSignature)).toBe(false)
  })
})
