// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity (F07, Q05, P02): the MCP server offers every assistant action and every setting. Data-driven: the tool list comes from
 * allTools (apps/mcp/src/tools.ts, the one place a branch adds its tools), the action list from the real registry, the settings from
 * SETTINGS_REGISTRY. A new action, setting or tool without its counterpart fails here.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createActions } from '../../src/actions.ts'
import { defineAppActions } from '../../src/app_actions.ts'
import { defineEventActions } from '../../src/event_actions.ts'
import { ACTION_MCP, APP_ACTION_TYPES } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { SETTINGS_REGISTRY, writeSetting } from '../../src/settings_registry.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { eventsFile, readEvents } from '../../../mcp/src/events.ts'
import { parityReport } from '../../../mcp/scripts/parity_check.mjs'

const host = new Proxy({}, { get: () => () => undefined })
const reg = createActions()
defineAppActions(reg, host)
defineEventActions(reg, host)

const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], ...over })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-par-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [P('a', 'Ada Lovelace', { fields: { mentor: 'true', email: 'ada@x.org' } }), P('b', 'Bob Stone')] }))
  const tools = allTools({ file, write, now: () => new Date('2026-11-12T10:00:00Z') })
  return { dir, file, tools, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('registry <-> MCP parity (data-driven)', () => {
  const names = allTools({ file: '/nonexistent', write: true }).map((t) => t.name)
  it('every registry action has an ACTION_MCP entry naming a tool that exists', () => {
    for (const s of reg.specs()) {
      expect(Object.keys(ACTION_MCP), `action ${s.type}`).toContain(s.type)
      expect(names, `${s.type} -> ${ACTION_MCP[s.type]}`).toContain(ACTION_MCP[s.type])
    }
  })
  it('app_action covers exactly the actions without a dedicated tool, and names each of them', () => {
    const viaApp = Object.entries(ACTION_MCP).filter(([, t]) => t === 'app_action').map(([a]) => a).sort()
    expect([...APP_ACTION_TYPES].sort()).toEqual(viaApp)
    for (const t of viaApp) expect(reg.specs().map((s) => s.type)).toContain(t)
  })
  it('MCP_TOOLS (the Settings list) is exactly the tools the server offers, writes marked', () => {
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(names.slice().sort())
    const readOnly = allTools({ file: '/nonexistent', write: false }).map((t) => t.name)
    expect(MCP_TOOLS.filter((t) => !t.write).map((t) => t.name).sort()).toEqual(readOnly.slice().sort())
  })
  it('every valued setting is settable through settings_set; every screen setting is listed', () => {
    const { by } = fixture()
    const listed = by.settings_list.run({}).map((s) => s.id)
    for (const d of SETTINGS_REGISTRY) {
      expect(listed, d.id).toContain(d.id)
      if (d.type === 'action') continue
      const probe = d.type === 'boolean' ? !d.default : d.type === 'choice' ? d.choices[d.choices.length - 1] : d.type === 'number' ? d.max : 'x'
      const r = JSON.parse(readFileSync(fixture().file, 'utf8'))
      expect(writeSetting(r, d.id, probe), d.id).toBe(probe)
    }
  })
  it('the generated parity report finds nothing missing', () => {
    const r = parityReport()
    expect(r.actions.sort()).toEqual(reg.specs().map((s) => s.type).sort())
    expect(r.missing).toEqual([])
  })
})

describe('the new record tools', () => {
  it('set_ring moves a person and refuses an unknown ring', () => {
    const { by, rec } = fixture()
    expect(by.set_ring.run({ person: 'Ada Lovelace', ring: 'close' })).toMatchObject({ id: 'a', ring: 'close' })
    expect(rec().people[0].ring).toBe('close')
    expect(() => by.set_ring.run({ person: 'a', ring: 'bff' })).toThrow(/ring/)
  })
  it('remove_tag takes a held tag off, and says so when the person does not hold it', () => {
    const { by, rec } = fixture()
    by.remove_tag.run({ person: 'a', tag: '#Mentor' })
    expect(rec().people[0].fields.mentor).toBeUndefined()
    expect(rec().people[0].fields.email).toBe('ada@x.org')
    expect(() => by.remove_tag.run({ person: 'a', tag: 'mentor' })).toThrow(/no tag/)
  })
  it('set_field: name, context, other fields; empty clears; reserved keys refused', () => {
    const { by, rec } = fixture()
    by.set_field.run({ person: 'b', field: 'context', value: 'choir' })
    by.set_field.run({ person: 'b', field: 'company', value: 'Acme' })
    expect(rec().people[1]).toMatchObject({ context: 'choir', fields: { company: 'Acme' } })
    by.set_field.run({ person: 'b', field: 'company', value: '' })
    expect(rec().people[1].fields).toBeUndefined()
    expect(() => by.set_field.run({ person: 'b', field: 'name', value: '' })).toThrow(/name/)
    expect(() => by.set_field.run({ person: 'b', field: 'ring', value: 'close' })).toThrow(/cannot be set/)
    expect(() => by.set_field.run({ person: 'b', field: 'company' })).toThrow(/text/)
  })
  it('create_group_tag gives every member the tag, all or nothing; an existing tag is refused', () => {
    const { by, rec } = fixture()
    expect(() => by.create_group_tag.run({ label: 'Choir', members: ['a', 'nobody'] })).toThrow(/nobody/)
    expect(rec().people[0].fields.choir).toBeUndefined()
    by.create_group_tag.run({ label: 'Choir', members: ['a', 'Bob Stone'] })
    expect(rec().people.map((p) => p.fields.choir)).toEqual(['true', 'true'])
    expect(() => by.create_group_tag.run({ label: 'choir', members: [] })).toThrow(/exists/)
  })
})

describe('app_action and the events the preview watches', () => {
  it('app_action only queues, for a listed type; the record file stays as it was', () => {
    const { by, file, rec } = fixture()
    const before = readFileSync(file, 'utf8')
    expect(by.app_action.run({ type: 'set-look', args: { look: 'sleek' }, why: 'try it' })).toMatchObject({ queued: true })
    expect(readFileSync(file, 'utf8')).toBe(before)
    const ev = readEvents(file, 0).events
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'action', tool: 'app_action', action: { type: 'set-look', args: { look: 'sleek' }, why: 'try it' } })
    expect(() => by.app_action.run({ type: 'set-ring', args: {} })).toThrow(/unknown|dedicated/)
    expect(() => by.app_action.run({ type: 'nope', args: {} })).toThrow(/unknown/)
    expect(rec().people).toHaveLength(2)
  })
  it('a write tool announces itself after the write; a read tool and a failed write do not', () => {
    const { by, file } = fixture()
    by.list_people.run({})
    expect(() => by.set_ring.run({ person: 'a', ring: 'bff' })).toThrow()
    expect(existsSync(eventsFile(file))).toBe(false)
    by.set_ring.run({ person: 'a', ring: 'close' })
    const { events, next } = readEvents(file, 0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'record', tool: 'set_ring' })
    expect(events[0].summary).toContain('set_ring')
    expect(readEvents(file, next).events).toEqual([])
  })
  it('read-only mode offers neither app_action nor a record write', () => {
    const names = allTools({ file: '/nonexistent', write: false }).map((t) => t.name)
    for (const n of ['app_action', 'set_ring', 'remove_tag', 'set_field', 'create_group_tag']) expect(names).not.toContain(n)
  })
  it('TW_MCP_TOOLS style allow list filters the union', () => {
    expect(allTools({ file: '/nonexistent', write: true }, ['set_ring', 'list_people']).map((t) => t.name).sort()).toEqual(['list_people', 'set_ring'])
  })
})

// Review wave 42: apps/mcp/tsconfig.json no longer sets erasableSyntaxOnly (the app's enums reach its type graph); this is the runtime guard:
// server.ts boots under plain node (type stripping) with every tool module, and offers exactly MCP_TOOLS.
describe('server.ts boots under plain node with every tool', () => {
  it('tools/list over stdio = MCP_TOOLS (writes on)', async () => {
    const { spawn } = await import('node:child_process')
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-boot-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, people: [] }))
    const server = new URL('../../../mcp/src/server.ts', import.meta.url).pathname
    const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', server], { env: { PATH: process.env.PATH, TW_RECORD: file, TW_MCP_WRITE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
    for (let i = 0; i < 100 && !out.includes('\n'); i++) await new Promise((r) => setTimeout(r, 50))
    child.kill()
    expect(err, err).not.toMatch(/Error/)
    const names = JSON.parse(out.split('\n')[0]).result.tools.map((t) => t.name)
    expect(names.slice().sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort())
  }, 15_000)
})
