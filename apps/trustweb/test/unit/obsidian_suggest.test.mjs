// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 import-obsidian-ai (F05): "Let my AI look for more people": suggestions from titles + first 300 characters, never auto-added. */
import { makeAsk } from '../../src/ext/obsidian/obsidian_endpoint.ts'
import { parseNote } from '../../src/ext/obsidian/obsidian_parse.ts'
import { SNIPPET_CHARS, SUGGEST_BATCH, snippetsOf, suggestPeople, suggestionContacts, validateSuggestions } from '../../src/ext/obsidian/obsidian_suggest.ts'
import { obsidianAiAdapter } from '../../src/ext/obsidian/obsidian_stage.ts'
import { planFrom } from '../../src/import_pipeline.ts'
import { decide, commitPlan, pendingProposals } from '../../src/services_import.ts'
import { NOTES } from '../fixtures/synthetic_vault.mjs'

const NOW = Date.UTC(2026, 10, 12)
const LONG = 'x'.repeat(2000)
const vault = (extra = {}) => Object.entries({ ...NOTES, ...extra }).filter(([p]) => p.endsWith('.md')).map(([p, t]) => parseNote(p, t))
const pc24 = { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' }

describe('snippetsOf: what may leave the device', () => {
  it('title + at most 300 characters of each note that is not a person note already', () => {
    const notes = vault({ 'Daily/2026-11-01.md': `Coffee with Leonie today. ${LONG}`, 'Ideas/Long.md': LONG })
    const sn = snippetsOf(notes)
    const coffee = sn.find((s) => s.path === 'Daily/2026-11-01.md')
    expect(coffee.title).toBe('2026-11-01')
    expect(coffee.text.length).toBeLessThanOrEqual(SNIPPET_CHARS)
    expect(coffee.text).toContain('Coffee with Leonie')
    expect(sn.every((s) => s.text.length <= SNIPPET_CHARS)).toBe(true)
    // person notes (People folder, #person) are found by the rule already: not sent
    expect(sn.some((s) => /^People\//.test(s.path))).toBe(false)
  })
})

describe('validateSuggestions: the reply is untrusted', () => {
  const paths = ['a.md', 'b.md']
  it('keeps valid entries, clamps confidence, drops unknown paths, junk and a second suggestion for one file', () => {
    const v = validateSuggestions({ people: [
      { path: 'a.md', name: ' Leonie ', confidence: 1.7, why: 'Coffee with Leonie' },
      { path: 'b.md', name: 'Max', confidence: -3 },
      { path: 'b.md', name: 'Other', confidence: 0.5 },
      { path: 'ghost.md', name: 'Nobody', confidence: 0.9 },
      { path: 'a.md', name: 'X', confidence: 0.9 }, 'junk', null,
    ] }, paths)
    expect(v.valid).toBe(true)
    expect(v.suggestions).toEqual([{ path: 'a.md', name: 'Leonie', confidence: 1, why: 'Coffee with Leonie' }, { path: 'b.md', name: 'Max', confidence: 0, why: '' }])
  })
  it('not the schema = invalid', () => {
    for (const bad of [null, [], 'x', {}, { people: 'a' }]) expect(validateSuggestions(bad, paths).valid).toBe(false)
  })
})

describe('suggestPeople with a mocked endpoint', () => {
  it('"Coffee with Leonie" without #person becomes a suggestion, sent as title + excerpt only to the endpoint', async () => {
    const notes = vault({ 'Daily/2026-11-01.md': `Coffee with Leonie at the market. ${LONG}` })
    const calls = []
    const f = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ people: [{ path: 'Daily/2026-11-01.md', name: 'Leonie', confidence: 0.8, why: 'Coffee with Leonie' }] }) } }] }) }
    }
    const r = await suggestPeople(snippetsOf(notes), makeAsk(pc24, f))
    expect(r.suggestions).toEqual([{ path: 'Daily/2026-11-01.md', name: 'Leonie', confidence: 0.8, why: 'Coffee with Leonie' }])
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.url === 'http://localhost:11435/v1/chat/completions')).toBe(true)
    const sent = calls.map((c) => c.body.messages[1].content).join('\n')
    expect(sent).toContain('Coffee with Leonie')
    expect(sent).not.toContain('x'.repeat(SNIPPET_CHARS + 50))
  })
  it('batches of SUGGEST_BATCH, progress reported, best confidence first', async () => {
    const sn = Array.from({ length: SUGGEST_BATCH * 2 + 1 }, (_, i) => ({ path: `n${i}.md`, title: `n${i}`, text: 'hello' }))
    const seen = []
    const ask = async (_s, user) => {
      const paths = [...user.matchAll(/### FILE: (\S+)/g)].map((m) => m[1])
      seen.push(paths.length)
      return { people: [{ path: paths[0], name: `Person ${paths[0]}`, confidence: seen.length / 10 }] }
    }
    const progress = []
    const r = await suggestPeople(sn, ask, { onProgress: (d, t) => progress.push([d, t]) })
    expect(seen).toEqual([SUGGEST_BATCH, SUGGEST_BATCH, 1])
    expect(progress.at(-1)).toEqual([3, 3])
    expect(r.suggestions.map((s) => s.confidence)).toEqual([0.3, 0.2, 0.1])
  })
  it('a failing batch is tried twice, then counted; no endpoint sends nothing', async () => {
    let n = 0
    const r = await suggestPeople([{ path: 'a.md', title: 'a', text: 't' }], async () => { n++; throw new Error('down') })
    expect(r).toEqual({ suggestions: [], failed: 1 })
    expect(n).toBe(2)
    expect(await suggestPeople([{ path: 'a.md', title: 'a', text: 't' }], null)).toEqual({ suggestions: [], failed: 0 })
  })
  it('a refused endpoint (hosted AI) gives no ask function at all', () => {
    expect(makeAsk({ ...pc24, name: undefined, baseUrl: 'https://api.openai.com/v1' }, async () => { throw new Error('must not be called') })).toBeNull()
  })
})

describe('ticked suggestions go through the one pipeline, as checks for the owner', () => {
  it('become obsidian-ai rows; nothing is a person before Accept', () => {
    const s = { people: [], serviceImports: [] }
    const sugg = [{ path: 'Daily/2026-11-01.md', name: 'Leonie', confidence: 0.8, why: 'Coffee with Leonie' }]
    expect(suggestionContacts(sugg)[0]).toMatchObject({ source: 'obsidian-ai', name: 'Leonie', emails: [], phones: [] })
    const plan = planFrom(s, [{ adapter: obsidianAiAdapter, input: sugg }], { me: 'Me', now: NOW })
    commitPlan(s, plan, 'b1', NOW)
    expect(s.people).toHaveLength(0)
    expect(s.serviceImports[0].tag).toBe('import:2026-11-12-obsidian-ai')
    const p = pendingProposals(s, NOW)
    expect(p).toHaveLength(1)
    expect(p[0].row.ai).toBe(true)
    decide(s, 'b1', p[0].row.key, { do: 'accept' }, NOW, () => 'p1')
    expect(s.people[0].name).toBe('Leonie')
  })
})
