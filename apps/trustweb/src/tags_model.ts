// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 (group-tags): tags nest many-to-many. A tag lists its `parents`; a group holds the union of its children (and its own holders) minus `excludes`. Pure, no DOM, nothing stored here (colour_tags.ts keeps the list). */

export type TagKind = 'personal' | 'group' | 'managed' | 'event'
export const TAG_KINDS: readonly TagKind[] = ['personal', 'group', 'managed', 'event']

export interface Tag {
  id: string
  name: string
  kind: TagKind
  parents: string[]
  /** Person ids kept out of this tag's resolved members, whatever the children hold. */
  excludes: string[]
  /** Organisers who steward who is in a managed tag. */
  stewardIds: string[]
  forkedFrom?: string
}

/** The shape colour_tags.ts stores: the old fields plus the optional new ones. */
export interface TagLike { id: string; label?: string; kind?: TagKind; parents?: string[]; excludes?: string[]; stewardIds?: string[]; forkedFrom?: string }

export const toTag = (t: TagLike): Tag => ({
  id: t.id, name: t.label ?? t.id, kind: t.kind ?? 'personal', parents: t.parents ?? [], excludes: t.excludes ?? [], stewardIds: t.stewardIds ?? [],
  ...(t.forkedFrom ? { forkedFrom: t.forkedFrom } : {}),
})

/** Group, managed and event tags get the ring; personal ones are plain pills. */
export const isRinged = (t: Pick<Tag, 'kind'>): boolean => t.kind !== 'personal'

export const childrenOf = (tags: readonly Tag[], id: string): Tag[] => tags.filter((t) => t.parents.includes(id))

/** Would `childId` under `parentId` close a loop? (the parent is the child itself, or already below it) */
function wouldCycle(tags: readonly Tag[], childId: string, parentId: string): boolean {
  const seen = new Set<string>()
  const below = (id: string): boolean => {
    if (id === parentId) return true
    if (seen.has(id)) return false
    seen.add(id)
    return childrenOf(tags, id).some((c) => below(c.id))
  }
  return below(childId)
}

/** A new list in which `childId` also sits under `parentId`; throws on an unknown tag or a cycle. */
export function addParent(tags: readonly Tag[], childId: string, parentId: string): Tag[] {
  if (!tags.some((t) => t.id === childId) || !tags.some((t) => t.id === parentId)) throw new Error('unknown tag')
  if (wouldCycle(tags, childId, parentId)) throw new Error('cycle')
  return tags.map((t) => (t.id === childId && !t.parents.includes(parentId) ? { ...t, parents: [...t.parents, parentId] } : t))
}

export const removeParent = (tags: readonly Tag[], childId: string, parentId: string): Tag[] =>
  tags.map((t) => (t.id === childId ? { ...t, parents: t.parents.filter((p) => p !== parentId) } : t))

/** Person ids in the tag: its own holders plus every child's members, minus the tag's excludes. `direct(tagId)` = the people holding that tag itself. A loop already in the data is cut where it closes. */
export function resolveMembers(tag: Tag, tags: readonly Tag[], direct: (tagId: string) => readonly string[]): string[] {
  const walk = (t: Tag, path: ReadonlySet<string>): Set<string> => {
    const out = new Set(direct(t.id))
    const next = new Set(path).add(t.id)
    for (const c of childrenOf(tags, t.id)) if (!next.has(c.id)) for (const id of walk(c, next)) out.add(id)
    for (const id of t.excludes) out.delete(id)
    return out
  }
  return [...walk(tag, new Set())]
}

/** A copy for the user to own: fresh id, no parents (it does not join the source's groups), stewards dropped and a managed tag turned personal. */
export function fork(tag: Tag, id: string, name?: string): Tag {
  return { ...tag, id, name: name ?? tag.name, kind: tag.kind === 'managed' ? 'personal' : tag.kind, parents: [], excludes: [...tag.excludes], stewardIds: [], forkedFrom: tag.id }
}

/** The list with a fork of `id` added; the fork is parent of the same children, the source keeps them too. */
export function forkInto(tags: readonly Tag[], id: string, newId: string, name?: string): Tag[] {
  const src = tags.find((t) => t.id === id)
  if (!src) throw new Error('unknown tag')
  const kids = new Set(childrenOf(tags, id).map((c) => c.id))
  return [...tags.map((t) => (kids.has(t.id) ? { ...t, parents: [...t.parents, newId] } : t)), fork(src, newId, name)]
}

/** Stewards only make sense on a managed tag. */
export const setKind = (tag: Tag, kind: TagKind): Tag => ({ ...tag, kind, stewardIds: kind === 'managed' ? tag.stewardIds : [] })
