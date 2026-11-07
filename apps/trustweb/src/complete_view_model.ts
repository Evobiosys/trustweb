// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 complete-view: the rows of the all-people table (one per person), their sort, filters, the render window and tags set on people. Owner-only, local. Pure, DOM-free. */
import type { AppState, Person } from './model'
import { tagsOf, type ColourTag } from './colour_tags'
import { zoneTagIds, tagNamed } from './zone_tags'
import { filterByChips } from './tag_filter'
import { ringShown } from './rings_filter'
import { WEB_RINGS, webSlot } from './rings_layout'
import { lastContact } from './people_list'
import { generalNoteOf } from './general_notes'
import { isOverdue, nextReminder } from './cadence'
import { deletePersonSoft, isDeleted, putBack } from './deleted_people'
import { isArchived } from './trustzones'
import { restoreSnapshot, snapshot } from './multi_select'
import { goneQuiet } from './keep_in_touch'
import type { Selection } from './multi_select'

export interface RowTag { id: string; label: string; /** A tag set on the person (can be removed here); false = inherited from their ring. */ own: boolean }

export interface CompleteRow {
  id: string
  name: string
  ring: Person['ring']
  ringRank: number
  last: number
  next?: number
  cadence?: number
  overdue: boolean
  tags: RowTag[]
  groups: string[]
  channels: string[]
  /** How many notes (lines, general, shared); never their text. */
  notes: number
  affil: string
}

export type SortKey = 'name' | 'ring' | 'last' | 'next' | 'cadence' | 'tags' | 'groups' | 'channels' | 'notes' | 'affil'
export interface Sort { key: SortKey; dir: 1 | -1 }
/** Most drifted contact first. */
export const DEFAULT_SORT: Sort = { key: 'last', dir: 1 }

export interface RowCtx { s: Pick<AppState, 'people'> & Partial<Pick<AppState, 'chats' | 'shareProfiles' | 'zoneTags' | 'uiRings'>>; tags: readonly ColourTag[]; now: number }
export interface RowOpts { query: string; overdueOnly: boolean; quietOnly?: boolean }

export const tagLabel = (t: ColourTag): string => t.label ?? t.id
const fold = (v: string): string => v.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
const AFFIL_KEYS = ['organization', 'company', 'org', 'job title', 'title']

function affiliation(p: Person): string {
  const f = AFFIL_KEYS.map((k) => p.fields?.[k]?.trim()).filter((v): v is string => !!v)
  return f.length ? [...new Set(f)].join(' · ') : p.context.split('\n')[0].trim()
}

/** The groups (share profiles) a person belongs to, by name: listed themselves or through one of their tags. */
export function groupsOf(s: Pick<AppState, 'shareProfiles'>, p: Pick<Person, 'id' | 'ring' | 'fields'>, tags: readonly ColourTag[]): string[] {
  const own = tagsOf(p, tags).map((t) => 'tag:' + t.id)
  return (s.shareProfiles ?? []).filter((g) => g.members.includes('person:' + p.id) || own.some((c) => g.members.includes(c))).map((g) => g.name)
}

export function completeRows(c: RowCtx, o: RowOpts): CompleteRow[] {
  const { s, tags, now } = c
  const ui = s.uiRings
  const shown = filterByChips(s.people.filter((p) => !isDeleted(p) && !isArchived(p) && ringShown({ uiRings: ui }, webSlot(p))), tags, ui?.show ?? [], ui?.hide ?? [])
  const q = fold(o.query.trim())
  const rows = shown.map((p): CompleteRow => {
    const last = lastContact(s, p)
    const slot = webSlot(p)
    const own = tagsOf(p, tags)
    const inherited = zoneTagIds({ zoneTags: s.zoneTags }, slot).flatMap((id) => tags.filter((t) => t.id === id && !own.includes(t)))
    return {
      id: p.id, name: p.name, ring: slot, ringRank: WEB_RINGS.indexOf(slot), last,
      next: nextReminder(p, last, now), cadence: p.cadenceDays, overdue: isOverdue(p, last, now),
      tags: [...own.map((t) => ({ id: t.id, label: tagLabel(t), own: true })), ...inherited.map((t) => ({ id: t.id, label: tagLabel(t), own: false }))],
      groups: groupsOf(s, p, tags),
      channels: Object.entries(p.channels ?? {}).filter(([, v]) => v).map(([k]) => k),
      notes: p.lines.length + (generalNoteOf(p) ? 1 : 0) + (p.sharedNotes?.length ?? 0),
      affil: affiliation(p),
    }
  })
  const quiet = o.quietOnly ? new Set(goneQuiet(s, now).map((p) => p.id)) : null
  return rows.filter((r) => (!o.overdueOnly || r.overdue) && (!quiet || quiet.has(r.id)) && (!q || fold([r.name, r.affil, ...r.tags.map((t) => t.label)].join(' ')).includes(q) || fold(s.people.find((p) => p.id === r.id)?.context ?? '').includes(q)))
}

