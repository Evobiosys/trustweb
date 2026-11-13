// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local: the TrustWeb tools over a synthetic record file, in-process and over a real stdio child. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { createMcpServer } from '../../../mcp/src/protocol.ts'
import { replay } from '../../scripts/replay_edits.mjs'

const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], ...over })
const base = () => ({ v: 1, people: [
  P('a', 'Ada Lovelace', { ring: 'close', context: 'math club', fields: { mentor: 'true', note: 'not a tag' }, generalNote: 'met at the fair', lines: [{ id: 'l1', text: 'likes tea', tag: 'note', audience: 'me', status: 'active', notedAt: 5, checkedAt: 5 }] }),
  P('b', 'Bob Stone', { fields: { mentor: 'true', climbing: 'true' } }),
  P('c', 'Bob Stone', { ring: 'acquaintance' }),
  P('d', 'Dora Gone', { deleted_at: '2026-11-01T00:00:00Z', fields: { mentor: 'true' } }),
  P('e', 'Eve Hidden', { ring: 'none' }),
], sameAs: {}, meetings: [] })
const tmp = () => mkdtempSync(path.join(tmpdir(), 'tw-mcp-'))
function fixture(over = {}) {
  const dir = tmp()
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = recordTools({ file, write: false, now: () => new Date('2026-11-10T10:00:00Z'), ...over })
  const by = Object.fromEntries(tools.map((t) => [t.name, t]))
  return { dir, file, tools, by }
}

