// @ts-nocheck  (fs/os/path: the crm tsconfig carries no node types; vitest runs this in node)
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAppState } from '../../src/model'
import { chunks, listNotes, mergePeople, noteDate, parseAnswer } from '../../scripts/notes_read_persons.mjs'
import { loadReadings, merge, tanaLinksMarkdown, withoutLocal, withoutTana } from '../../scripts/notes_persons_to_record.mjs'

const line = (id: string, text: string, extra = {}) => ({ id, text, tag: 'note', audience: 'me', status: 'current', notedAt: 1, checkedAt: 1, ...extra })
const seed = () => ({
  v: 1, me: { id: 'me', displayName: 'Jakob (JaPossert)' }, peers: [], inventory: [], log: [], notificationsOn: false,
  people: [
    { id: 'tana-abc', name: 'Mira Hollenstein', context: 'DWeb', ring: 'friend', metAt: 1_700_000_000_000, lines: [line('tana-abc-0', 'ring: derived')], fields: {} },
    { id: 'tana-def', name: 'Tobias Rainer', context: '', ring: 'unsorted', metAt: 1_700_000_000_000, lines: [line('tana-def-0', 'Reviews OTF', { tanaId: 'n1' })], fields: {} },
  ],
})
const readings = () => [
  { path: 'journals/2026_07_11.md', date: '2026-07-11', reader: 'claude:haiku', people: [
    { name: 'Mira Hollenstein', aliases: ['Mira'], context: 'Met at the bonfire', facts: ['Runs a repair café in Graz', 'Offered her 3D printer'], met: '', confidence: 0.95 },
    { name: 'Tobias', aliases: [], context: 'Call about OTF', facts: ['Wants the Dec deadline confirmed'], met: '', confidence: 0.8 },
    { name: 'Jonas', aliases: [], context: 'Partner of Mira', facts: [], met: '', confidence: 0.3 },
    { name: 'Olga Nowak', aliases: [], context: 'Runs the bonfire kitchen', facts: [], met: '', confidence: 0.8 },
    { name: 'Pat Name-Only', aliases: [], context: '', facts: [], met: '', confidence: 0.8 },
  ] },
  { path: 'pages/Lena Berger.md', date: '2026-05-02', reader: 'claude:haiku', people: [
    { name: 'Lena Berger', aliases: [], context: 'Co-founder of the repair café', facts: ['Lives in Leoben', 'Runs a repair café in Graz'], met: '2024-03-09', confidence: 0.9 },
  ] },
  { path: 'journals/2026_07_12.md', date: '2026-07-12', reader: 'claude:haiku', people: [
    { name: 'Lena Berger', aliases: [], context: '', facts: ['Lives in Leoben', 'Plays cello'], met: '', confidence: 0.9 },
  ] },
]

describe('reader: pure parts', () => {
  it('noteDate: journal file name, then front matter, then mtime', () => {
    expect(noteDate('journals/2026_07_11.md', '', 0)).toBe('2026-07-11')
    expect(noteDate('pages/x.md', '---\ntitle: x\ndate: 2025-01-02\n---\nbody', 0)).toBe('2025-01-02')
    expect(noteDate('pages/x.md', 'no front matter', Date.UTC(2026, 9, 16, 12))).toBe('2026-10-16')
  })
  it('parseAnswer tolerates fences and prose, drops nameless entries, clamps confidence', () => {
    const r = parseAnswer('Sure! ```json\n{"people":[{"name":" A B ","confidence":2,"facts":["x"]},{"name":""},{"confidence":1}]}\n```')
    expect(r.people).toEqual([{ name: 'A B', aliases: [], context: '', facts: ['x'], met: '', confidence: 1 }])
    expect(() => parseAnswer('no json here')).toThrow(/no JSON/)
    expect(() => parseAnswer('{"x":1}')).toThrow(/people/)
  })
  it('chunks split long notes at blank lines, each under the limit', () => {
    const text = Array.from({ length: 40 }, (_, i) => `para ${i} ${'y'.repeat(900)}`).join('\n\n')
    const c = chunks(text)
    expect(c.length).toBeGreaterThan(1)
    for (const x of c) expect(x.length).toBeLessThanOrEqual(14000)
    expect(c.join('\n\n')).toBe(text)
  })
  it('mergePeople unions facts and aliases per name, case-insensitive', () => {
    const m = mergePeople([[{ name: 'Ana', aliases: ['A'], context: '', facts: ['f1'], met: '', confidence: 0.5 }], [{ name: 'ana', aliases: ['An'], context: 'c', facts: ['f1', 'f2'], met: '2020-01-01', confidence: 0.9 }]])
    expect(m).toEqual([{ name: 'Ana', aliases: ['A', 'An'], context: 'c', facts: ['f1', 'f2'], met: '2020-01-01', confidence: 0.9 }])
  })
  it('listNotes walks the vault, skips code and caches, returns sorted vault-relative paths', () => {
    const v = mkdtempSync(path.join(tmpdir(), 'vault-'))
    for (const d of ['journals', 'node_modules/x', 'code/y', '.obsidian', 'memory/people']) mkdirSync(path.join(v, d), { recursive: true })
    for (const f of ['journals/2026_01_01.md', 'node_modules/x/a.md', 'code/y/b.md', '.obsidian/c.md', 'memory/people/d.md', 'memory/e.txt']) writeFileSync(path.join(v, f), 'x')
    utimesSync(path.join(v, 'memory/people/d.md'), new Date(), new Date())
    expect(listNotes(v)).toEqual(['journals/2026_01_01.md', 'memory/people/d.md'])
    expect(listNotes(v, ['memory', 'missing'])).toEqual(['memory/people/d.md'])
  })
})

