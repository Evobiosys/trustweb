// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave44b profile-page, MCP parity (D-P02): profile_get, profile_set, profile_link_add/remove. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-prof-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ada Lovelace' }, people: [], sameAs: {}, meetings: [] }))
  const tools = allTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('profile tools', () => {
  it('are in MCP_TOOLS with the right write flags; get is a read', () => {
    const w = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.write]))
    expect([w.profile_get, w.profile_set, w.profile_link_add, w.profile_link_remove]).toEqual([false, true, true, true])
    const ro = Object.keys(fixture(false).by)
    expect(ro).toContain('profile_get')
    expect(ro).not.toContain('profile_set')
  })
  it('profile_get starts empty with every visibility "me"', () => {
    const g = fixture().by.profile_get.run({})
    expect(g.displayName).toBe('Ada Lovelace')
    expect(g.fields).toEqual({})
    expect(g.visibility.bio).toBe('me')
    expect(g.directoryCarries).toEqual({})
  })
  it('profile_set stores fields, name and visibility; the directory carries only discoverable ones', () => {
    const f = fixture()
    const out = f.by.profile_set.run({ displayName: 'Ada L', fields: { prefix: 'Countess', bio: 'maths', nickname: 'Ad' }, visibility: { bio: 'discoverable' } })
    expect(out.fields).toEqual({ prefix: 'Countess', bio: 'maths', nickname: 'Ad' })
    expect(out.directoryCarries).toEqual({ bio: 'maths' })
    expect(f.rec().me).toMatchObject({ displayName: 'Ada L', nickname: 'Ad', profile: { fields: { prefix: 'Countess', bio: 'maths' }, vis: { bio: 'discoverable' } } })
  })
  it('profile_set refuses bad input and stores nothing', () => {
    const f = fixture()
    expect(() => f.by.profile_set.run({ fields: { shoe: '1' } })).toThrow(/unknown field/)
    expect(() => f.by.profile_set.run({ visibility: { bio: 'everyone' } })).toThrow(/me, trusted, discoverable/)
    expect(() => f.by.profile_set.run({ displayName: '  ' })).toThrow(/empty/)
    expect(f.rec().me.profile).toBeUndefined()
  })
  it('links: add, list, remove, limits', () => {
    const f = fixture()
    f.by.profile_link_add.run({ label: 'Site', url: 'https://e.test/a' })
    expect(f.by.profile_get.run({}).links).toEqual([{ label: 'Site', url: 'https://e.test/a' }])
    expect(() => f.by.profile_link_add.run({ label: 'x', url: 'http://e.test' })).toThrow(/https/)
    f.by.profile_link_remove.run({ url: 'https://e.test/a' })
    expect(f.rec().me.profile).toBeUndefined()
    expect(() => f.by.profile_link_remove.run({ url: 'https://e.test/a' })).toThrow(/no such link/)
  })
})
