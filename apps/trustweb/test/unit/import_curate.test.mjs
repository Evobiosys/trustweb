// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'
import { Ring } from '../../src/model.ts'
import { planServices, commitPlan, pendingProposals, decide, undoBatch } from '../../src/services_import.ts'
import {
  DEFAULT_IMPORT_NOTE, acceptRows, defineLabelTags, acceptAllAsAcquaintances, bulkAddLabels, bulkAppendNote, bulkConnect, bulkUnconnect, bulkRemoveLabels, bulkSetRing, dupePairs, editRow, filterByTag, hasHistory,
  contactOf, importTagId, isDateName, isUnnamed, keepBoth, mergePair, previewUndo, rowTags, setRingByTag, sortPending, tagCounts, tagSlug, undoBatches,
} from '../../src/import_curate.ts'
import { NAMES, syntheticVcf } from '../fixtures/synthetic_contacts.mjs'

const NOW = Date.UTC(2026, 10, 10)
let n = 0
const newId = () => `id${++n}`
const fresh = () => ({ people: [], serviceImports: [] })
const staged = (s = fresh()) => {
  commitPlan(s, planServices(s, [{ name: 'contacts.vcf', text: syntheticVcf() }], { me: 'Me', now: NOW }), 'b1', NOW)
  return s
}

describe('synthetic fixture', () => {
  it('has 30 rows: 3 date-named, 3 phone-only', () => {
    const s = staged()
    const rows = s.serviceImports[0].rows
    expect(rows).toHaveLength(30)
    expect(rows.filter((r) => isDateName(r.name))).toHaveLength(3)
    expect(rows.filter(isUnnamed)).toHaveLength(6)
  })
})

describe('tag extraction', () => {
  it('rowTags are the labels of the card, no system labels', () => {
    const s = staged()
    const r = (name) => s.serviceImports[0].rows.find((x) => x.name === name)
    expect(rowTags(r(NAMES[0]))).toEqual(['Minerva'])
    expect(rowTags(r(NAMES[12]))).toEqual(['Minerva', 'Family Updated'])
    expect(rowTags(r(NAMES[19]))).toEqual([])
  })
  it('tagSlug is stable and readable', () => { expect(tagSlug('Keep Contact')).toBe('keep-contact'); expect(tagSlug('  DDO Network Face to Face ')).toBe('ddo-network-face-to-face') })
  it('Accept writes the labels as person tags (boolean fields) and keeps the labels field', () => {
    const s = staged()
    const p = pendingProposals(s, NOW).find((x) => x.row.name === NAMES[12])
    decide(s, 'b1', p.row.key, { do: 'accept' }, NOW, newId)
    const person = s.people[0]
    expect(String(person.fields.minerva)).toBe('true')
    expect(String(person.fields['family-updated'])).toBe('true')
    expect(person.fields.labels).toBe('Minerva, Family Updated')
  })
  it('tagOf maps a label to an existing tag id', () => {
    const s = staged()
    const p = pendingProposals(s, NOW).find((x) => x.row.name === NAMES[0])
    decide(s, 'b1', p.row.key, { do: 'accept' }, NOW, newId, (l) => (l === 'Minerva' ? 'tag-minerva' : tagSlug(l)))
    expect(String(s.people[0].fields['tag-minerva'])).toBe('true')
  })
  it('tagCounts and filterByTag', () => {
    const s = staged()
    const list = pendingProposals(s, NOW)
    expect(tagCounts(list).find((t) => t.label === 'Minerva').count).toBe(11)
    expect(filterByTag(list, 'Keep Contact')).toHaveLength(4)
    expect(filterByTag(list, null)).toHaveLength(30)
  })
})

describe('label tags', () => {
  it('reuses a tag with the same label and defines the rest, one colour each', () => {
    const have = [{ id: 'minerva', colour: '#2e7d32', label: 'Minerva' }]
    const { tags, tagOf, created } = defineLabelTags(have, ['minerva', 'Keep Contact', 'Family Updated'])
    expect(tagOf('minerva')).toBe('minerva')
    expect(tagOf('Keep Contact')).toBe('keep-contact')
    expect(created.map((t) => t.label)).toEqual(['Keep Contact', 'Family Updated'])
    expect(tags).toHaveLength(3)
    expect(new Set(tags.map((t) => t.colour)).size).toBe(3)
  })
})

describe('sort order', () => {
  it('useful rows (name + contact + tag) first, then contact only, date-named and phone-only last', () => {
    const s = staged()
    const { useful, unnamed } = sortPending(pendingProposals(s, NOW))
    expect(unnamed).toHaveLength(6)
    expect(unnamed.every((x) => isUnnamed(x.row))).toBe(true)
    expect(useful).toHaveLength(24)
    const tagged = useful.map((x) => rowTags(x.row).length > 0)
    expect(tagged.indexOf(false)).toBeGreaterThanOrEqual(tagged.lastIndexOf(true))
    expect(useful.slice(0, 3).every((x) => rowTags(x.row).length > 0)).toBe(true)
  })
  it('a contacts file has no chat history', () => {
    const s = staged()
    expect(s.serviceImports[0].rows.every((r) => !hasHistory(r))).toBe(true)
  })
})

