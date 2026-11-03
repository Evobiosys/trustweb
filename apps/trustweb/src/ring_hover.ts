// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29: the "Everyone in <ring>" card opens on hover (handle or ring band), stays while the pointer crosses into it, closes after a grace. Pure, DOM-free. */
import type { Ring } from './model'
import { renamedTo } from './card_name'

/** How long the card stays once the pointer left handle, band and card (time to cross the gap). */
export const GRACE_MS = 250

export interface HoverState {
  /** The ring whose card is shown. */
  open: Ring | null
  /** True from a leave until the grace ends or the pointer is back on handle, band or card. */
  grace: boolean
}

export type HoverEvent =
  | { type: 'enter-handle' | 'enter-ring'; ring: Ring }
  | { type: 'enter-card' | 'leave' | 'grace-end' | 'esc' }

export const HOVER_IDLE: HoverState = { open: null, grace: false }

export function hoverStep(s: HoverState, e: HoverEvent): HoverState {
  switch (e.type) {
    case 'enter-handle': case 'enter-ring': return { open: e.ring, grace: false }
    case 'enter-card': return { open: s.open, grace: false }
    case 'leave': return s.open ? { open: s.open, grace: true } : s
    case 'grace-end': return s.grace ? HOVER_IDLE : s
    case 'esc': return HOVER_IDLE
  }
}

export type NameEdit = { kind: 'commit'; name: string } | { kind: 'cancel' }

/** What ends an inline name edit: Enter or blur ('save') commits a changed, non-empty name; Esc ('cancel'), empty or unchanged keeps the old one. */
export function nameEdit(current: string, typed: string, how: 'save' | 'cancel'): NameEdit {
  const name = how === 'save' ? renamedTo(current, typed) : null
  return name === null ? { kind: 'cancel' } : { kind: 'commit', name }
}