const text = (r: CompleteRow, key: SortKey): string => (key === 'name' ? r.name : key === 'affil' ? r.affil : (key === 'tags' ? r.tags.map((t) => t.label) : key === 'groups' ? r.groups : r.channels).join(', '))
const num = (r: CompleteRow, key: SortKey): number | undefined => (key === 'ring' ? r.ringRank : key === 'last' ? r.last : key === 'next' ? r.next : key === 'cadence' ? r.cadence : key === 'notes' ? r.notes : undefined)

/** Sorted copy; rows without a value (no cadence, no tags) come last in both directions, ties by name. */
export function sortRows(rows: readonly CompleteRow[], { key, dir }: Sort): CompleteRow[] {
  const byName = (a: CompleteRow, b: CompleteRow): number => a.name.localeCompare(b.name)
  return [...rows].sort((a, b) => {
    const x = num(a, key)
    const y = num(b, key)
    if (x !== undefined || y !== undefined || key === 'ring' || key === 'last') {
      if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1
      return (x - y) * dir || byName(a, b)
    }
    const s = text(a, key)
    const t = text(b, key)
    if (!s || !t) return !s && !t ? byName(a, b) : !s ? 1 : -1
    return s.localeCompare(t) * dir || byName(a, b)
  })
}

export const toggleSort = (cur: Sort, key: SortKey): Sort => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: 1 })

/** The slice of a long list to draw: the rows in view plus `overscan` above and below, clamped to the list. */
export function visibleWindow(scrollTop: number, rowH: number, viewH: number, total: number, overscan: number): { start: number; end: number } {
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, total * rowH - viewH))
  return { start: Math.max(0, Math.floor(top / rowH) - overscan), end: Math.min(total, Math.ceil((top + viewH) / rowH) + overscan) }
}

export function setPersonTag(p: Person, id: string, on: boolean): void {
  if (on) p.fields = { ...p.fields, [id]: 'true' }
  else if (p.fields) { const { [id]: _gone, ...rest } = p.fields; p.fields = rest }
}

/** Tags the selected people (an unknown name defines a new tag); returns the full tag list to save and the undo. */
export function addTagToPeople(people: readonly Person[], ids: Selection, tags: readonly ColourTag[], name: string): { tags: readonly ColourTag[]; undo: () => void } {
  const { tags: list, tag } = tagNamed(tags, name)
  if (!tag) return { tags, undo: () => undefined }
  const hit = people.filter((p) => ids.has(p.id) && String(p.fields?.[tag.id]) !== 'true')
  for (const p of hit) setPersonTag(p, tag.id, true)
  return { tags: list, undo: () => { for (const p of hit) setPersonTag(p, tag.id, false) } }
}

/** Deletes the selected people (30 days, deleted_people.ts); the undo puts each back exactly: ring and remembered ring as before. */
export function deletePeople(people: Person[], ids: Selection, now: number): () => void {
  const snaps = snapshot(people, ids)
  const hit = people.filter((p) => ids.has(p.id))
  for (const p of hit) deletePersonSoft(p, now)
  return () => { for (const p of hit) putBack(p); restoreSnapshot(people, snaps) }
}
