// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c social-hosting (P02, MCP parity): the five tools and the registry entries behind them. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createIdentity, signBytes } from '../../../demo/src/did.ts'
import { makeRecord } from '../../src/name_record.ts'
import { SETTINGS_REGISTRY, readSetting, writeSetting } from '../../src/settings_registry.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { allTools } from '../../../mcp/src/tools.ts'

const P = (id, ring, over = {}) => ({ id, name: id, context: '', ring, metAt: 0, lines: [], ...over })
const ada = createIdentity('https://a.test')
const rec = (over = {}) => makeRecord((b) => signBytes(ada, b), { first: 'Ada', last: 'Lovelace', key: ada.did, ts: 5, open: true, srv: true, ...over })

function fixture(over = {}, fetch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-soc-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'm', displayName: 'Me Self' }, people: [P('a', 'friend'), P('b', 'close')], ...over }))
  const tools = allTools({ file, write: true, now: () => new Date('2026-11-16T10:00:00Z'), fetch })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('registry entries (reachable through settings_set too)', () => {
  const ids = ['profile.discoverable', 'profile.openToConnect', 'hosting.friends', 'trust.only', 'directory.servers']
  it('exist, are not on the short page, and read their defaults', () => {
    for (const id of ids) expect(SETTINGS_REGISTRY.find((d) => d.id === id)?.simple, id).toBe(false)
    expect(ids.map((id) => readSetting({}, id))).toEqual([false, true, 'closest', false, ''])
  })
  it('store only what differs from the default', () => {
    const r = {}
    writeSetting(r, 'profile.discoverable', true); expect(r.discoverable).toBe(true)
    writeSetting(r, 'profile.discoverable', false); expect('discoverable' in r).toBe(false)
    writeSetting(r, 'profile.openToConnect', false); expect(r.discoverOpen).toBe(false)
    writeSetting(r, 'profile.openToConnect', true); expect('discoverOpen' in r).toBe(false)
    writeSetting(r, 'hosting.friends', 'close'); expect(r.hostFriends).toBe('close')
    writeSetting(r, 'hosting.friends', 'closest'); expect('hostFriends' in r).toBe(false)
    writeSetting(r, 'trust.only', true); expect(r.trustedOnly).toBe(true)
    writeSetting(r, 'trust.only', false); expect('trustedOnly' in r).toBe(false)
  })
  it('directory.servers takes a comma list of https servers, cuts duplicates and slashes, refuses the rest', () => {
    const r = {}
    expect(writeSetting(r, 'directory.servers', 'https://a.test/, https://b.test,https://a.test')).toBe('https://a.test, https://b.test')
    expect(r.directoryServers).toEqual(['https://a.test', 'https://b.test'])
    expect(() => writeSetting(r, 'directory.servers', 'http://evil.test')).toThrow(/https/)
    expect(writeSetting(r, 'directory.servers', '')).toBe(''); expect('directoryServers' in r).toBe(false)
  })
})