describe('bulk operations before Accept', () => {
  it('adds and removes labels on several rows, no duplicates', () => {
    const s = staged()
    const rows = s.serviceImports[0].rows.slice(0, 3)
    expect(bulkAddLabels(rows, ['Friends of X', 'Minerva'])).toBe(3)
    expect(rows.every((r) => r.labels.includes('Friends of X'))).toBe(true)
    expect(rows[0].labels.filter((l) => l === 'Minerva')).toHaveLength(1)
    bulkRemoveLabels(rows, ['Minerva'])
    expect(rows.every((r) => !r.labels.includes('Minerva'))).toBe(true)
  })
  it('sets one ring and appends one note to all', () => {
    const s = staged()
    const rows = s.serviceImports[0].rows.slice(0, 2)
    bulkSetRing(rows, Ring.Friend)
    bulkAppendNote(rows, 'met at the fair')
    bulkAppendNote(rows, 'again')
    expect(rows.every((r) => r.ring === Ring.Friend && r.note === 'met at the fair\nagain')).toBe(true)
  })
  it('connects several rows with the same person or tag, and takes it away again', () => {
    const s = staged()
    const rows = s.serviceImports[0].rows.slice(0, 2)
    bulkConnect(rows, ['person:p1', 'tag:minerva'])
    bulkConnect(rows, ['person:p1'])
    expect(rows.every((r) => r.connected.length === 2)).toBe(true)
    bulkUnconnect(rows, ['person:p1', 'tag:minerva'])
    expect(rows.every((r) => r.connected === undefined)).toBe(true)
  })
  it('a chosen ring is what Accept writes', () => {
    const s = staged()
    const row = s.serviceImports[0].rows.find((r) => r.name === NAMES[4])
    row.ring = Ring.Friend
    decide(s, 'b1', row.key, { do: 'accept' }, NOW, newId)
    expect(s.people[0].ring).toBe(Ring.Friend)
  })
  it('by tag -> ring changes only rows with that tag', () => {
    const s = staged()
    expect(setRingByTag(pendingProposals(s, NOW), 'Keep Contact', Ring.Friend)).toBe(4)
    expect(s.serviceImports[0].rows.filter((r) => r.ring === Ring.Friend)).toHaveLength(4)
  })
  it('accept selected writes the selected people only', () => {
    const s = staged()
    const keys = new Set(s.serviceImports[0].rows.slice(0, 5).map((r) => r.key))
    expect(acceptRows(s, keys, NOW, newId)).toBe(5)
    expect(s.people).toHaveLength(5)
  })
  it('Accept all as Acquaintances skips flagged and unnamed rows', () => {
    const s = staged()
    const n = acceptAllAsAcquaintances(s, NOW, newId)
    expect(n).toBeGreaterThan(10)
    expect(s.people.every((p) => p.ring === Ring.Acquaintance)).toBe(true)
    expect(s.people.some((p) => isUnnamed({ name: p.name }))).toBe(false)
  })
  it('edit a row: every field, the note is a field too', () => {
    const s = staged()
    const row = s.serviceImports[0].rows[0]
    editRow(row, { name: 'Renamed', emails: ['a@example.org', 'b@example.org'], phones: ['+43 1'], labels: ['X'], note: 'hello', ring: Ring.Close, connected: ['person:p9', 'tag:minerva'] })
    expect(row).toMatchObject({ name: 'Renamed', emails: ['a@example.org', 'b@example.org'], phones: ['+43 1'], labels: ['X'], note: 'hello', ring: Ring.Close })
    decide(s, 'b1', row.key, { do: 'accept' }, NOW, newId)
    const p = s.people[0]
    expect(p.name).toBe('Renamed')
    expect(p.fields.note).toBe('hello')
    expect(p.knows).toEqual(['p9'])
    expect(p.affiliated).toEqual(['minerva'])
    expect(String(p.fields.x)).toBe('true')
  })
})

describe('system tag', () => {
  it('is import:<date>-<source>', () => { expect(importTagId(NOW, ['vcard'])).toBe('import:2026-11-10-vcf'); expect(importTagId(NOW, ['vcard', 'whatsapp'])).toBe('import:2026-11-10-vcf+whatsapp') })
  it('commit stamps the batch with tag and default note; every accepted person holds the tag', () => {
    const s = staged()
    expect(s.serviceImports[0].tag).toBe('import:2026-11-10-vcf')
    expect(s.serviceImports[0].note).toBe(DEFAULT_IMPORT_NOTE)
    decide(s, 'b1', s.serviceImports[0].rows[0].key, { do: 'accept' }, NOW, newId)
    expect(String(s.people[0].fields['import:2026-11-10-vcf'])).toBe('true')
  })
})

