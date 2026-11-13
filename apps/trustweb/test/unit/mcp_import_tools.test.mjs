// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 import-obsidian-ai: MCP parity for the Import actions (sources, run, suggestions list/accept). Names use underscores (clients reject dots). */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeName as appNormalize } from '../../../crm/src/import/dedup.ts'
import { importTools, normalizeName } from '../../../mcp/src/import_tools.ts'
import { createMcpServer } from '../../../mcp/src/protocol.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { IMPORT_SOURCES } from '../../src/import_registry.ts'
import { planFrom } from '../../src/import_pipeline.ts'
import { fileAdapter } from '../../src/import_pipeline.ts'
import { obsidianAiAdapter } from '../../src/ext/obsidian/obsidian_stage.ts'
import { commitPlan, decide, pendingProposals, undoBatch } from '../../src/services_import.ts'
import { mergeObsidian, parseObsidian } from '../../src/ext/obsidian/obsidian_data.ts'

const NOW = new Date('2026-11-12T10:00:00Z')
const SUGG = { path: 'Daily/2026-11-01.md', name: 'Leonie', confidence: 0.8, why: 'Coffee with Leonie' }
function fixture(over = {}, write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcp-imp-'))
  const file = path.join(dir, 'record.json')
  const rec = { v: 1, people: [{ id: 'a', name: 'Ada Lovelace', ring: 'close', metAt: 0, lines: [] }], extData: { obsidian: { vault: 'V', syncedAt: 1, suggestions: [SUGG, { path: 'N/b.md', name: 'Max Muster', confidence: 0.5, why: '' }], suggestedAt: 2 } }, ...over }
  writeFileSync(file, JSON.stringify(rec))
  let n = 0
  const tools = importTools({ file, write, now: () => NOW, newId: () => `mcp${++n}` })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), tools, read: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('registration', () => {
  it('read-only: sources and suggestions list; writes add run and accept', () => {
    expect(fixture({}, false).tools.map((t) => t.name).sort()).toEqual(['import_sources', 'import_suggestions_list'])
    expect(fixture().tools.map((t) => t.name).sort()).toEqual(['import_run', 'import_sources', 'import_suggestions_accept', 'import_suggestions_list'])
  })
  it('the Settings list of tools knows them, with the right write flag', () => {
    const w = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.write]))
    expect(w).toMatchObject({ import_sources: false, import_suggestions_list: false, import_run: true, import_suggestions_accept: true })
  })
})

describe('normalizeName copy', () => {
  it('equals the app\'s', () => {
    for (const n of ['Ada Lovelace', 'Müller, Hans', 'Straße Ünal', '  O\'Brien-Smith ', 'Łukasz Żółć', '李 小龍', '']) expect(normalizeName(n)).toBe(appNormalize(n))
  })
})

describe('import_sources', () => {
  it('is the registry the app uses', () => {
    expect(fixture().by.import_sources.run({})).toEqual(IMPORT_SOURCES.map((s) => ({ id: s.id, label: s.label, kind: s.kind })))
  })
})

describe('import_suggestions_list', () => {
  it('lists the waiting suggestions from the record, best first; none = empty', () => {
    expect(fixture().by.import_suggestions_list.run({}).map((s) => s.name)).toEqual(['Leonie', 'Max Muster'])
    expect(fixture({ extData: {} }).by.import_suggestions_list.run({})).toEqual([])
  })
})

