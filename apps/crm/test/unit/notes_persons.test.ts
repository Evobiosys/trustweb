// @ts-nocheck  (fs/os/path: the crm tsconfig carries no node types; vitest runs this in node)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAppState } from '../../src/model'
import { chunks, listNotes, mergePeople, noteDate, parseAnswer } from '../../scripts/notes_read_persons.mjs'
import { firstNameKey, loadDecisions, loadReadings, merge, offerKey, tanaLinksMarkdown, withoutLocal, withoutTana, writeIfChanged } from '../../scripts/notes_persons_to_record.mjs'

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
  { path: 'journals/2026_07_12.md', date: '2026-07-12', reader: 'claude:haiku', communities: ['DWeb-Berlin_2026'], people: [
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
    for (const d of ['journals', 'node_modules/x', 'code/y', '.obsidian', 'memory/people', 'TrustWeb/People']) mkdirSync(path.join(v, d), { recursive: true })
    for (const f of ['journals/2026_01_01.md', 'node_modules/x/a.md', 'code/y/b.md', '.obsidian/c.md', 'memory/people/d.md', 'memory/e.txt', 'TrustWeb/People/p.md', 'TrustWeb/People/.trustweb-generated']) writeFileSync(path.join(v, f), 'x')
    utimesSync(path.join(v, 'memory/people/d.md'), new Date(), new Date())
    expect(listNotes(v)).toEqual(['journals/2026_01_01.md', 'memory/people/d.md'])
    expect(listNotes(v, ['memory', 'missing'])).toEqual(['memory/people/d.md'])
  })
})