describe('read tools', () => {
  it('with writes off only the read tools exist', () => {
    expect(fixture().tools.map((t) => t.name).sort()).toEqual(['bar_list', 'community_list', 'community_settings_get', 'connect_code', 'connect_redeem', 'get_person', 'list_notes', 'list_people', 'list_tags', 'notifications_inbox_list', 'search', 'settings_get', 'settings_list', 'settings_search', 'support_inbox'])
  })
  it('list_people hides deleted people and filters by tag and zone', () => {
    const { by } = fixture()
    expect(by.list_people.run({}).map((p) => p.id)).toEqual(['a', 'b', 'c', 'e'])
    expect(by.list_people.run({ tag: 'mentor' }).map((p) => p.id)).toEqual(['a', 'b'])
    expect(by.list_people.run({ zone: 'Close' }).map((p) => p.id)).toEqual(['a'])
    expect(by.list_people.run({ tag: 'mentor', zone: 'friend' }).map((p) => p.id)).toEqual(['b'])
    expect(by.list_people.run({ limit: 1 })).toHaveLength(1)
  })
  it('list_people rows carry id, name, zone and tags only', () => {
    expect(fixture().by.list_people.run({ zone: 'close' })[0]).toEqual({ id: 'a', name: 'Ada Lovelace', zone: 'close', tags: ['mentor'] })
  })
  it('get_person finds by id or exact name; a shared name is ambiguous; unknown fails', () => {
    const { by } = fixture()
    const ada = by.get_person.run({ person: 'a' })
    expect(ada).toMatchObject({ id: 'a', name: 'Ada Lovelace', zone: 'close', context: 'math club', tags: ['mentor'], generalNote: 'met at the fair' })
    expect(ada.notes).toEqual([{ text: 'likes tea', at: 5 }])
    expect(by.get_person.run({ person: 'ada lovelace' }).id).toBe('a')
    expect(() => by.get_person.run({ person: 'Bob Stone' })).toThrow(/more than one/)
    expect(() => by.get_person.run({ person: 'zed' })).toThrow(/no person/i)
    expect(() => by.get_person.run({ person: 'd' })).toThrow(/no person/i)
  })
  it('get_person leaves out contact channels, images and keys', () => {
    const { dir, file } = fixture()
    const rec = base()
    rec.people[0].channels = { email: 'ada@example.org' }
    rec.people[0].image = 'data:image/jpeg;base64,AAAA'
    writeFileSync(file, JSON.stringify(rec))
    const out = JSON.stringify(recordTools({ file, write: false }).find((t) => t.name === 'get_person').run({ person: 'a' }))
    expect(out).not.toContain('ada@example.org')
    expect(out).not.toContain('base64')
    expect(dir).toBeTruthy()
  })
  it('list_tags counts holders among live people', () => {
    expect(fixture().by.list_tags.run({})).toEqual([{ tag: 'climbing', people: 1 }, { tag: 'mentor', people: 2 }])
  })
  it('list_notes gives the general note and the lines, for everyone or one person', () => {
    const { by } = fixture()
    expect(by.list_notes.run({})).toEqual([
      { person: 'a', name: 'Ada Lovelace', kind: 'general', text: 'met at the fair' },
      { person: 'a', name: 'Ada Lovelace', kind: 'line', text: 'likes tea', at: 5 },
    ])
    expect(by.list_notes.run({ person: 'b' })).toEqual([])
  })
  it('search matches name, context, notes, case-insensitively, and says where', () => {
    const { by } = fixture()
    expect(by.search.run({ query: 'MATH' })).toEqual([{ id: 'a', name: 'Ada Lovelace', zone: 'close', in: ['context'] }])
    expect(by.search.run({ query: 'tea' })[0].in).toEqual(['notes'])
    expect(by.search.run({ query: 'bob' }).map((r) => r.id)).toEqual(['b', 'c'])
    expect(() => by.search.run({ query: '  ' })).toThrow()
  })
  it('the allow list hides tools', () => {
    expect(fixture({ allow: ['search'] }).tools.map((t) => t.name)).toEqual(['search'])
  })
  it('read-only mode never changes the file', () => {
    const { file, by } = fixture()
    const before = readFileSync(file, 'utf8')
    by.list_people.run({}); by.search.run({ query: 'ada' })
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})

describe('write tools', () => {
  const w = () => fixture({ write: true })
  const edits = (dir) => { const f = path.join(dir, 'dev-edits.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [] }

  it('writes on adds add_note and add_tag', () => {
    expect(w().tools.map((t) => t.name)).toEqual(expect.arrayContaining(['add_note', 'add_tag']))
  })
  it('add_note appends dated text to the general note and logs one note edit', () => {
    const { dir, file, by } = w()
    const out = by.add_note.run({ person: 'b', text: 'plays chess' })
    expect(out).toEqual({ id: 'b', name: 'Bob Stone', added: true })
    const rec = JSON.parse(readFileSync(file, 'utf8'))
    expect(rec.people.find((p) => p.id === 'b').generalNote).toBe('2026-11-10: plays chess')
    by.add_note.run({ person: 'a', text: 'second' })
    expect(JSON.parse(readFileSync(file, 'utf8')).people[0].generalNote).toBe('met at the fair\n2026-11-10: second')
    const log = edits(dir)
    expect(log.map((e) => [e.kind, e.ids[0]])).toEqual([['note', 'b'], ['note', 'a']])
    expect(log[0]).toMatchObject({ at: '2026-11-10T10:00:00.000Z', previewId: 'mcp', before: {}, after: { generalNote: '2026-11-10: plays chess' } })
  })
  it('add_tag sets the tag field once and logs a field edit; a second call changes nothing', () => {
    const { dir, file, by } = w()
    expect(by.add_tag.run({ person: 'b', tag: 'Book Club' })).toEqual({ id: 'b', name: 'Bob Stone', tag: 'book-club', added: true })
    expect(JSON.parse(readFileSync(file, 'utf8')).people[1].fields['book-club']).toBe('true')
    expect(by.add_tag.run({ person: 'b', tag: 'book club' }).added).toBe(false)
    expect(edits(dir)).toHaveLength(1)
    expect(edits(dir)[0].kind).toBe('field')
  })
  it('refuses empty text/tag, deleted people and over-long notes; nothing is written', () => {
    const { file, by } = w()
    const before = readFileSync(file, 'utf8')
    expect(() => by.add_note.run({ person: 'b', text: ' ' })).toThrow()
    expect(() => by.add_note.run({ person: 'b', text: 'x'.repeat(5001) })).toThrow(/too long/)
    expect(() => by.add_tag.run({ person: 'b', tag: '!!!' })).toThrow()
    expect(() => by.add_tag.run({ person: 'd', tag: 'x' })).toThrow(/no person/i)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
  it('the edit stream replays onto the base record to the written one', () => {
    const { dir, file, by } = w()
    by.add_note.run({ person: 'a', text: 'n1' }); by.add_tag.run({ person: 'c', tag: 'x' })
    const log = readFileSync(path.join(dir, 'dev-edits.jsonl'), 'utf8')
    expect(replay(base(), log)).toEqual(JSON.parse(readFileSync(file, 'utf8')))
  })
  it('keeps other fields of the record untouched and leaves no temp file', () => {
    const { dir, file, by } = w()
    const rec = base(); rec.zoneTags = { friend: { ids: ['x'], stamp: 1 } }; writeFileSync(file, JSON.stringify(rec))
    by.add_note.run({ person: 'b', text: 'k' })
    expect(JSON.parse(readFileSync(file, 'utf8')).zoneTags).toEqual(rec.zoneTags)
    expect(existsSync(file + '.tmp')).toBe(false)
    expect(dir).toBeTruthy()
  })
  it('rejects a file that is not a TrustWeb record, without writing', () => {
    const { file, by } = w()
    writeFileSync(file, '{"hello":1}')
    expect(() => by.add_note.run({ person: 'b', text: 'x' })).toThrow(/record/i)
    expect(readFileSync(file, 'utf8')).toBe('{"hello":1}')
  })
})

describe('over stdio', () => {
  const server = path.resolve(import.meta.dirname, '../../../mcp/src/server.ts')
  function session(env) {
    const child = spawn(process.execPath, [server], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''; const waiting = new Map()
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m) } })
    let n = 0
    const rpc = (method, params) => new Promise((res) => { const id = ++n; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
    return { rpc, close: () => { child.stdin.end(); return new Promise((r) => child.on('close', r)) } }
  }
  it('initialize, tools/list, get_person and a refused write', async () => {
    const { file } = fixture()
    const s = session({ TW_RECORD: file })
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(init.result.serverInfo.name).toBe('trustweb-mcp')
    const list = await s.rpc('tools/list')
    expect(list.result.tools.map((t) => t.name)).not.toContain('add_note')
    const got = await s.rpc('tools/call', { name: 'get_person', arguments: { person: 'a' } })
    expect(JSON.parse(got.result.content[0].text).name).toBe('Ada Lovelace')
    const w = await s.rpc('tools/call', { name: 'add_note', arguments: { person: 'a', text: 'x' } })
    expect(w.result.isError).toBe(true)
    await s.close()
  })
  it('TW_MCP_WRITE=1 allows a write; TW_MCP_TOOLS limits the list', async () => {
    const { file, dir } = fixture()
    const s = session({ TW_RECORD: file, TW_MCP_WRITE: '1', TW_MCP_TOOLS: 'add_note,search' })
    expect((await s.rpc('tools/list')).result.tools.map((t) => t.name)).toEqual(['search', 'add_note'])
    const r = await s.rpc('tools/call', { name: 'add_note', arguments: { person: 'a', text: 'via stdio' } })
    expect(r.result.isError).toBeUndefined()
    expect(statSync(path.join(dir, 'dev-edits.jsonl')).size).toBeGreaterThan(0)
    await s.close()
  })
})

describe('wave 42 push-popup: notifications inbox', () => {
  const item = (id, at, seenAt = null) => ({ id, kind: 'chat', title: 'TrustWeb', body: `b${id}`, at, seenAt })
  const withInbox = (over = {}) => {
    const f = fixture({ write: true, ...over })
    writeFileSync(f.file, JSON.stringify({ ...base(), notifInbox: [item('a', 1), item('b', 3), item('c', 2, 9)] }))
    return f
  }
  it('inbox_list returns the setting and the items newest first; unseen only on request', () => {
    const { by } = withInbox()
    expect(by.notifications_inbox_list.run({})).toEqual({ popup: true, items: [item('b', 3), item('c', 2, 9), item('a', 1)] })
    expect(by.notifications_inbox_list.run({ unseenOnly: true }).items.map((i) => i.id)).toEqual(['b', 'a'])
  })
  it('an old record without an inbox lists nothing', () => {
    expect(fixture().by.notifications_inbox_list.run({})).toEqual({ popup: true, items: [] })
  })
  it('mark_seen sets seenAt on the named ids (or all) and changes nothing else', () => {
    const { by, file } = withInbox()
    expect(by.notifications_inbox_mark_seen.run({ ids: ['a'] })).toEqual({ marked: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8')).notifInbox.map((i) => [i.id, i.seenAt !== null])).toEqual([['a', true], ['b', false], ['c', true]])
    expect(by.notifications_inbox_mark_seen.run({ all: true })).toEqual({ marked: 1 })
    expect(by.notifications_inbox_mark_seen.run({ all: true })).toEqual({ marked: 0 })
    expect(JSON.parse(readFileSync(file, 'utf8')).people).toHaveLength(5)
  })
  it('mark_seen needs ids or all', () => {
    expect(() => withInbox().by.notifications_inbox_mark_seen.run({})).toThrow(/ids/)
  })
  it('popup_set stores only "off" (missedPopupOff true) and removes it for on', () => {
    const { by, file } = withInbox()
    expect(by.notifications_popup_set.run({ on: false })).toEqual({ popup: false })
    expect(JSON.parse(readFileSync(file, 'utf8')).missedPopupOff).toBe(true)
    expect(by.notifications_inbox_list.run({}).popup).toBe(false)
    expect(by.notifications_popup_set.run({ on: true })).toEqual({ popup: true })
    expect('missedPopupOff' in JSON.parse(readFileSync(file, 'utf8'))).toBe(false)
  })
  it('the write tools exist only with writes on', () => {
    const names = fixture().tools.map((t) => t.name)
    expect(names).toContain('notifications_inbox_list')
    expect(names).not.toContain('notifications_inbox_mark_seen')
  })
})
