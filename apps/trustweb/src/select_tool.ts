// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b: the select tool of the Web (and People): undo windows, who a drag moves, where the trust-zone filter shows, the owner dot's initial. Pure, DOM-free. */
import type { Selection } from './multi_select'

export const UNDO_SINGLE_MS = 5000
export const UNDO_MULTI_MS = 10000

/** Undo window of an action on `n` people: 5 s for one, 10 s for several. */
export const undoMs = (n: number): number => (n > 1 ? UNDO_MULTI_MS : UNDO_SINGLE_MS)

/** The trust-zone (ring) filter lives only on Network and Map. */
export const ringFilterShown = (view: string): boolean => view === 'network' || view === 'map'

/** The ids a drag moves: every selected dot when the dragged one is selected, else just it. */
export const dragIds = (sel: Selection, draggedId: string): string[] => (sel.has(draggedId) ? [...sel] : [draggedId])

/** The first letter of the owner's name, upper case; `?` for an empty name. */
export const ownInitial = (name: string): string => (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase()