describe('undo with edits', () => {
  const accepted = () => {
    const s = staged()
    for (const r of s.serviceImports[0].rows.slice(0, 4)) decide(s, 'b1', r.key, { do: 'accept' }, NOW, newId)
    return s
  }
  it('removes the tags it wrote and archives what it created', () => {
    const s = accepted()
    const r = undoBatch(s, 'b1')
    expect(r.archived).toBe(4)
    expect(s.people.every((p) => p.ring === Ring.None)).toBe(true)
    expect(s.people.every((p) => !Object.keys(p.fields ?? {}).some((k) => k === 'minerva' || k.startsWith('import:')))).toBe(true)
  })
  it('previews which people the owner edited since', () => {
    const s = accepted()
    s.people[1].name = 'Edited by me'
    s.people[2].generalNote = 'my note'
    const pre = previewUndo(s, ['b1'])
    expect(pre.edited.map((e) => e.personId).sort()).toEqual([s.people[1].id, s.people[2].id].sort())
    expect(pre.untouched).toBe(2)
  })
  it('keeps edited people unless also undo my edits', () => {
    const s = accepted()
    s.people[1].name = 'Edited by me'
    const r = undoBatch(s, 'b1')
    expect(r).toMatchObject({ archived: 3, kept: 1 })
    expect(r.keptIds).toEqual([s.people[1].id])
    expect(s.people[1].ring).not.toBe(Ring.None)
    const t = accepted()
    t.people[1].name = 'Edited by me'
    const r2 = undoBatch(t, 'b1', { undoEdits: true })
    expect(r2).toMatchObject({ archived: 4, kept: 0 })
  })
  it('undoes several imports in one go', () => {
    const s = accepted()
    commitPlan(s, planServices(s, [{ name: 'more.vcf', text: syntheticVcf() }], { me: 'Me', now: NOW }), 'b2', NOW + 1)
    const r = undoBatches(s, ['b1', 'b2'])
    expect(s.serviceImports).toEqual([])
    expect(r.archived).toBe(4)
  })
})

describe('dedupe view', () => {
  it('junk rows (date-named, number-only) never pair up by name', () => {
    const s = staged()
    expect(dupePairs(s, pendingProposals(s, NOW)).every((p) => !isUnnamed(p.a.row) && !(p.b.row && isUnnamed(p.b.row)))).toBe(true)
  })
  it('lists pairs inside the import and against people already there', () => {
    const s = staged()
    s.people.push({ id: 'x', name: NAMES[4], ring: Ring.Friend, lines: [], fields: {} })
    const pairs = dupePairs(s, pendingProposals(s, NOW))
    const names = pairs.map((p) => [p.a.row.name, p.b.row?.name ?? p.b.person.name])
    expect(names.some(([a, b]) => a === NAMES[0] && /Brandtt/.test(b))).toBe(true)
    expect(names.some(([a, b]) => a === NAMES[4] && b === NAMES[4])).toBe(true)
  })
  it('Merge folds the second row into the first; Keep both clears the flag', () => {
    const s = staged()
    const pairs = dupePairs(s, pendingProposals(s, NOW))
    const pair = pairs.find((p) => p.a.row.name === NAMES[0] && p.b.row)
    mergePair(s, pair)
    expect(s.serviceImports[0].done[pair.b.row.key]).toEqual({ did: 'left' })
    const other = dupePairs(s, pendingProposals(s, NOW)).find((p) => p.a.row.name === NAMES[1])
    keepBoth(s, other)
    expect(dupePairs(s, pendingProposals(s, NOW)).some((p) => p.a.row.key === other.a.row.key && p.b.row?.key === other.b.row?.key)).toBe(false)
  })
})

describe('resources imports: undo several, edits kept unless asked', async () => {
  const { applyImport, editedItems, parseImportFile, planImport, undoImport } = await import('../../src/inventory_import.ts')
  const K = ['0123456789abcdef', 'fedcba9876543210']
  const file = JSON.stringify({ format: 'trustweb-inventory-import', version: 1, exportedOn: '2026-10-06', items: K.map((key, i) => ({ key, text: `Line number ${i} here`, audience: 'me', provenance: 'tana' })) })
  const state = () => ({ people: [], inventory: [] })
  it('lists the lines the owner changed since and keeps them unless also undo my edits', () => {
    const s = state()
    const b = applyImport(s, planImport(s, parseImportFile(file)), 5, () => `i${++n}`)
    s.inventory[0].text = 'my own words now'
    expect(editedItems(s, b.id)).toEqual([s.inventory[0].id])
    const t = structuredClone(s)
    expect(undoImport(s, b.id)).toEqual({ removed: 1, kept: 1 })
    expect(undoImport(t, b.id, { undoEdits: true })).toEqual({ removed: 2, kept: 0 })
  })
})

describe('contact data in lists', () => {
  it('a person row shows the e-mail and the phone from the fields', () => {
    expect(contactOf({ fields: { [EMAIL_FIELD]: 'a@example.org', phone: '+43 1', 'phone 2': '+43 2' } })).toEqual({ email: 'a@example.org', phone: '+43 1' })
    expect(contactOf({})).toEqual({ email: '', phone: '' })
  })
})