describe('converter', () => {
  const { record, stats, matched, offers } = merge(seed(), readings())
  it('a full name joins its Tana person, keeps the tana- id, gains note lines with local provenance and the note date', () => {
    const mira = record.people.find((p) => p.id === 'tana-abc')!
    expect(mira.lines.map((l) => l.text)).toEqual(['ring: derived', 'Runs a repair café in Graz', 'Offered her 3D printer'])
    expect(mira.lines[1].source).toEqual({ kind: 'local', path: 'journals/2026_07_11.md', reader: 'claude:haiku' })
    expect(mira.lines[1].notedAt).toBe(Date.parse('2026-07-11T12:00:00Z'))
    expect(mira.context).toBe('DWeb')
    expect(mira.metAt).toBe(1_700_000_000_000)
    expect(stats.joinedExisting).toBe(1)
  })
  it('a single first name never joins a Tana person and creates nobody: it becomes a join offer (owner 2026-11-03)', () => {
    expect(record.people.find((p) => p.id === 'tana-def')!.lines).toHaveLength(1)
    expect(record.people.find((p) => p.name === 'Tobias')).toBeUndefined()
    expect(offers).toEqual([{
      key: offerKey('Tobias', 'journals/2026_07_11.md'), name: 'Tobias', path: 'journals/2026_07_11.md', date: '2026-07-11', context: 'Call about OTF',
      facts: ['Wants the Dec deadline confirmed'], candidates: [{ id: 'tana-def', name: 'Tobias Rainer' }],
    }])
    expect(offers[0].key).toMatch(/^[0-9a-f]{16}$/)
    expect([stats.singleNames, stats.offers, stats.joinedByDecision, stats.dismissed]).toEqual([1, 1, 0, 0])
  })
  it('a new person collects lines across notes without duplicates; metAt = explicit met date or earliest note', () => {
    const lena = record.people.find((p) => p.name === 'Lena Berger')!
    expect(lena.lines.map((l) => l.text)).toEqual(['Lives in Leoben', 'Runs a repair café in Graz', 'community: DWeb-Berlin_2026', 'Plays cello'])
    const c = lena.lines.find((l) => l.text.startsWith('community:'))!
    expect([c.tag, c.customTag, c.source]).toEqual(['custom', 'community', { kind: 'local', path: 'journals/2026_07_12.md' }])
    expect(lena.metAt).toBe(Date.parse('2024-03-09T12:00:00Z'))
    expect(new Set(lena.lines.map((l) => l.id)).size).toBe(4)
  })
  it('low confidence is dropped and counted; the record stays a valid AppState', () => {
    expect(record.people.find((p) => p.name === 'Jonas')).toBeUndefined()
    expect(stats.belowConfidence).toBe(1)
    expect(stats.newPersons).toBe(3)
    expect(record.people.find((p) => p.name === 'Olga Nowak')!.lines).toEqual([])
    expect(record.people.find((p) => p.name === 'Pat Name-Only')).toBeUndefined()
    expect(isAppState(record)).toBe(true)
  })
  it('is one-shot: merging again onto its own output gives the same record', () => {
    const again = merge(record, readings())
    expect(again.record).toEqual(record)
    expect(withoutLocal(record)).toEqual(withoutLocal(seed()))
  })
  it('withoutLocal strips only what the converter made; a line the bridge pulled from the vault (vault- id) stays', () => {
    const s = seed()
    s.people[0].lines.push({ ...line('vault-1', 'Lent me the printer'), source: { kind: 'local', path: 'journals/x.md' } } as never, { ...line('local-abc-def-0', 'from a reading'), source: { kind: 'local', path: 'journals/x.md' } } as never)
    expect(withoutLocal(s).people[0].lines.map((l) => l.id)).toEqual(['tana-abc-0', 'vault-1'])
  })
  it('withoutTana keeps the notes half of a person in both sources as a local person and drops Tana-only ones', () => {
    const r = withoutTana(record)
    expect(r.people.map((p) => p.name).sort()).toEqual(['Lena Berger', 'Mira Hollenstein', 'Olga Nowak'])
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

describe('converter: join offers and decisions (owner 2026-11-03)', () => {
  const TOBIAS = offerKey('Tobias', 'journals/2026_07_11.md')
  const at = '2026-11-03T09:00:00.000Z'
  it('join: the mention\'s facts become lines on the chosen person, local provenance and the note date; one shot; tana-links knows', () => {
    const r = merge(seed(), readings(), { decisions: [{ key: TOBIAS, decision: 'join', into: 'tana-def', at }] })
    const t = r.record.people.find((p) => p.id === 'tana-def')!
    expect(t.lines.map((l) => l.text)).toEqual(['Reviews OTF', 'Wants the Dec deadline confirmed'])
    expect(t.lines[1].id).toMatch(/^local-[0-9a-f]{12}-[0-9a-f]{8}-0$/)
    expect(t.lines[1].source).toEqual({ kind: 'local', path: 'journals/2026_07_11.md', reader: 'claude:haiku' })
    expect(t.lines[1].notedAt).toBe(Date.parse('2026-07-11T12:00:00Z'))
    expect(r.offers).toEqual([])
    expect([r.stats.offers, r.stats.joinedByDecision, r.stats.newPersons]).toEqual([0, 1, 3])
    expect(tanaLinksMarkdown(r.matched, readings())).toContain('- [[Tobias Rainer]] — Tana: https://app.tana.inc?nodeid=def — in: [[2026_07_11]] (2026-07-11)')
    expect(merge(r.record, readings(), { decisions: [{ key: TOBIAS, decision: 'join', into: 'tana-def', at }] }).record).toEqual(r.record)
    expect(isAppState(r.record)).toBe(true)
  })
  it('join into a local person the same run makes (a later note) works too', () => {
    const lenaId = merge(seed(), readings()).record.people.find((p) => p.name === 'Lena Berger')!.id
    const r = merge(seed(), readings(), { decisions: [{ key: TOBIAS, decision: 'join', into: lenaId, at }] })
    expect(r.record.people.find((p) => p.id === lenaId)!.lines.map((l) => l.text)).toContain('Wants the Dec deadline confirmed')
    expect(r.offers).toEqual([])
  })
  it('dismiss drops the mention; a join into an id the record no longer has is offered again', () => {
    const d = merge(seed(), readings(), { decisions: [{ key: TOBIAS, decision: 'dismiss', at }] })
    expect([d.offers.length, d.stats.dismissed]).toEqual([0, 1])
    expect(d.record.people.find((p) => p.id === 'tana-def')!.lines).toHaveLength(1)
    const g = merge(seed(), readings(), { decisions: [{ key: TOBIAS, decision: 'join', into: 'tana-gone', at }] })
    expect(g.offers.map((o) => o.name)).toEqual(['Tobias'])
    expect(g.stats.joinedByDecision).toBe(0)
  })
  it('one offer per name and note (facts merged); first names match with diacritics folded; no candidate is still an offer', () => {
    const s = seed()
    s.people.push({ id: 'tana-zoe', name: 'Zoë Brandt', context: '', ring: 'unsorted', metAt: 1, lines: [], fields: {} } as never)
    const r = merge(s, [{ path: 'journals/2026_08_01.md', date: '2026-08-01', people: [
      { name: 'Zoe', aliases: [], context: '', facts: ['Bakes bread'], met: '', confidence: 0.9 },
      { name: 'zoe', aliases: [], context: 'At the market', facts: ['Bakes bread', 'Has a van'], met: '', confidence: 0.9 },
      { name: 'Ines', aliases: [], context: 'Neighbour', facts: [], met: '', confidence: 0.9 },
    ] }] as never)
    expect(r.offers.map((o) => [o.name, o.context, o.facts, o.candidates])).toEqual([
      ['Zoe', 'At the market', ['Bakes bread', 'Has a van'], [{ id: 'tana-zoe', name: 'Zoë Brandt' }]],
      ['Ines', 'Neighbour', [], []],
    ])
    expect(r.stats.singleNames).toBe(3)
    expect(r.stats.offers).toBe(2)
  })
  it('firstNameKey: first word, lowercased, diacritics folded, ß as ss', () => {
    expect(firstNameKey('Zoë Brandt')).toBe('zoe')
    expect(firstNameKey('  zoe ')).toBe('zoe')
    expect(firstNameKey('Joß Weber')).toBe('joss')
    expect(firstNameKey('')).toBe('')
  })
  it('loadDecisions: last line per key wins; malformed lines and a join without into are ignored', () => {
    const text = [
      JSON.stringify({ key: 'a', decision: 'dismiss', at }),
      'not json',
      JSON.stringify({ key: 'b', decision: 'maybe', at }),
      JSON.stringify({ key: 'c', decision: 'join', at }),
      JSON.stringify({ key: 'a', decision: 'join', into: 'tana-x', at }),
      '',
    ].join('\n')
    expect(loadDecisions(text)).toEqual([{ key: 'a', decision: 'join', into: 'tana-x', at }])
    expect(loadDecisions('')).toEqual([])
  })
  it('writeIfChanged: no rewrite and no backup when the bytes are the same; a backup only before a real change', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'out-'))
    const out = path.join(d, 'record.json')
    const now = Date.UTC(2026, 10, 3, 9, 15)
    expect(writeIfChanged(out, 'a\n', { now })).toBe('written')
    expect(writeIfChanged(out, 'a\n', { now })).toBe('unchanged')
    expect(readdirSync(d)).toEqual(['record.json'])
    expect(writeIfChanged(out, 'b\n', { now })).toBe('written')
    expect(readdirSync(d).sort()).toEqual(['record.json', 'record.json.bak.20261103T091500'])
    expect(readFileSync(`${out}.bak.20261103T091500`, 'utf8')).toBe('a\n')
  })
  it('CLI: --decisions honoured, --offers written every run (pending only), a second identical run says unchanged', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'cli-'))
    const f = (n: string) => path.join(d, n)
    writeFileSync(f('people.jsonl'), readings().map((r) => JSON.stringify(r)).join('\n') + '\n')
    writeFileSync(f('seed.json'), JSON.stringify(seed()))
    const script = path.join(path.dirname(new URL(import.meta.url).pathname), '../../scripts/notes_persons_to_record.mjs')
    const run = () => spawnSync(process.execPath, [script, f('people.jsonl'), f('seed.json'), '--merge', f('seed.json'), '--decisions', f('decisions.jsonl'), '--offers', f('offers.json')], { encoding: 'utf8' })
    const one = run()
    expect(one.status).toBe(0)
    expect(one.stdout).toContain('offers 1')
    const o = JSON.parse(readFileSync(f('offers.json'), 'utf8'))
    expect([o.v, typeof o.generatedAt, o.offers.map((x) => x.name)]).toEqual([1, 'string', ['Tobias']])
    const two = run()
    expect(two.stdout).toContain('unchanged')
    expect(readdirSync(d).filter((n) => n.includes('.bak.'))).toHaveLength(1)
    writeFileSync(f('decisions.jsonl'), JSON.stringify({ key: o.offers[0].key, decision: 'dismiss', at: '2026-11-03T09:00:00.000Z' }) + '\n')
    const three = run()
    expect(three.stdout).toContain('offers 0')
    expect(JSON.parse(readFileSync(f('offers.json'), 'utf8')).offers).toEqual([])
    expect(existsSync(f('seed.json'))).toBe(true)
  })
})