describe('import_run stages a batch for the Curate page, never a person', () => {
  it('adds one batch with the source tag; people stay as they are', () => {
    const f = fixture()
    const out = f.by.import_run.run({ source: 'vcard', candidates: [{ name: 'Greta Tester', emails: ['greta@example.org'] }, { name: 'Hans Probe' }] })
    expect(out).toEqual({ batch: 'mcp1', staged: 2, skipped: 0, tag: 'import:2026-11-12-vcf' })
    const r = f.read()
    expect(r.people).toHaveLength(1)
    expect(r.serviceImports).toHaveLength(1)
    expect(r.serviceImports[0]).toMatchObject({ id: 'mcp1', counts: { vcard: 2 }, tag: 'import:2026-11-12-vcf', done: {} })
  })
  it('the staged batch is one the app accepts and undoes like its own (parity with the pipeline)', () => {
    const f = fixture()
    f.by.import_run.run({ source: 'vcard', candidates: [{ name: 'Greta Tester', emails: ['greta@example.org'] }] })
    const staged = f.read()
    // the same candidate through the app's pipeline: same key, same signature, same tag
    const s = { people: [], serviceImports: [] }
    const plan = planFrom(s, [{ adapter: { id: 'vcard', scan: () => [{ source: 'vcard', file: 'mcp', sourceRef: 'x', name: 'Greta Tester', phones: [], emails: ['greta@example.org'], labels: [] }] }, input: null }], { me: 'Me', now: NOW.getTime() })
    commitPlan(s, plan, 'x', NOW.getTime())
    expect(staged.serviceImports[0].rows[0]).toMatchObject({ key: plan.rows[0].key, sig: plan.rows[0].sig, name: 'Greta Tester', source: 'vcard' })
    expect(staged.serviceImports[0].tag).toBe(s.serviceImports[0].tag)
    const app = { people: staged.people, serviceImports: staged.serviceImports }
    const p = pendingProposals(app, NOW.getTime())
    expect(p).toHaveLength(1)
    decide(app, 'mcp1', p[0].row.key, { do: 'accept' }, NOW.getTime(), () => 'p2')
    expect(app.people.map((x) => x.name)).toEqual(['Ada Lovelace', 'Greta Tester'])
    undoBatch(app, 'mcp1')
    expect(app.serviceImports).toHaveLength(0)
  })
  it('marks an existing name as a duplicate and skips what an earlier batch already holds', () => {
    const f = fixture()
    f.by.import_run.run({ source: 'mcp', candidates: [{ name: 'Ada Lovelace' }] })
    expect(f.read().serviceImports[0].rows[0].dupe).toBe(true)
    expect(f.by.import_run.run({ source: 'mcp', candidates: [{ name: 'Ada Lovelace' }, { name: 'New One' }] })).toMatchObject({ staged: 1, skipped: 1 })
  })
  it('rejects an unknown source, no candidates, nameless or too many candidates, and writes nothing', () => {
    const f = fixture()
    const before = readFileSync(f.file, 'utf8')
    expect(() => f.by.import_run.run({ source: 'myspace', candidates: [{ name: 'A B' }] })).toThrow(/unknown source/)
    expect(() => f.by.import_run.run({ source: 'vcard', candidates: [] })).toThrow(/candidates/)
    expect(() => f.by.import_run.run({ source: 'vcard', candidates: [{ name: ' ' }] })).toThrow(/name/)
    expect(() => f.by.import_run.run({ source: 'vcard', candidates: Array.from({ length: 501 }, (_, i) => ({ name: `P ${i}` })) })).toThrow(/too many/)
    expect(readFileSync(f.file, 'utf8')).toBe(before)
  })
})

describe('import_suggestions_accept', () => {
  it('stages the chosen suggestions as AI rows for checking, removes them from the list, adds no person', () => {
    const f = fixture()
    const out = f.by.import_suggestions_accept.run({ paths: [SUGG.path] })
    expect(out).toMatchObject({ staged: 1, tag: 'import:2026-11-12-obsidian-ai' })
    const r = f.read()
    expect(r.people).toHaveLength(1)
    expect(r.serviceImports[0].rows[0]).toMatchObject({ name: 'Leonie', source: 'obsidian-ai', ai: true, file: SUGG.path })
    expect(r.extData.obsidian.suggestions.map((s) => s.name)).toEqual(['Max Muster'])
    expect(r.extData.obsidian.suggestedAt).toBe(NOW.getTime())
    // the slice still reads and merges as the app does
    expect(parseObsidian(r.extData.obsidian).suggestions).toHaveLength(1)
    expect(mergeObsidian({ vault: 'V', syncedAt: 1, suggestions: [SUGG], suggestedAt: 2 }, r.extData.obsidian).suggestions).toHaveLength(1)
  })
  it('the same row the app makes from a ticked suggestion', () => {
    const f = fixture()
    f.by.import_suggestions_accept.run({ paths: [SUGG.path] })
    const s = { people: [], serviceImports: [] }
    const plan = planFrom(s, [{ adapter: obsidianAiAdapter, input: [SUGG] }], { me: 'Me', now: NOW.getTime() })
    const mine = f.read().serviceImports[0].rows[0]
    expect(mine).toMatchObject({ key: plan.rows[0].key, sig: plan.rows[0].sig, note: plan.rows[0].note, ai: true })
  })
  it('all:true takes every suggestion; an unknown path fails; nothing chosen fails', () => {
    const f = fixture()
    expect(() => f.by.import_suggestions_accept.run({ paths: ['nope.md'] })).toThrow(/no suggestion/)
    expect(() => f.by.import_suggestions_accept.run({})).toThrow(/paths or all/)
    expect(f.by.import_suggestions_accept.run({ all: true })).toMatchObject({ staged: 2 })
    expect(f.read().extData.obsidian.suggestions).toEqual([])
  })
})

describe('over the real MCP protocol and a real node child (no loader, plain .ts)', () => {
  it('tools/list names the import tools when writes are on; import_sources answers', async () => {
    const f = fixture()
    const server = createMcpServer({ name: 't', version: '0' }, f.tools)
    const list = JSON.parse(await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })))
    expect(list.result.tools.map((t) => t.name)).toContain('import_suggestions_accept')
    const call = JSON.parse(await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'import_sources', arguments: {} } })))
    expect(JSON.parse(call.result.content[0].text).map((s) => s.id)).toContain('obsidian-ai')
  })
  it('apps/mcp/src/server.ts starts under node and lists import_sources', async () => {
    const f = fixture()
    const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../../../mcp/src/server.ts')], { env: { PATH: process.env.PATH, TW_RECORD: f.file, TW_MCP_WRITE: '1' } })
    const out = await new Promise((resolve, reject) => {
      let buf = ''
      const t = setTimeout(() => reject(new Error('no answer: ' + buf)), 8000)
      child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) { clearTimeout(t); resolve(buf) } })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
    })
    child.kill()
    expect(JSON.parse(out).result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['import_sources', 'import_run']))
  })
})
