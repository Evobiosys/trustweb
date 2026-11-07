// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 (U9): the tag/person chips that are switched on (s.uiRings.show / hide), as rows the Filter (advanced) panel can list and switch off. Pure. */
import type { ColourTag } from './colour_tags'
import type { Person } from './model'
import { S } from './strings'

export interface ActiveFilter { chip: string; label: string }

export function activeFilters(ui: { show?: string[]; hide?: string[]; closest150?: boolean } | undefined, tags: readonly ColourTag[], people: readonly Pick<Person, 'id' | 'name'>[]): ActiveFilter[] {
  const name = (chip: string): string => chip.startsWith('person:')
    ? '@' + (people.find((p) => p.id === chip.slice(7))?.name ?? chip.slice(7))
    : '#' + (tags.find((t) => t.id === chip.slice(4))?.label ?? chip.slice(4))
  return [
    ...(ui?.show ?? []).map((chip) => ({ chip, label: S.tagFilterOn(name(chip)) })),
    ...(ui?.hide ?? []).map((chip) => ({ chip, label: S.filterHidden(name(chip)) })),
    ...(ui?.closest150 ? [{ chip: 'closest150', label: S.closest150Active }] : []),
  ]
}

/** Appended to the folded "Filter (advanced)" label so a filter never stays on silently. */
export const activeCountLabel = (n: number): string => (n ? S.filterActiveCount(n) : '')