describe('notes_sync pull', () => {
  it('chains the reader (resumable) and the converter on the same seed, work files beside the vault assets', async () => {
    const { pullArgs } = await import('../../scripts/notes_sync.mjs')
    const a = pullArgs({ vault: '/v', seed: '/s/record.json', reader: 'ollama:qwen3.5:4b', include: 'journals,pages', me: 'Me' })
    expect(a.readings).toBe('/v/assets/local-notes/people-ollama-qwen3.5-4b.jsonl')
    expect(a.read).toEqual(['/v', a.readings, '--reader', 'ollama:qwen3.5:4b', '--include', 'journals,pages'])
    expect(a.convert).toEqual([a.readings, '/s/record.json', '--merge', '/s/record.json', '--tana-links', '/v/assets/local-notes/tana-links.md',
      '--decisions', '/v/assets/local-notes/join-decisions.jsonl', '--offers', '/v/assets/local-notes/join-offers.json', '--me', 'Me'])
  })
  it('the lock sits in the work dir; --skip-folders goes to the reader', async () => {
    const { pullArgs } = await import('../../scripts/notes_sync.mjs')
    const a = pullArgs({ vault: '/v', seed: '/s/record.json', reader: 'ollama:m', 'skip-folders': 'speakers,pitches' })
    expect(a.lockPath).toBe('/v/assets/local-notes/pull.lock')
    expect(a.read).toEqual(['/v', a.readings, '--reader', 'ollama:m', '--skip-folders', 'speakers,pitches'])
    expect(pullArgs({ vault: '/v', seed: '/s', reader: 'r', work: '/w' }).lockPath).toBe('/w/pull.lock')
  })
})

