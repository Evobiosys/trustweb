// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32: the Web sidebar's filter groups. Pure, no DOM: a group (TrustZones) folds, open by default; "connected" is a plain two-state checkbox. */
import type { AppState } from './model'

type UiState = Partial<Pick<AppState, 'uiRings'>>

export type FilterGroup = 'trustzones'

export const groupOpen = (s: UiState, g: FilterGroup): boolean => !(s.uiRings?.closedGroups ?? []).includes(g)

export function setGroupOpen(s: UiState, g: FilterGroup, open: boolean): void {
  const rest = (s.uiRings?.closedGroups ?? []).filter((x) => x !== g)
  s.uiRings = { ...s.uiRings, closedGroups: open ? rest : [...rest, g] }
}

/** Checked = only people connected with me; anything but `true` (incl. a legacy third state) is unchecked. */
export const connectionsOn = (s: UiState): boolean => s.uiRings?.connections === true
