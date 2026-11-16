// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b profile-page: the own profile model, the directory projection, the signed `extra`, the Discoverable auto-open. */
import { createIdentity, signBytes, verifyDidSignature } from '../../../demo/src/did.ts'
import { makeRecord, verifyRecord } from '../../src/name_record.ts'
import {
  LINK_MAX, VIS, addLink, directoryExtra, moreOpenAfter, removeLink, setFields, setVis, visOf, profileOf, verifyMeLink,
} from '../../src/profile_fields.ts'

const ada = createIdentity('https://a.test')
const sign = (b) => signBytes(ada, b)
const verify = (did, b, sig) => verifyDidSignature(did, b, sig)

describe('profile model', () => {
  it('stores trimmed text, drops empty values, rejects unknown keys', () => {
    const me = {}
    setFields(me, { prefix: ' Dr. ', nickname: 'Jak', bio: '', pronouns: 'they/them' })
    expect(profileOf(me).fields).toEqual({ prefix: 'Dr.', pronouns: 'they/them' })
    expect(me.nickname).toBe('Jak')
    expect(() => setFields(me, { shoeSize: '44' })).toThrow(/unknown field/)
    setFields(me, { prefix: '' })
    expect(profileOf(me).fields?.prefix).toBeUndefined()
    me.nicknames = ['Jak', 'J']
    setFields(me, { nickname: 'Jay' })
    expect(me.nicknames).toEqual(['Jay', 'J'])
    setFields(me, { nickname: '' })
    expect(me.nickname).toBeUndefined()
  })
  it('limits text length', () => {
    expect(() => setFields({}, { bio: 'x'.repeat(301) })).toThrow(/too long/)
    expect(() => setFields({}, { nickname: 'x'.repeat(61) })).toThrow(/too long/)
  })
  it('keeps up to four https links, no duplicates', () => {
    const me = {}
    for (let i = 0; i < LINK_MAX; i++) addLink(me, `L${i}`, `https://e.test/${i}`)
    expect(() => addLink(me, 'five', 'https://e.test/5')).toThrow(/at most 4/)
    expect(() => removeLink(me, 'https://nope.test')).toThrow(/no such link/)
    removeLink(me, 'https://e.test/0')
    expect(() => addLink(me, 'again', 'https://e.test/1')).toThrow(/already/)
    expect(profileOf(me).links).toHaveLength(3)
  })
  it('refuses javascript: and plain http links', () => {
    expect(() => addLink({}, 'x', 'javascript:alert(1)')).toThrow(/https/)
    expect(() => addLink({}, 'x', 'http://e.test')).toThrow(/https/)
    expect(() => addLink({}, '', 'https://e.test')).toThrow(/label/)
  })
  it('visibility defaults to me only (I9) and takes only the three chips', () => {
    const me = {}
    expect(visOf(me, 'bio')).toBe('me')
    setVis(me, 'bio', 'discoverable')
    expect(visOf(me, 'bio')).toBe('discoverable')
    expect(VIS).toEqual(['me', 'trusted', 'discoverable'])
    expect(() => setVis(me, 'bio', 'public')).toThrow(/me, trusted, discoverable/)
    setVis(me, 'bio', 'me')
    expect(profileOf(me).vis?.bio).toBeUndefined()
  })
})

describe('directory projection', () => {
  it('carries only the fields marked discoverable', () => {
    const me = {}
    setFields(me, { nickname: 'Jak', bio: 'secret bio', pronouns: 'they/them', location: 'Wachau' })
    addLink(me, 'Site', 'https://e.test/me'); addLink(me, 'Hidden', 'https://h.test/')
    setVis(me, 'nickname', 'discoverable'); setVis(me, 'location', 'trusted'); setVis(me, 'links', 'discoverable')
    const x = directoryExtra(me)
    expect(x).toEqual({ nickname: 'Jak', link0: 'Site\nhttps://e.test/me', link1: 'Hidden\nhttps://h.test/' })
    expect(JSON.stringify(x)).not.toMatch(/secret|they|Wachau/)
  })
  it('is empty when nothing is marked', () => {
    const me = {}; setFields(me, { bio: 'x' })
    expect(directoryExtra(me)).toEqual({})
  })
})

describe('name record extra', () => {
  const base = { first: 'Ada', last: 'Lovelace', key: ada.did, ts: 5, open: true, srv: true }
  it('is signed: verifies, and any change breaks the signature', () => {
    const r = makeRecord(sign, { ...base, extra: { nickname: 'Ad' } })
    expect(r.extra).toEqual({ nickname: 'Ad' })
    expect(verifyRecord(r, verify)).toBe(true)
    expect(verifyRecord({ ...r, extra: { nickname: 'Eve' } }, verify)).toBe(false)
    expect(verifyRecord({ ...r, extra: undefined }, verify)).toBe(false)
  })
  it('a record without extra keeps the old bytes (older records still verify)', () => {
    const r = makeRecord(sign, base)
    expect('extra' in r).toBe(false)
    expect(verifyRecord(r, verify)).toBe(true)
    expect(verifyRecord({ ...r, extra: {} }, verify)).toBe(false)
  })
  it('rejects unknown keys and oversize values', () => {
    expect(verifyRecord(makeRecord(sign, { ...base, extra: { shoe: '44' } }), verify)).toBe(false)
    expect(verifyRecord(makeRecord(sign, { ...base, extra: { bio: 'x'.repeat(400) } }), verify)).toBe(false)
  })
})

describe('Discoverable opens its dependents', () => {
  it('on opens, off collapses', () => {
    expect(moreOpenAfter(true)).toBe(true)
    expect(moreOpenAfter(false)).toBe(false)
  })
})

describe('rel="me" check', () => {
  const page = (html) => async () => ({ ok: true, text: async () => html })
  it('marks a link verified when the page links back with rel=me', async () => {
    const f = page('<a rel="me" href="https://app.test/u/abc">me</a>')
    expect(await verifyMeLink('https://e.test/me', 'https://app.test/u/abc', f)).toBe(true)
  })
  it('false without the back link, on a failing fetch or a non-ok answer', async () => {
    expect(await verifyMeLink('https://e.test/me', 'https://app.test/u/abc', page('<a href="https://app.test/u/abc">x</a>'))).toBe(false)
    expect(await verifyMeLink('https://e.test/me', 'https://app.test/u/abc', async () => { throw new Error('net') })).toBe(false)
    expect(await verifyMeLink('https://e.test/me', 'https://app.test/u/abc', async () => ({ ok: false, text: async () => '' }))).toBe(false)
  })
})
