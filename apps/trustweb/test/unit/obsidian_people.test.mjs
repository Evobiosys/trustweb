// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { parseNote } from '../../src/ext/obsidian/obsidian_parse.ts'
import { buildContacts, isPersonNote, MENTIONS_SHOWN } from '../../src/ext/obsidian/obsidian_people.ts'
import { NOTES } from '../fixtures/synthetic_vault.mjs'

const all = () => Object.entries(NOTES).filter(([p]) => p.endsWith('.md')).map(([p, t]) => parseNote(p, t))
const byName = (r, name) => r.contacts.find((c) => c.name === name)

describe('isPersonNote', () => {
  const note = (path, text = '') => parseNote(path, text)
  it('by folder (People, Contacts, Personen, Kontakte), at any depth, any case', () => {
    for (const p of ['People/A.md', 'contacts/A.md', 'Archive/people/Family/A.md', 'Personen/A.md', 'Kontakte/A.md']) expect(isPersonNote(note(p))).toBe(true)
  })
  it('by tag person/people/contact, frontmatter or inline, and by type: person', () => {
    expect(isPersonNote(note('x/A.md', '---\ntags: [person]\n---\n'))).toBe(true)
    expect(isPersonNote(note('x/A.md', 'hi #contact'))).toBe(true)
    expect(isPersonNote(note('x/A.md', '---\ntype: Person\n---\n'))).toBe(true)
    expect(isPersonNote(note('x/A.md', '#person/friend'))).toBe(true)
  })
  it('not an ordinary note, not a template, not a note that only mentions a person tag in text', () => {
    expect(isPersonNote(note('Projects/Garden plan.md', 'with [[Bruno]] #garden'))).toBe(false)
    expect(isPersonNote(note('Templates/Person.md', '---\ntags: [person]\n---\n'))).toBe(false)
    expect(isPersonNote(note('People/Templates/Person.md'))).toBe(false)
    expect(isPersonNote(note('x/A.md', 'a personal day'))).toBe(false)
  })
})

describe('buildContacts on the synthetic vault', () => {
  const r = buildContacts(all())
  it('finds the 8 people, none from Templates or ordinary notes', () => {
    expect(r.contacts.map((c) => c.name).sort()).toEqual(['Alma Brandt', 'Bruno Cesar', 'Chiara Dolan', 'Dmitri Evers', 'Elif Farkas', 'Fabio Gruber', 'Greta Hollis', 'Hugo Ivanov'])
    expect(r.notes).toBe(20)
  })
  it('source obsidian, file and sourceRef = the note path', () => {
    const c = byName(r, 'Alma Brandt')
    expect([c.source, c.file, c.sourceRef]).toEqual(['obsidian', 'People/Alma Brandt.md', 'People/Alma Brandt.md'])
  })
  it('e-mails, phones, organisation from the note', () => {
    const a = byName(r, 'Alma Brandt')
    expect([a.emails, a.phones]).toEqual([['alma.brandt@example.org'], ['+43 660 000 0001']])
    expect(byName(r, 'Bruno Cesar').emails).toEqual(['bruno@example.org', 'b.cesar@example.net'])
    expect(byName(r, 'Elif Farkas').org).toBe('Seed Library')
  })
  it('labels: folders below the people folder and #tags; person markers and generic folders left out', () => {
    expect(byName(r, 'Alma Brandt').labels).toEqual(['family'])
    expect(byName(r, 'Dmitri Evers').labels).toEqual(['Family'])
    expect(byName(r, 'Chiara Dolan').labels).toEqual(['garden/soil'])
    expect(byName(r, 'Bruno Cesar').labels).toEqual(['garden'])
    expect(byName(r, 'Fabio Gruber').labels).toEqual([])
    expect(byName(r, 'Greta Hollis').labels).toEqual(['Notes'])
  })
  it('note: excerpt, aliases, who mentions them (title, alias or heading link; not themselves), source path', () => {
    const lines = byName(r, 'Alma Brandt').note.split('\n')
    expect(lines[0]).toBe('# Alma Cousin, lives in Graz. Plays cello. Birthday in May.')
    expect(lines).toContain('Also known as: Almi, A. Brandt')
    expect(lines).toContain('Mentioned in: Cello night, Seed swap')
    expect(lines.at(-1)).toBe('Source: People/Alma Brandt.md')
    expect(byName(r, 'Greta Hollis').note).toContain('Mentioned in: Autumn, Hugo Ivanov')
    expect(byName(r, 'Fabio Gruber').note).toContain('Mentioned in: 2026-11-01')
  })
  it('a person nobody links gets no Mentioned line', () => {
    expect(byName(buildContacts([parseNote('People/Solo.md', 'alone')]), 'Solo').note).toBe('alone\nSource: People/Solo.md')
  })
  it('long mention lists are cut with a count', () => {
    const many = [parseNote('People/Hub.md', 'x'), ...Array.from({ length: MENTIONS_SHOWN + 3 }, (_, i) => parseNote(`Days/d${String(i).padStart(2, '0')}.md`, '[[Hub]]'))]
    expect(byName(buildContacts(many), 'Hub').note).toMatch(new RegExp(`\\(\\+3\\)`))
  })
  it('same input -> same output', () => { expect(buildContacts(all())).toEqual(r) })
})

import { S } from '../../src/strings.ts'

describe('B18 the words written into the note come from strings.ts', () => {
  it('Also known as / Mentioned in / Source', () => {
    const r = buildContacts([parseNote('People/A.md', '---\naliases: [Al]\n---\nhi'), parseNote('Daily/d.md', '[[A]]')])
    const a = r.contacts.find((c) => c.name === 'A')
    expect(a.note.split('\n')).toEqual(['hi', `${S.obsidian.noteAlias}: Al`, `${S.obsidian.noteMentioned}: d`, `${S.obsidian.noteSource}: People/A.md`])
  })
})