describe('converter', () => {
  const { record, stats, matched } = merge(seed(), readings())
  it('a full name joins its Tana person, keeps the tana- id, gains note lines with local provenance and the note date', () => {
    const mira = record.people.find((p) => p.id === 'tana-abc')!
    expect(mira.lines.map((l) => l.text)).toEqual(['ring: derived', 'Runs a repair café in Graz', 'Offered her 3D printer'])
    expect(mira.lines[1].source).toEqual({ kind: 'local', path: 'journals/2026_07_11.md', reader: 'claude:haiku' })
    expect(mira.lines[1].notedAt).toBe(Date.parse('2026-07-11T12:00:00Z'))
    expect(mira.context).toBe('DWeb')
    expect(mira.metAt).toBe(1_700_000_000_000)
    expect(stats.joinedExisting).toBe(1)
  })
  it('a single first name never joins a Tana person: it becomes its own local person', () => {
    expect(record.people.find((p) => p.id === 'tana-def')!.lines).toHaveLength(1)
    const tobias = record.people.find((p) => p.name === 'Tobias')!
    expect(tobias.id).toMatch(/^local-[0-9a-f]{12}$/)
    expect(tobias.ring).toBe('unsorted')
    expect(tobias.context).toBe('Call about OTF')
    expect(stats.singleNames).toBe(1)
  })
  it('a new person collects lines across notes without duplicates; metAt = explicit met date or earliest note', () => {
    const lena = record.people.find((p) => p.name === 'Lena Berger')!
    expect(lena.lines.map((l) => l.text)).toEqual(['Lives in Leoben', 'Runs a repair café in Graz', 'Plays cello'])
    expect(lena.metAt).toBe(Date.parse('2024-03-09T12:00:00Z'))
    expect(new Set(lena.lines.map((l) => l.id)).size).toBe(3)
  })
  it('low confidence is dropped and counted; the record stays a valid AppState', () => {
    expect(record.people.find((p) => p.name === 'Jonas')).toBeUndefined()
    expect(stats.belowConfidence).toBe(1)
    expect(stats.newPersons).toBe(4)
    expect(record.people.find((p) => p.name === 'Olga Nowak')!.lines).toEqual([])
    expect(record.people.find((p) => p.name === 'Pat Name-Only')).toBeUndefined()
    expect(isAppState(record)).toBe(true)
  })
  it('is one-shot: merging again onto its own output gives the same record', () => {
    const again = merge(record, readings())
    expect(again.record).toEqual(record)
    expect(withoutLocal(record)).toEqual(withoutLocal(seed()))
  })
  it('withoutTana keeps the notes half of a person in both sources as a local person and drops Tana-only ones', () => {
    const r = withoutTana(record)
    expect(r.people.map((p) => p.name).sort()).toEqual(['Lena Berger', 'Mira Hollenstein', 'Olga Nowak', 'Tobias'])
    const mira = r.people.find((p) => p.name === 'Mira Hollenstein')!
    expect(mira.id).toMatch(/^local-/)
    expect(mira.lines.map((l) => l.text)).toEqual(['Runs a repair café in Graz', 'Offered her 3D printer'])
  })
  it('tana-links markdown lists each matched Tana person with the app.tana.inc link and the notes as wikilinks', () => {
    const md = tanaLinksMarkdown(matched, readings())
    expect(md).toContain('- [[Mira Hollenstein]] — Tana: https://app.tana.inc?nodeid=abc — in: [[2026_07_11]] (2026-07-11)')
    expect(md).not.toContain('Tobias')
  })
  it('loadReadings keeps the last line per note path', () => {
    const r = loadReadings(['{"path":"a.md","date":"2026-01-01","people":[]}\n{"path":"a.md","date":"2026-01-02","people":[]}\n', '{"path":"b.md","date":"2026-01-03","people":[]}\n'])
    expect(r.map((x) => `${x.path}:${x.date}`)).toEqual(['a.md:2026-01-02', 'b.md:2026-01-03'])
  })
})
