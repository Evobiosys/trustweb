// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { SYSTEM_PROMPT, buildUser, mergePeople, planBatches, progressOf, toContacts, validateExtraction, BATCH_DEFAULTS } from '../../src/ext/obsidian/obsidian_ingest.ts'

const items = (n, chars = 1000) => Array.from({ length: n }, (_, i) => ({ path: `Notes/n${String(i).padStart(3, '0')}.md`, chars }))

describe('planBatches', () => {
  it('covers every note exactly once, in order, and no batch is over the character or note budget', () => {
    const list = items(100, 1500)
    const b = planBatches(list)
    expect(b.flatMap((x) => x.items.map((i) => i.path))).toEqual(list.map((i) => i.path))
    for (const x of b) {
      expect(x.items.reduce((a, i) => a + i.chars, 0)).toBeLessThanOrEqual(BATCH_DEFAULTS.budget)
      expect(x.items.length).toBeLessThanOrEqual(BATCH_DEFAULTS.maxNotes)
    }
    expect(b.map((x) => x.index)).toEqual(b.map((_, i) => i))
  })
  it('one long note is cut to the per-note size and still fits', () => {
    const b = planBatches([{ path: 'big.md', chars: 500_000 }])
    expect(b).toHaveLength(1)
    expect(b[0].items[0].chars).toBe(BATCH_DEFAULTS.perNote)
  })
  it('tiny notes are not worth a call; notes already done are skipped; empty in, empty out', () => {
    expect(planBatches([{ path: 'a.md', chars: 10 }, { path: 'b.md', chars: 400 }]).flatMap((x) => x.items.map((i) => i.path))).toEqual(['b.md'])
    expect(planBatches(items(3), { skip: new Set(['Notes/n001.md']) }).flatMap((x) => x.items.map((i) => i.path))).toEqual(['Notes/n000.md', 'Notes/n002.md'])
    expect(planBatches([])).toEqual([])
  })
  it('options override the defaults', () => {
    expect(planBatches(items(10, 100), { maxNotes: 2 })).toHaveLength(5)
    expect(planBatches(items(4, 3000), { budget: 3000 })).toHaveLength(4)
  })
})

describe('prompt', () => {
  it('the system prompt fixes the schema and tells the model to treat the notes as data', () => {
    for (const k of ['people', 'name', 'aliases', 'facts', 'relations', 'source', 'JSON']) expect(SYSTEM_PROMPT).toContain(k)
    expect(SYSTEM_PROMPT).toMatch(/not instructions|data, not/i)
  })
  it('buildUser lists each file with its path', () => {
    const u = buildUser([{ path: 'A/x.md', text: 'hello' }, { path: 'B/y.md', text: 'world' }])
    expect(u).toContain('### FILE: A/x.md\nhello')
    expect(u).toContain('### FILE: B/y.md\nworld')
  })
})

