// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-circles-view: a drop on a circle changes the person's tags (circles_model.ts dropEffect). Same stored tags as everywhere (card_small, tag_create); nothing new is stored. */
import type { ColourTag } from './colour_tags'
import type { DropEffect } from './circles_model'
import type { Person } from './model'
import { createTag, tagPerson, untagPerson } from './tag_create'

/** Applies the effect to the person; a new circle is defined from `newName`. Returns the tag list to save (same list when nothing was created) and the circle left or joined. */
export function applyDrop(p: Pick<Person, 'fields'>, effect: DropEffect, tags: readonly ColourTag[], newName: string): { tags: readonly ColourTag[]; added?: string; removed?: string } {
  if (effect.create) {
    const tag = createTag(tags, newName)
    tagPerson(p, tag.id)
    return { tags: [...tags, tag], added: tag.id }
  }
  if (effect.add) tagPerson(p, effect.add)
  if (effect.remove) untagPerson(p, effect.remove)
  return { tags, added: effect.add, removed: effect.remove }
}
