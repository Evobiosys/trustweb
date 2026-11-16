// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 (U9): the tag/person chips that are switched on (s.uiRings.show / hide), as rows the Filter (advanced) panel can list and switch off. Pure. */
import type { ColourTag } from './colour_tags'
import type { AppState, Person, TwEvent } from './model'
import { eventTagLabel, tagLabel } from './events'
import { closestLimit, LIMIT_DEFAULT } from './membranes_five'
import { S } from './strings'

export interface ActiveFilter { chip: string; label: string }

export function activeFilters(ui: { show?: string[]; hide?: string[]; closest150?: boolean; closestN?: number; perRingLimitOff?: boolean; rankBy?: string } | undefined, tags: readonly ColourTag[], people: readonly Pick<Person, 'id' | 'name'>[], perRing: number = LIMIT_DEFAULT, events: readonly Pick<TwEvent, 'id' | 'name' | 'tagName'>[] = []): ActiveFilter[] {
  const name = (chip: string): string => {
    if (chip.startsWith('person:')) return '@' + (people.find((p) => p.id === chip.slice(7))?.name ?? chip.slice(7))
    if (chip.startsWith('event:')) { const ev = events.find((e) => e.id === chip.slice(6)); return eventTagLabel(ev ? tagLabel(ev) : chip.slice(6)) }   // wave 43
    return '#' + (tags.find((t) => t.id === chip.slice(4))?.label ?? chip.slice(4))
  }
  return [
    ...(ui?.show ?? []).map((chip) => ({ chip, label: S.tagFilterOn(name(chip)) })),
    ...(ui?.hide ?? []).map((chip) => ({ chip, label: S.filterHidden(name(chip)) })),
    ...(ui?.closest150 ? [{ chip: 'closest150', label: S.closestActive(closestLimit(ui)) }] : []),
    ...(!ui?.perRingLimitOff && ui?.rankBy === 'frequent' ? [{ chip: 'perRing', label: S.perRingFrequentActive(perRing) }]
      : !ui?.perRingLimitOff && perRing !== LIMIT_DEFAULT ? [{ chip: 'perRing', label: S.perRingActive(perRing) }] : []),
  ]
}

/** Appended to the folded "Filter (advanced)" label so a filter never stays on silently. */
export const activeCountLabel = (n: number): string => (n ? S.filterActiveCount(n) : '')

/** Switches filters off: every chip `keep` rejects goes, as do the closest-n and per-ring cuts when `keep` rejects them. `() => false` = clear all. Wave 43: shared by the filter list and the badge. */
export function dropFilters(s: Pick<AppState, 'uiRings' | 'membraneLimit'>, keep: (chip: string) => boolean): void {
  s.uiRings = { ...s.uiRings, show: (s.uiRings?.show ?? []).filter(keep), hide: (s.uiRings?.hide ?? []).filter(keep) }
  if (!keep('closest150')) s.uiRings.closest150 = false
  if (!keep('perRing')) { delete s.membraneLimit; s.uiRings.rankBy = undefined }
}