describe('tools', () => {
  it('are announced in the app\'s tool list, reads marked as reads', () => {
    for (const [name, write] of [['directory_search', false], ['profile_discoverable_set', true], ['hosting_set', true], ['trusted_only_set', true], ['trust_override_set', true]]) {
      expect(MCP_TOOLS.find((t) => t.name === name)?.write, name).toBe(write)
    }
  })
  it('profile_discoverable_set needs a first and a last name, then stores the switch (and the open flag)', () => {
    const { by, rec: r } = fixture()
    expect(by.profile_discoverable_set.run({ on: true, open: false })).toMatchObject({ discoverable: true, open: false })
    expect(r()).toMatchObject({ discoverable: true, discoverOpen: false })
    expect(by.profile_discoverable_set.run({ on: false })).toMatchObject({ discoverable: false, open: false })
    expect('discoverable' in r()).toBe(false)
    const one = fixture({ me: { id: 'm', displayName: 'Solo' } })
    expect(() => one.by.profile_discoverable_set.run({ on: true })).toThrow(/first and last name/)
    expect(() => by.profile_discoverable_set.run({ on: 'yes' })).toThrow(/true or false/)
  })
  it('profile_discoverable_set says when trusted-only keeps the servers out', () => {
    const { by } = fixture({ trustedOnly: true })
    expect(by.profile_discoverable_set.run({ on: true })).toMatchObject({ discoverable: true, servers: false })
  })
  it('hosting_set takes off | closest | close', () => {
    const { by, rec: r } = fixture()
    expect(by.hosting_set.run({ mode: 'close' })).toEqual({ mode: 'close' })
    expect(r().hostFriends).toBe('close')
    expect(by.hosting_set.run({ mode: 'closest' })).toEqual({ mode: 'closest' })
    expect('hostFriends' in r()).toBe(false)
    expect(() => by.hosting_set.run({ mode: 'all' })).toThrow(/off, closest or close/)
  })
  it('trusted_only_set stores the switch and reports it', () => {
    const { by, rec: r } = fixture()
    expect(by.trusted_only_set.run({ on: true })).toEqual({ trustedOnly: true })
    expect(r().trustedOnly).toBe(true)
    expect(by.trusted_only_set.run({ on: false })).toEqual({ trustedOnly: false })
    expect('trustedOnly' in r()).toBe(false)
  })
  it('trust_override_set sets, replaces and clears one person\'s override', () => {
    const { by, rec: r } = fixture()
    expect(by.trust_override_set.run({ personId: 'a', trust: 'trusted' })).toEqual({ personId: 'a', trust: 'trusted', trusted: true, why: 'override' })
    expect(r().people.find((p) => p.id === 'a').trust).toBe('yes')
    expect(by.trust_override_set.run({ personId: 'b', trust: 'not' })).toMatchObject({ trusted: false, why: 'override' })
    expect(by.trust_override_set.run({ personId: 'b', trust: 'default' })).toEqual({ personId: 'b', trust: 'default', trusted: true, why: 'ring' })
    expect('trust' in r().people.find((p) => p.id === 'b')).toBe(false)
    expect(() => by.trust_override_set.run({ personId: 'zzz', trust: 'trusted' })).toThrow(/no such person/)
    expect(() => by.trust_override_set.run({ personId: 'a', trust: 'maybe' })).toThrow(/trusted, not or default/)
  })
  it('directory_search asks the chosen server for the exact name and returns verified claims, marked not yet connected', async () => {
    const calls = []
    const fetch = async (url) => { calls.push(url); return { status: 200, json: async () => ({ records: [rec(), { ...rec(), last: 'Forged' }] }) } }
    const { by } = fixture({ directoryServers: ['https://srv.test'] }, fetch)
    const out = await by.directory_search.run({ first: 'ADA', last: 'lovelace' })
    expect(calls).toEqual(['https://srv.test/directory?q=ada%20lovelace'])
    expect(out).toEqual({ via: 'server', records: [{ first: 'Ada', last: 'Lovelace', key: ada.did, open: true, connected: false }] })
  })
  it('directory_search marks a person already in my web, and refuses while trusted-only is on (no request at all)', async () => {
    const fetch = async () => ({ status: 200, json: async () => ({ records: [rec()] }) })
    const known = fixture({ people: [P('a', 'friend', { globalKey: ada.did })], peers: [] }, fetch)
    expect((await known.by.directory_search.run({ first: 'Ada', last: 'Lovelace' })).records[0].connected).toBe(true)
    let called = false
    const t = fixture({ trustedOnly: true }, async () => { called = true; return { status: 200, json: async () => ({ records: [] }) } })
    expect(await t.by.directory_search.run({ first: 'Ada', last: 'Lovelace' })).toEqual({ via: null, records: [], blocked: 'trusted_only' })
    expect(called).toBe(false)
  })
  it('directory_search needs both names', async () => {
    const { by } = fixture()
    await expect(async () => by.directory_search.run({ first: 'Ada' })).rejects.toThrow(/first and last/)
  })
})
