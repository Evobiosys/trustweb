// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 import-obsidian-ai (F04): one pipeline for every source: scan -> candidates -> planServices -> Curate rows -> commitPlan, one tag scheme, one Undo. */
import { fileAdapter, planFrom } from '../../src/import_pipeline.ts'
import { commitPlan, decide, pendingProposals, undoBatch } from '../../src/services_import.ts'
import { IMPORT_SOURCES, SERVICE_LABEL, importTagId } from '../../src/import_registry.ts'
import { obsidianAdapter, obsidianAiAdapter } from '../../src/ext/obsidian/obsidian_stage.ts'
import { parseNote } from '../../src/ext/obsidian/obsidian_parse.ts'
import { buildContacts } from '../../src/ext/obsidian/obsidian_people.ts'
import { NOTES } from '../fixtures/synthetic_vault.mjs'

const NOW = Date.UTC(2026, 10, 12)
const VCF = 'BEGIN:VCARD\nVERSION:3.0\nFN:Greta Tester\nEMAIL:greta@example.org\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nFN:Hans Probe\nEND:VCARD\n'
const fresh = () => ({ people: [], serviceImports: [] })
const notes = () => Object.entries(NOTES).filter(([p]) => p.endsWith('.md')).map(([p, t]) => parseNote(p, t))
let n = 0
const newId = () => `p${++n}`

describe('adapters feed one pipeline', () => {
  it('two different adapters give plans of identical shape and rows of identical keys', () => {
    const s = fresh()
    const a = planFrom(s, [{ adapter: fileAdapter, input: { name: 'c.vcf', text: VCF } }], { me: 'Me', now: NOW })
    const b = planFrom(s, [{ adapter: obsidianAdapter, input: notes() }], { me: 'Me', now: NOW })
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect(Object.keys(a.rows[0]).filter((k) => ['key', 'name', 'source', 'file', 'sig', 'n365', 'out', 'in', 'ids'].includes(k)).sort())
      .toEqual(Object.keys(b.rows[0]).filter((k) => ['key', 'name', 'source', 'file', 'sig', 'n365', 'out', 'in', 'ids'].includes(k)).sort())
    expect(a.counts).toEqual({ vcard: 2 })
    expect(b.counts).toEqual({ obsidian: buildContacts(notes()).contacts.length })
    expect(a.rows.every((r) => r.key.startsWith('vcard:'))).toBe(true)
    expect(b.rows.every((r) => r.key.startsWith('obsidian:'))).toBe(true)
  })
  it('the same plan as planServices gives for a plain file (existing flows are unchanged)', () => {
    const s = fresh()
    const viaPipeline = planFrom(s, [{ name: 'c.vcf', text: VCF }], { me: 'Me', now: NOW })
    expect(viaPipeline.counts).toEqual({ vcard: 2 })
    expect(viaPipeline.rows.map((r) => r.name)).toEqual(['Greta Tester', 'Hans Probe'])
  })
  it('an adapter may decorate its rows (Obsidian note path, AI flag) and nothing else is source specific', () => {
    const s = fresh()
    const plan = planFrom(s, [{ adapter: obsidianAdapter, input: notes() }], { me: 'Me', now: NOW })
    expect(plan.rows.every((r) => r.obsidianNote === r.file && !r.ai)).toBe(true)
    const ai = planFrom(s, [{ adapter: obsidianAiAdapter, input: [{ path: 'Daily/2026-11-01.md', name: 'Leonie Test', why: 'Coffee with Leonie' }] }], { me: 'Me', now: NOW })
    expect(ai.counts).toEqual({ 'obsidian-ai': 1 })
    expect(ai.rows[0]).toMatchObject({ name: 'Leonie Test', source: 'obsidian-ai', ai: true, file: 'Daily/2026-11-01.md' })
    expect(ai.rows[0].obsidianNote).toBeUndefined()
  })
})

describe('one tag scheme, one curate path, one undo', () => {
  it('every source tags its batch #import:<date>-<source>', () => {
    for (const run of [[{ adapter: fileAdapter, input: { name: 'c.vcf', text: VCF } }], [{ adapter: obsidianAdapter, input: notes() }]]) {
      const s = fresh()
      const plan = planFrom(s, run, { me: 'Me', now: NOW })
      commitPlan(s, plan, 'b1', NOW)
      expect(s.serviceImports[0].tag).toBe(importTagId(NOW, Object.keys(plan.counts)))
      expect(s.serviceImports[0].tag).toMatch(/^import:2026-11-12-/)
    }
  })
  it('Accept and Undo work the same for a file source and a vault source', () => {
    for (const run of [[{ adapter: fileAdapter, input: { name: 'c.vcf', text: VCF } }], [{ adapter: obsidianAdapter, input: notes() }]]) {
      const s = fresh()
      commitPlan(s, planFrom(s, run, { me: 'Me', now: NOW }), 'b1', NOW)
      const first = pendingProposals(s, NOW)[0]
      decide(s, 'b1', first.row.key, { do: 'accept' }, NOW, newId)
      expect(s.people).toHaveLength(1)
      expect(s.people[0].fields[s.serviceImports[0].tag]).toBe(true)
      undoBatch(s, 'b1')
      expect(s.serviceImports).toHaveLength(0)
    }
  })
})

describe('the registry', () => {
  it('lists every source once with a label; SERVICE_LABEL is derived from it', () => {
    const ids = IMPORT_SOURCES.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['whatsapp', 'vcard', 'google-csv', 'obsidian', 'obsidian-ai']))
    for (const x of IMPORT_SOURCES) expect(SERVICE_LABEL[x.id]).toBe(x.label)
  })
})