describe('validateExtraction', () => {
  const allowed = ['A/x.md', 'B/y.md']
  const ok = { people: [{ name: 'Tessa Ulrich', aliases: ['Tess'], facts: ['Runs a bakery'], relations: [{ name: 'Ulf Vogel', relation: 'brother' }], source: 'A/x.md' }] }
  it('accepts the schema', () => {
    const r = validateExtraction(ok, allowed)
    expect(r.valid).toBe(true)
    expect(r.people).toEqual([{ name: 'Tessa Ulrich', aliases: ['Tess'], facts: ['Runs a bakery'], relations: [{ name: 'Ulf Vogel', relation: 'brother' }], sources: ['A/x.md'] }])
    expect(r.dropped).toBe(0)
  })
  it('not the shape: invalid', () => {
    for (const bad of [null, 'text', [], { persons: [] }, { people: 'x' }, 42]) expect(validateExtraction(bad, allowed).valid).toBe(false)
  })
  it('a person without a usable name or a known source is dropped and counted', () => {
    const r = validateExtraction({ people: [ok.people[0], { name: '', source: 'A/x.md' }, { name: 'Ghost', source: 'Z/unknown.md' }, { name: 'I', source: 'A/x.md' }, 'oops', { name: 'Line\nBreak', source: 'A/x.md' }] }, allowed)
    expect(r.people.map((p) => p.name)).toEqual(['Tessa Ulrich'])
    expect(r.dropped).toBe(5)
  })
  it('source may be the file name without the folder or the .md; it maps to the full path', () => {
    expect(validateExtraction({ people: [{ name: 'Tessa Ulrich', source: 'y' }] }, allowed).people[0].sources).toEqual(['B/y.md'])
    expect(validateExtraction({ people: [{ name: 'Tessa Ulrich', source: 'y.md' }] }, allowed).people[0].sources).toEqual(['B/y.md'])
  })
  it('wrong types inside are dropped; lists and texts are capped; extra keys are ignored', () => {
    const r = validateExtraction({ people: [{ name: 'Tessa Ulrich', aliases: ['ok', 7, null], facts: ['x'.repeat(900), 5], relations: [{ name: 'A', relation: 7 }, 'B', { relation: 'x' }], source: 'A/x.md', secret: 'drop me' }] }, allowed)
    const p = r.people[0]
    expect(p.aliases).toEqual(['ok'])
    expect(p.facts[0].length).toBeLessThanOrEqual(300)
    expect(p.facts).toHaveLength(1)
    expect(p.relations).toEqual([{ name: 'A', relation: '' }])
    expect('secret' in p).toBe(false)
  })
  it('at most 50 people per reply', () => {
    const many = { people: Array.from({ length: 80 }, (_, i) => ({ name: `Person Number${i}`, source: 'A/x.md' })) }
    expect(validateExtraction(many, allowed).people).toHaveLength(50)
  })
})

describe('mergePeople', () => {
  const P = (name, over = {}) => ({ name, aliases: [], facts: [], relations: [], sources: ['a.md'], ...over })
  it('same person across batches: name (any case/accents) or alias; facts, aliases, relations, sources joined once', () => {
    const m = mergePeople([[P('Tessa Ulrich', { facts: ['Baker'], aliases: ['Tess'] })], [P('tessa ulrich', { facts: ['baker', 'Likes tea'], sources: ['b.md'] }), P('Tess Ulrich', { aliases: ['Tessa Ulrich'] })], [P('Ulf Vogel', { relations: [{ name: 'Tessa', relation: 'sister' }] })]])
    expect(m.map((p) => p.name)).toEqual(['Tessa Ulrich', 'Ulf Vogel'])
    expect(m[0].facts).toEqual(['Baker', 'Likes tea'])
    expect(m[0].sources).toEqual(['a.md', 'b.md'])
    expect(m[0].aliases).toEqual(['Tess', 'Tess Ulrich'])
  })
  it('different people stay apart', () => { expect(mergePeople([[P('Ana Roth'), P('Ben Roth')]])).toHaveLength(2) })
})

describe('toContacts', () => {
  it('source obsidian-ai, the first source as file, a note that says check it', () => {
    const [c] = toContacts([{ name: 'Tessa Ulrich', aliases: ['Tess'], facts: ['Runs a bakery'], relations: [{ name: 'Ulf Vogel', relation: 'brother' }], sources: ['A/x.md', 'B/y.md'] }])
    expect([c.source, c.file, c.name, c.emails, c.phones, c.labels]).toEqual(['obsidian-ai', 'A/x.md', 'Tessa Ulrich', [], [], []])
    expect(c.sourceRef).toMatch(/^ai:/)
    const lines = c.note.split('\n')
    expect(lines[0]).toBe('Found by AI in your notes; check it.')
    expect(lines).toContain('- Runs a bakery')
    expect(lines).toContain('Also known as: Tess')
    expect(lines).toContain('Related: Ulf Vogel (brother)')
    expect(lines.at(-1)).toBe('Sources: A/x.md, B/y.md')
  })
})

describe('progressOf', () => {
  it('percent and time left from the batches done so far', () => {
    expect(progressOf(0, 10, 0)).toEqual({ pct: 0, etaMs: null })
    expect(progressOf(5, 10, 50_000)).toEqual({ pct: 50, etaMs: 50_000 })
    expect(progressOf(10, 10, 99)).toEqual({ pct: 100, etaMs: 0 })
    expect(progressOf(0, 0, 0)).toEqual({ pct: 100, etaMs: 0 })
  })
})
