// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'
import { commitPlan, decide, pendingProposals } from '../../src/services_import.ts'
import { defineLabelTags } from '../../src/import_curate.ts'
import { parseNote } from '../../src/ext/obsidian/obsidian_parse.ts'
import { buildContacts } from '../../src/ext/obsidian/obsidian_people.ts'
import { planVault } from '../../src/ext/obsidian/obsidian_stage.ts'
import { deepLink } from '../../src/ext/obsidian/obsidian_data.ts'
import { NOTES, VAULT } from '../fixtures/synthetic_vault.mjs'

const NOW = Date.UTC(2026, 10, 10)
const notes = (over = {}) => Object.entries({ ...NOTES, ...over }).filter(([p]) => p.endsWith('.md')).map(([p, t]) => parseNote(p, t))
const contacts = (over) => buildContacts(notes(over)).contacts
const fresh = () => ({ people: [], serviceImports: [] })
let n = 0
const newId = () => `id${++n}`

describe('planVault -> the existing Curate pipeline', () => {
  it('counts under obsidian, one row per person, the note path on every row', () => {
    const s = fresh()
    const plan = planVault(s, contacts(), { me: 'Me', now: NOW })
    expect(plan.counts).toEqual({ obsidian: 8 })
    expect(plan.rows).toHaveLength(8)
    expect(plan.rows.every((r) => r.source === 'obsidian' && r.obsidianNote === r.file && r.file.endsWith('.md'))).toBe(true)
    expect(plan.rows.some((r) => r.ai)).toBe(false)
    expect(plan.diff).toEqual({ added: 8, changed: 0, unchanged: 0 })
  })
  it('the batch gets the system tag #import:<date>-obsidian and nothing reaches the record before Accept', () => {
    const s = fresh()
    commitPlan(s, planVault(s, contacts(), { me: 'Me', now: NOW }), 'b1', NOW)
    expect(s.serviceImports[0].tag).toBe('import:2026-11-10-obsidian')
    expect(s.people).toEqual([])
    expect(pendingProposals(s, NOW)).toHaveLength(8)
  })
  it('Accept writes the person with e-mail, phone, labels as tags, the note excerpt and the vault note path', () => {
    const s = fresh()
    commitPlan(s, planVault(s, contacts(), { me: 'Me', now: NOW }), 'b1', NOW)
    const alma = pendingProposals(s, NOW).find((x) => x.row.name === 'Alma Brandt')
    const { tagOf } = defineLabelTags([], ['family'])
    decide(s, 'b1', alma.row.key, { do: 'accept' }, NOW, newId, tagOf)
    const p = s.people[0]
    expect(p.name).toBe('Alma Brandt')
    expect(p.fields.obsidianNote).toBe('People/Alma Brandt.md')
    expect(p.fields[EMAIL_FIELD]).toBe('alma.brandt@example.org')
    expect(p.fields.note).toContain('Source: People/Alma Brandt.md')
    expect(p.fields['import:2026-11-10-obsidian']).toBe(true)
    expect(p.fields.family).toBe(true)
  })
  it('re-sync: an unchanged vault needs no new decision; one changed note comes back as the only pending row', () => {
    const s = fresh()
    commitPlan(s, planVault(s, contacts(), { me: 'Me', now: NOW }), 'b1', NOW)
    const again = planVault(s, contacts(), { me: 'Me', now: NOW + 1 })
    expect(again.diff).toEqual({ added: 0, changed: 0, unchanged: 8 })
    commitPlan(s, again, 'b2', NOW + 1)
    expect(pendingProposals(s, NOW + 2)).toEqual([])   // the same rows need no new decision
    const s2 = fresh()
    commitPlan(s2, planVault(s2, contacts(), { me: 'Me', now: NOW }), 'b1', NOW)
    for (const x of pendingProposals(s2, NOW)) decide(s2, 'b1', x.row.key, { do: 'leave' }, NOW, newId)
    const edited = contacts({ 'Contacts/Elif Farkas.md': NOTES['Contacts/Elif Farkas.md'] + 'New phone soon.\n' })
    const plan = planVault(s2, edited, { me: 'Me', now: NOW + 5 })
    expect(plan.diff).toEqual({ added: 0, changed: 1, unchanged: 7 })
    commitPlan(s2, plan, 'b2', NOW + 5)
    const pending = pendingProposals(s2, NOW + 6)
    expect(pending.map((x) => x.row.name)).toEqual(['Elif Farkas'])
  })
  it('AI people: source obsidian-ai, flagged, own system tag', () => {
    const s = fresh()
    const ai = [{ source: 'obsidian-ai', file: 'Daily/2026-11-02.md', sourceRef: 'ai:tessa', name: 'Tessa Ulrich', phones: [], emails: [], labels: [], note: 'Facts' }]
    const plan = planVault(s, ai, { me: 'Me', now: NOW, ai: true })
    expect(plan.counts).toEqual({ 'obsidian-ai': 1 })
    expect(plan.rows[0].ai).toBe(true)
    expect(plan.rows[0].obsidianNote).toBeUndefined()
    commitPlan(s, plan, 'b1', NOW)
    expect(s.serviceImports[0].tag).toBe('import:2026-11-10-obsidian-ai')
  })
})

describe('deepLink', () => {
  it('obsidian://open?vault=..&file=.. with the .md left off and everything encoded', () => {
    expect(deepLink(VAULT, 'People/Alma Brandt.md')).toBe('obsidian://open?vault=Greenhouse&file=People%2FAlma%20Brandt')
    expect(deepLink('My Vault & Co', 'Ä/x#y.md')).toBe('obsidian://open?vault=My%20Vault%20%26%20Co&file=%C3%84%2Fx%23y')
  })
  it('no link without a vault name or a note path', () => {
    expect(deepLink('', 'a.md')).toBeNull()
    expect(deepLink('V', '')).toBeNull()
  })
})