describe('reader: what gets read', () => {
  const vault = () => {
    const v = mkdtempSync(path.join(tmpdir(), 'vault-'))
    const body = '\n- Coffee with Taro Lindqvist about the community garden, he offered seedlings.\n'
    const notes = {
      'journals/2026_10_01.md': `# day${body}`,
      'speakers/conf.md': `# Speakers${body}`,
      'a/speakers/nested.md': `# Nested${body}`,
      'pitches/deck.md': `# Deck${body}`,
      'pages/talk.md': `---\npeople: skip\n---\n# Talk${body}`,
      'pages/private.md': `---\ntrustweb: no\n---\n# Private${body}`,
      'pages/tiny.md': 'Ines',
    }
    for (const [rel, text] of Object.entries(notes)) { mkdirSync(path.dirname(path.join(v, rel)), { recursive: true }); writeFileSync(path.join(v, rel), text) }
    return v
  }
  it('inSkippedFolder: entries are vault-relative folder paths, matched on whole segments from the root', async () => {
    const { inSkippedFolder } = await import('../../scripts/notes_read_persons.mjs')
    expect(inSkippedFolder('speakers/x.md', ['speakers'])).toBe(true)
    expect(inSkippedFolder('speakers/2026/x.md', ['speakers'])).toBe(true)
    expect(inSkippedFolder('a/speakers/y.md', ['speakers'])).toBe(false)
    expect(inSkippedFolder('a/speakers/y.md', ['a/speakers'])).toBe(true)
    expect(inSkippedFolder('speakers-old/x.md', ['speakers'])).toBe(false)
    expect(inSkippedFolder('speakers.md', ['speakers'])).toBe(false)
    expect(inSkippedFolder('x.md', [])).toBe(false)
  })
  it('skipFolders: the flag list plus <vault>/.trustweb-notes.json, cleaned and unique', async () => {
    const { skipFolders } = await import('../../scripts/notes_read_persons.mjs')
    const v = mkdtempSync(path.join(tmpdir(), 'vault-'))
    expect(skipFolders(v, [' speakers/ ', ''])).toEqual(['speakers'])
    writeFileSync(path.join(v, '.trustweb-notes.json'), JSON.stringify({ skipFolders: ['/pitches', 'speakers', 'a\\b'] }))
    expect(skipFolders(v, ['speakers'])).toEqual(['speakers', 'pitches', 'a/b'])
    writeFileSync(path.join(v, '.trustweb-notes.json'), '{ not json')
    expect(() => skipFolders(v, [])).toThrow(/\.trustweb-notes\.json/)
    writeFileSync(path.join(v, '.trustweb-notes.json'), JSON.stringify({ skipFolders: 'speakers' }))
    expect(() => skipFolders(v, [])).toThrow(/skipFolders/)
  })
  it('selectNotes: skipped folders are never loaded; people: skip and trustweb: no are counted, not read', async () => {
    const { selectNotes, noteKey } = await import('../../scripts/notes_read_persons.mjs')
    const texts = { 'speakers/x.md': 'never loaded', 'j/a.md': `---\npeople: skip\n---\n${'x'.repeat(60)}`, 'j/b.md': `---\ntrustweb: no\n---\n${'x'.repeat(60)}`, 'j/c.md': 'short', 'j/d.md': 'y'.repeat(60), 'j/e.md': 'z'.repeat(60) }
    const loaded = []
    const load = (rel) => { loaded.push(rel); return { text: texts[rel], mtimeMs: Date.UTC(2026, 9, 1) } }
    const done = new Set([noteKey('j/e.md', 'z'.repeat(60), 'r')])
    const s = selectNotes(Object.keys(texts), load, { done, reader: 'r', folders: ['speakers'] })
    expect(loaded).not.toContain('speakers/x.md')
    expect(s.todo.map((t) => t.rel)).toEqual(['j/d.md'])
    expect([s.folderSkipped, s.peopleSkipped, s.optedOut, s.skippedSmall]).toEqual([1, 1, 1, 1])
  })
  it('--dry-run lists the todo without a reader: no folder-skipped, people: skip or opted-out note in it', async () => {
    const { spawnSync } = await import('node:child_process')
    const v = vault()
    writeFileSync(path.join(v, '.trustweb-notes.json'), JSON.stringify({ skipFolders: ['pitches'] }))
    const script = path.join(import.meta.dirname, '../../scripts/notes_read_persons.mjs')
    const r = spawnSync(process.execPath, [script, v, path.join(v, 'out.jsonl'), '--dry-run', '--skip-folders', 'speakers'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('7 notes, 2 in skipped folders, 1 too small, 1 opted out (#no-trustweb), 1 people: skip')
    const listed = r.stdout.split('\n').slice(1).filter(Boolean)
    expect(listed.map((l) => l.split('  ')[1]).sort()).toEqual(['a/speakers/nested.md', 'journals/2026_10_01.md'])
  })
})
