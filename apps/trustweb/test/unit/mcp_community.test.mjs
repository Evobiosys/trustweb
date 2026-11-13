// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 community-support: the MCP tools for communities and asks for support, over a synthetic record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const P = (id, name, ring, fields = {}, peerId = `peer-${id}`) => ({ id, name, context: '', ring, metAt: 0, lines: [], fields, ...(peerId ? { peerId } : {}) })
const base = () => ({ v: 1, people: [P('a', 'Ada', 'closest'), P('b', 'Ben', 'close', { iyg: 'true' }), P('c', 'Cleo', 'friend', { iyg: 'true' }), P('d', 'Dan', 'acquaintance', { iyg: 'true' }), P('e', 'Eve', 'friend', {}, null)],
  extData: { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], name: 'IYG circle' } } } }, supportIn: [{ id: 't1', peerId: 'peer-c', chips: ['call'], note: 'hi', until: 9e15 }], sameAs: {}, meetings: [] })
function fixture(over = {}, write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpc-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ ...base(), ...over }))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-12T10:00:00Z') })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('community tools', () => {
  it('reads are offered with writes off, changes only with writes on', () => {
    const off = Object.keys(fixture({}, false).by)
    expect(off).toEqual(expect.arrayContaining(['community_list', 'community_settings_get', 'support_inbox']))
    for (const n of ['community_create', 'community_set_kind', 'community_add_member', 'community_settings_set', 'support_ask', 'support_cancel']) {
      expect(off).not.toContain(n)
      expect(Object.keys(fixture().by)).toContain(n)
    }
  })
  it('community_list: id, name, kind, member count', () => {
    expect(fixture().by.community_list.run({})).toEqual([{ id: 'iyg', name: 'IYG circle', kind: 'managed', members: 3 }])
  })
  it('community_create makes an entry with a name (the app defines the tag on its next start); a second call of that name changes nothing', () => {
    const f = fixture()
    expect(f.by.community_create.run({ name: 'Book club', kind: 'informal' })).toMatchObject({ id: 'book-club', kind: 'informal', created: true })
    expect(f.rec().extData['community-mighty'].meta['book-club']).toMatchObject({ name: 'Book club', kind: 'informal' })
    expect(f.by.community_create.run({ name: 'book club' }).created).toBe(false)
    expect(() => f.by.community_create.run({ name: ' ' })).toThrow(/name/)
  })
  it('community_set_kind and settings: organizer rule holds', () => {
    const f = fixture()
    expect(f.by.community_set_kind.run({ community: 'iyg', kind: 'informal' })).toMatchObject({ kind: 'informal' })
    expect(() => f.by.community_set_kind.run({ community: 'iyg', kind: 'odd' })).toThrow(/kind/)
    const g = fixture({ extData: { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['p9'] } } } } })
    expect(() => g.by.community_settings_set.run({ community: 'iyg', ask: false })).toThrow(/organizer/)
  })
  it('community_settings_set / get: ask button and left-column sections', () => {
    const f = fixture()
    expect(f.by.community_settings_set.run({ community: 'iyg', ask: false, nav: ['members', 'docs', 'bogus'] })).toMatchObject({ ask: false, nav: ['members', 'docs'] })
    expect(f.by.community_settings_get.run({ community: 'iyg' })).toMatchObject({ kind: 'managed', ask: false, nav: ['members', 'docs'], audiences: [] })
    expect(() => f.by.community_settings_get.run({ community: 'nope' })).toThrow(/no community/)
  })
  it('community_add_member gives the membership tag once', () => {
    const f = fixture()
    expect(f.by.community_add_member.run({ community: 'iyg', person: 'Ada' })).toMatchObject({ added: true })
    expect(f.rec().people[0].fields.iyg).toBe('true')
    expect(f.by.community_add_member.run({ community: 'iyg', person: 'a' }).added).toBe(false)
  })
})

describe('support tools', () => {
  it('support_ask: the community (Friends and closer, connected) plus Closest few; queued for the app; reports counts, not names', () => {
    const f = fixture()
    const out = f.by.support_ask.run({ text: 'could use a ride', audience: ['community:iyg'] })
    expect(out).toMatchObject({ asked: 3, queued: true, needsTap: true })
    expect(JSON.stringify(out)).not.toMatch(/Ada|Ben|Cleo/)
    const ask = f.rec().supportAsks[0]
    expect(ask).toMatchObject({ note: 'could use a ride', queued: true, agent: true, here: [] })
    expect(ask.to.sort()).toEqual(['peer-a', 'peer-b', 'peer-c'])
    expect(ask.until).toBeGreaterThan(Date.parse('2026-11-12T10:00:00Z'))
  })
  it('support_ask: bundles and single people; nobody to ask is an error', () => {
    const f = fixture()
    expect(f.by.support_ask.run({ text: 'x', audience: ['closest-allies'] }).asked).toBe(2)
    expect(f.by.support_ask.run({ text: 'x', audience: ['Dan'] }).asked).toBe(1)
    expect(() => f.by.support_ask.run({ text: 'x', audience: ['Eve'] })).toThrow(/nobody/)
    expect(() => f.by.support_ask.run({ text: ' ', audience: ['closest-few'] })).toThrow(/text/)
  })
  it('support_inbox lists open asks (mine and theirs); support_cancel marks mine for the app to withdraw', () => {
    const f = fixture()
    const { id } = f.by.support_ask.run({ text: 'help', audience: ['closest-few'] })
    const rows = f.by.support_inbox.run({})
    expect(rows.map((r) => r.kind).sort()).toEqual(['mine', 'theirs'])
    expect(f.by.support_cancel.run({ id })).toEqual({ id, cancelled: true })
    expect(f.by.support_inbox.run({}).map((r) => r.kind)).toEqual(['theirs'])
    expect(() => f.by.support_cancel.run({ id: 'zzz' })).toThrow(/no ask/)
  })
})
