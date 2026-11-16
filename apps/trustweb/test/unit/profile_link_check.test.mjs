// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** answers-44a (Q7): one rel="me" checker (profile_fields.ts checkProfileLink) for the app and MCP profile_link_check; the MCP's origin is the setting profile.origin. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { checkProfileLink, ORIGIN_NOT_SET } from '../../src/profile_fields.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'

const page = (html, ok = true) => async () => ({ ok, text: async () => html })
const BACK = '<html><a rel="me" href="https://app.example/p/1">me</a></html>'

describe('profile.origin setting', () => {
  it('defaults to empty; takes an https address (trailing slash dropped); refuses anything else; empty clears it', () => {
    const r = {}
    expect(readSetting(r, 'profile.origin')).toBe('')
    expect(writeSetting(r, 'profile.origin', 'https://app.example/')).toBe('https://app.example')
    expect(r.profileOrigin).toBe('https://app.example')
    expect(() => writeSetting(r, 'profile.origin', 'ftp://app.example')).toThrow(/https/)
    expect(() => writeSetting(r, 'profile.origin', 'https://app.example/path')).toThrow(/https/)
    writeSetting(r, 'profile.origin', '')
    expect(r).toEqual({})
  })
})

describe('checkProfileLink (the one checker)', () => {
  const me = () => ({ profile: { links: [{ label: 'Site', url: 'https://e.test/a' }] } })
  it('origin not set: no fetch, the answer says so', async () => {
    let fetched = 0
    const m = me()
    expect(await checkProfileLink(m, 'https://e.test/a', '', async () => { fetched++; return { ok: true, text: async () => BACK } })).toEqual({ verified: false, reason: ORIGIN_NOT_SET })
    expect(fetched).toBe(0)
    expect(ORIGIN_NOT_SET).toBe('origin not set')
  })
  it('marks the link verified when the page links back with rel="me", clears the mark when it does not', async () => {
    const m = me()
    expect(await checkProfileLink(m, 'https://e.test/a', 'https://app.example', page(BACK))).toEqual({ verified: true })
    expect(m.profile.links[0].verified).toBe(true)
    expect(await checkProfileLink(m, 'https://e.test/a', 'https://app.example', page('<a href="https://app.example">no rel</a>'))).toEqual({ verified: false })
    expect(m.profile.links[0].verified).toBeUndefined()
  })
  it('a URL that is not one of the links is refused', async () => {
    await expect(checkProfileLink(me(), 'https://other.test', 'https://app.example', page(BACK))).rejects.toThrow(/no such link/)
  })
})

describe('MCP profile_link_check', () => {
  function fixture(html = BACK) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-plc-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ada Lovelace', profile: { links: [{ label: 'Site', url: 'https://e.test/a' }] } }, people: [], sameAs: {}, meetings: [] }))
    const tools = allTools({ file, write: true, now: () => new Date('2026-11-16T10:00:00Z'), embedFetch: page(html) })
    return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('is in MCP_TOOLS as a write tool', () => {
    expect(MCP_TOOLS.find((t) => t.name === 'profile_link_check')).toEqual({ name: 'profile_link_check', write: true })
  })
  it('without profile.origin it answers "origin not set" and stores nothing', async () => {
    const f = fixture()
    expect(await f.by.profile_link_check.run({ url: 'https://e.test/a' })).toEqual({ url: 'https://e.test/a', verified: false, reason: 'origin not set' })
    expect(f.rec().me.profile.links[0].verified).toBeUndefined()
  })
  it('with profile.origin set (settings_set) it checks and stores the mark', async () => {
    const f = fixture()
    f.by.settings_set.run({ id: 'profile.origin', value: 'https://app.example' })
    expect(await f.by.profile_link_check.run({ url: 'https://e.test/a' })).toEqual({ url: 'https://e.test/a', verified: true })
    expect(f.rec().me.profile.links[0].verified).toBe(true)
    await expect(Promise.resolve().then(() => f.by.profile_link_check.run({ url: 'https://nope.test' }))).rejects.toThrow(/no such link/)
  })
})
