// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 34: while a dot is held, an archive box and a dustbin wait at the bottom of the rings. Pure decisions; web_view.ts draws them. */
import { overControl } from './expanse'

export type BinKind = 'archive' | 'remove'

/** What a drop on a bin does. Remove never deletes by itself: it asks first. */
export const binDrop = (kind: BinKind, p: { id: string }): { do: 'archive' | 'ask-remove'; id: string } => ({ do: kind === 'archive' ? 'archive' : 'ask-remove', id: p.id })

/** The bin under a pointer at (x, y), or null. */
export const binAt = (boxes: readonly { kind: BinKind; left: number; top: number; right: number; bottom: number }[], x: number, y: number): BinKind | null =>
  boxes.find((b) => overControl(b, x, y))?.kind ?? null
