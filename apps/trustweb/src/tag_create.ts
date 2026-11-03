// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29 filters-create: typing "@Name" or "#tag" in the filter box that does not exist yet offers to create it; a tag then takes people in a row. Pure. */
import { addTagTo } from './card_small'
import type { ColourTag } from './colour_tags'
import { Ring } from './model'
import type { Person } from './model'
import { suggest } from './share_page'
import type { Candidate } from './share_page'

export type CreateRow = { create: 'person' | 'tag'; name: string }
export type SuggestRow = Candidate | CreateRow

const PALETTE = ['#2e7d32', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457', '#4e342e']

/** `suggest` plus a last "Create ..." row when an @name or #tag was typed that no existing person or tag carries exactly. */
export function suggestOrCreate(query: string, all: readonly Candidate[], taken: readonly string[]): SuggestRow[] {
  const hits: SuggestRow[] = suggest(query, all, taken)
  const q = query.trim()
  const kind = q.startsWith('@') ? 'person' : q.startsWith('#') ? 'tag' : null
  const name = q.slice(1).trim()
  if (!kind || !name) return hits
  const exact = all.some((c) => c.id.startsWith(kind + ':') && c.label.toLowerCase() === name.toLowerCase())
  return exact ? hits : [...hits, { create: kind, name }]
}

/** The usual add path: a new person, Not yet sorted. */
export function createPerson(people: Person[], name: string, id: string, now: number): Person {
  const p: Person = { id, name: name.trim().slice(0, 40), context: '', ring: Ring.Unsorted, metAt: now, lines: [] }
  people.push(p)
  return p
}

/** A new tag definition (the caller stores it): id from the label, unique among `tags`; the next palette colour. */
export function createTag(tags: readonly ColourTag[], label: string): ColourTag {
  const base = label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'tag'
  let id = base
  for (let n = 2; tags.some((t) => t.id === id); n++) id = `${base}-${n}`
  return { id, colour: PALETTE[tags.length % PALETTE.length], label: label.trim() }
}

export const tagPerson = (p: Pick<Person, 'fields'>, tagId: string): void => addTagTo(p, tagId)

export function untagPerson(p: Pick<Person, 'fields'>, tagId: string): void {
  const { [tagId]: _gone, ...rest } = p.fields ?? {}
  p.fields = rest
}
