// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: which notes of a vault are people, and the contacts the Import pipeline reads from them (planServices -> Curate).
 * A person note sits under a People/Contacts-like folder, carries a person tag or says `type: person`. Notes that link to a person are
 * their mentions. Pure.
 */
import type { ImportedContact } from '../../../../crm/src/import/types'
import { ContactSource } from '../../../../crm/src/import/types'
import type { ParsedNote } from './obsidian_parse'

export const MENTIONS_SHOWN = 5
const PEOPLE_FOLDERS = new Set(['people', 'persons', 'person', 'personen', 'contacts', 'contact', 'kontakte', 'kontakt', 'leute', 'menschen'])
const TEMPLATE_FOLDERS = new Set(['templates', 'template', 'vorlagen', 'vorlage'])
const PERSON_TAGS = new Set(['person', 'people', 'contact', 'contacts', 'kontakt', 'kontakte'])
const PERSON_TYPES = new Set(['person', 'people', 'contact'])
const lower = (xs: readonly string[]): string[] => xs.map((x) => x.toLowerCase())

export function isPersonNote(n: ParsedNote): boolean {
  const folders = lower(n.folders)
  if (folders.some((f) => TEMPLATE_FOLDERS.has(f))) return false
  return folders.some((f) => PEOPLE_FOLDERS.has(f))
    || lower(n.tags).some((t) => PERSON_TAGS.has(t.split('/')[0]))
    || (n.type !== undefined && PERSON_TYPES.has(n.type))
}

/** Folder names and tags the owner sees as tags on the row; the markers that made the note a person are not among them. */
function labelsOf(n: ParsedNote): string[] {
  const folders = n.folders.filter((f) => !PEOPLE_FOLDERS.has(f.toLowerCase()) && !TEMPLATE_FOLDERS.has(f.toLowerCase()))
  const tags = n.tags.filter((t) => !PERSON_TAGS.has(t.toLowerCase()))
  return [...new Set([...folders, ...tags])]
}

export interface VaultContacts { contacts: ImportedContact[]; /** Notes read. */ notes: number }

export function buildContacts(notes: readonly ParsedNote[]): VaultContacts {
  const people = notes.filter(isPersonNote)
  // Who a link can mean: a person note's title, name or alias, any case.
  const target = new Map<string, ParsedNote>()
  for (const p of people) for (const k of [p.title, p.name, ...p.aliases]) if (!target.has(k.toLowerCase())) target.set(k.toLowerCase(), p)
  const mentions = new Map<string, Set<string>>()
  for (const n of notes) for (const l of n.links) {
    const p = target.get(l.toLowerCase())
    if (p && p !== n) (mentions.get(p.path) ?? mentions.set(p.path, new Set()).get(p.path)!).add(n.title)
  }
  const contacts = people.map((p): ImportedContact => {
    const said = [...(mentions.get(p.path) ?? [])].sort()
    const note = [
      p.excerpt,
      p.aliases.length ? `Also known as: ${p.aliases.join(', ')}` : '',
      said.length ? `Mentioned in: ${said.slice(0, MENTIONS_SHOWN).join(', ')}${said.length > MENTIONS_SHOWN ? ` (+${said.length - MENTIONS_SHOWN})` : ''}` : '',
      `Source: ${p.path}`,
    ].filter(Boolean).join('\n')
    return { source: ContactSource.Obsidian, file: p.path, sourceRef: p.path, name: p.name, phones: p.phones, emails: p.emails, labels: labelsOf(p), note, ...(p.org ? { org: p.org } : {}) }
  })
  return { contacts, notes: notes.length }
}
