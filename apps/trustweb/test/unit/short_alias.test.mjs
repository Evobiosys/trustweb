// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Host-scoped short alias (src/short_alias.ts): token shape, link, own alias once, signed succession on rotation, shortLinkFor.
import { aliasUrl, ensureOwnAlias, isToken, makeToken, registerAlias, rotateAliases, shortLinkFor, signSuccession, verifySuccession } from '../../src/short_alias.ts'
import { createIdentity } from '../../../demo/src/did.ts'

const HOST = 'app.trustweb.one'
const NOW = 1_800_000_000_000

describe('token', () => {
  it('makeToken: 10 lowercase base32 chars, random each time', () => {
    const a = makeToken()
    expect(a).toMatch(/^[a-z2-7]{10}$/)
    expect(isToken(a)).toBe(true)
    expect(makeToken()).not.toBe(a)
  })
  it('isToken refuses other shapes', () => {
    for (const bad of ['', 'abc', 'ABCDEFGHIJ', 'abcdefghi1', 'abcdefghijk', 'abcdefghi/', 42, null]) expect(isToken(bad)).toBe(false)
  })
  it('aliasUrl: https://<host>/s/<token>, about 37 chars on app.trustweb.one', () => {
    const url = aliasUrl(HOST, 'abcdefghij')
    expect(url).toBe('https://app.trustweb.one/s/abcdefghij')
    expect(url.length).toBeLessThan(40)
  })
})

describe('ensureOwnAlias', () => {
  it('creates one alias per did, once', () => {
    const first = ensureOwnAlias({}, 'did:a', NOW, () => 'aaaaaaaaaa')
    expect(first).toEqual({ token: 'aaaaaaaaaa', created: true, aliases: { aaaaaaaaaa: { did: 'did:a', createdAt: NOW } } })
    const again = ensureOwnAlias(first.aliases, 'did:a', NOW + 1, () => 'bbbbbbbbbb')
    expect(again.token).toBe('aaaaaaaaaa')
    expect(again.created).toBe(false)
    expect(again.aliases).toBe(first.aliases)
  })
  it('draws again on a collision with another did', () => {
    const seq = ['aaaaaaaaaa', 'bbbbbbbbbb']
    const out = ensureOwnAlias({ aaaaaaaaaa: { did: 'did:x', createdAt: 1 } }, 'did:a', NOW, () => seq.shift())
    expect(out.token).toBe('bbbbbbbbbb')
  })
})

describe('succession and rotation', () => {
  const oldId = createIdentity('https://x.test')
  const newId = createIdentity('https://x.test')
  it('the new key signs a record naming the old did; it verifies', () => {
    const s = signSuccession(oldId.did, newId, NOW)
    expect(s.old).toBe(oldId.did)
    expect(s.new).toBe(newId.did)
    expect(verifySuccession(s)).toBe(true)
  })
  it('a tampered record does not verify', () => {
    const s = signSuccession(oldId.did, newId, NOW)
    expect(verifySuccession({ ...s, old: 'did:other' })).toBe(false)
    expect(verifySuccession({ ...s, sig: s.sig.slice(1) + 'A' })).toBe(false)
    expect(verifySuccession({ ...s, new: 'not-a-did' })).toBe(false)
  })
  it('rotateAliases: same token, new did, succession kept; unrelated aliases untouched', () => {
    const aliases = { aaaaaaaaaa: { did: oldId.did, createdAt: 1 }, bbbbbbbbbb: { did: 'did:z', createdAt: 2 } }
    const s = signSuccession(oldId.did, newId, NOW)
    const out = rotateAliases(aliases, s)
    expect(out.aaaaaaaaaa).toEqual({ did: newId.did, createdAt: 1, succession: s })
    expect(out.bbbbbbbbbb).toBe(aliases.bbbbbbbbbb)
  })
  it('rotateAliases refuses an unverifiable record', () => {
    const aliases = { aaaaaaaaaa: { did: oldId.did, createdAt: 1 } }
    const s = { ...signSuccession(oldId.did, newId, NOW), at: NOW + 1 }
    expect(rotateAliases(aliases, s)).toBe(aliases)
  })
})

describe('shortLinkFor', () => {
  const aliases = { aaaaaaaaaa: { did: 'did:a', createdAt: 1 } }
  it('person and me: the alias link of that did, else null', () => {
    expect(shortLinkFor(aliases, HOST, 'me', 'did:a')).toBe('https://app.trustweb.one/s/aaaaaaaaaa')
    expect(shortLinkFor(aliases, HOST, 'person', 'did:a')).toBe('https://app.trustweb.one/s/aaaaaaaaaa')
    expect(shortLinkFor(aliases, HOST, 'person', 'did:nope')).toBeNull()
  })
  it('zone: no alias yet', () => {
    expect(shortLinkFor(aliases, HOST, 'zone', 'z1')).toBeNull()
  })
})

describe('registerAlias', () => {
  const record = { code: 'C'.repeat(22), secret: 'S'.repeat(43), url: 'https://x/', updatedAt: 1 }
  it('POSTs {code, secret, token, did, succession?} to /s and reports ok on 200/201', async () => {
    const calls = []
    const fetch = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { status: 201, json: async () => ({}) } }
    const ok = await registerAlias({ origin: 'https://app.trustweb.one', fetch, now: () => NOW }, record, 'aaaaaaaaaa', { did: 'did:a', createdAt: 1 })
    expect(ok).toBe(true)
    expect(calls[0][0]).toBe('https://app.trustweb.one/s')
    expect(calls[0][1]).toEqual({ code: record.code, secret: record.secret, token: 'aaaaaaaaaa', did: 'did:a' })
  })
  it('false on refusal or network failure', async () => {
    const deny = async () => ({ status: 403, json: async () => ({}) })
    expect(await registerAlias({ origin: 'https://o', fetch: deny, now: () => NOW }, record, 'aaaaaaaaaa', { did: 'd', createdAt: 1 })).toBe(false)
    const boom = async () => { throw new Error('net') }
    expect(await registerAlias({ origin: 'https://o', fetch: boom, now: () => NOW }, record, 'aaaaaaaaaa', { did: 'd', createdAt: 1 })).toBe(false)
  })
})
