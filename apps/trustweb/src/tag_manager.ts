// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 (group-tags): the edits of Settings > Your web > Tags, on the stored colour tags. Each returns a new list (the caller saves it); a refused edit throws (tags_model.ts addParent: "cycle"). Pure. */
import type { ColourTag } from './colour_tags'
import { createTag } from './tag_create'
import { addParent, childrenOf, forkInto, removeParent, setKind, toTag, type Tag } from './tags_model'

/** Writes the model's fields back onto the stored tags (colour and flags stay); a new id (a fork) takes the colour of its source. */
function merge(old: readonly ColourTag[], next: readonly Tag[]): ColourTag[] {
  return next.map((t) => {
    const was = old.find((o) => o.id === t.id) ?? old.find((o) => o.id === t.forkedFrom)
    const { kind, parents, excludes, stewardIds, forkedFrom, ...rest } = was ?? { id: t.id, colour: '#9e9e9e' }
    void kind; void parents; void excludes; void stewardIds; void forkedFrom
    return {
      ...rest, id: t.id, label: t.name,
      ...(t.kind !== 'personal' ? { kind: t.kind } : {}), ...(t.parents.length ? { parents: t.parents } : {}), ...(t.excludes.length ? { excludes: t.excludes } : {}),
      ...(t.stewardIds.length ? { stewardIds: t.stewardIds } : {}), ...(t.forkedFrom ? { forkedFrom: t.forkedFrom } : {}),
    }
  })
}

const edit = (tags: readonly ColourTag[], fn: (all: Tag[]) => Tag[]): ColourTag[] => merge(tags, fn(tags.map(toTag)))
const change = (all: Tag[], id: string, fn: (t: Tag) => Tag): Tag[] => all.map((t) => (t.id === id ? fn(t) : t))

export const createGroup = (tags: readonly ColourTag[], name: string): ColourTag[] => [...tags, { ...createTag(tags, name), kind: 'group' }]

export const addChild = (tags: readonly ColourTag[], groupId: string, childId: string): ColourTag[] => edit(tags, (all) => addParent(all, childId, groupId))
export const removeChild = (tags: readonly ColourTag[], groupId: string, childId: string): ColourTag[] => edit(tags, (all) => removeParent(all, childId, groupId))

const toggle = (l: readonly string[], x: string): string[] => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x])
export const toggleExclude = (tags: readonly ColourTag[], id: string, personId: string): ColourTag[] => edit(tags, (all) => change(all, id, (t) => ({ ...t, excludes: toggle(t.excludes, personId) })))
export const toggleSteward = (tags: readonly ColourTag[], id: string, personId: string): ColourTag[] => edit(tags, (all) => change(all, id, (t) => ({ ...t, stewardIds: toggle(t.stewardIds, personId) })))

/** Managed on; off goes back to a group when the tag has children, else to a personal tag. */
export const setManaged = (tags: readonly ColourTag[], id: string, on: boolean): ColourTag[] =>
  edit(tags, (all) => change(all, id, (t) => setKind(t, on ? 'managed' : childrenOf(all, id).length ? 'group' : 'personal')))

/** A copy the user owns (fresh id from the name, the same children). */
export const forkTag = (tags: readonly ColourTag[], id: string): ColourTag[] => {
  const label = tags.find((t) => t.id === id)?.label ?? id
  return edit(tags, (all) => forkInto(all, id, createTag(tags, label).id))
}
