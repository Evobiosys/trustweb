// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29: the ring filter of the TrustZones view. Pure, no DOM: one checkbox per trust ring, all shown by default; the unchecked ones save in `uiRings.hidden`. */
import { Ring } from './model'
import type { AppState } from './model'

type UiState = Partial<Pick<AppState, 'uiRings'>>

/** The ladder from the centre out: one filter checkbox each. */
export const FILTER_RINGS: readonly Ring[] = [Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted]

/** The hidden rings; before `hidden` was ever saved, the two old checkboxes (acquaintances, unsorted) decide. */
const hiddenRings = (s: UiState): readonly Ring[] => s.uiRings?.hidden ?? [...(s.uiRings?.acquaintances === false ? [Ring.Acquaintance] : []), ...(s.uiRings?.unsorted === false ? [Ring.Unsorted] : [])]

export const ringShown = (s: UiState, ring: Ring): boolean => !hiddenRings(s).includes(ring)

export function setRingShown(s: UiState, ring: Ring, shown: boolean): void {
  const rest = hiddenRings(s).filter((r) => r !== ring)
  s.uiRings = { ...s.uiRings, hidden: shown ? rest : [...rest, ring] }
}
