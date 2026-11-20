// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 event-bubble: while event mode is on (event_filter_mode.ts), the Web is the event's bubble, only the people connected with it.
 * The chip "Everyone" lifts that for the Web (Chat, Resources and Ask stay narrowed); leaving event mode, or another event, ends the lift.
 * Settings > Events "Event mode narrows the Web" (`eventBubbleOff` in the record) switches the auto-bubble off. Pure.
 */
import type { AppState } from './model'

type Bub = Pick<AppState, 'uiRings' | 'eventBubbleOff'>

export const bubbleOn = (s: Bub): boolean => !!s.uiRings?.eventMode && !s.eventBubbleOff && !s.uiRings.eventEveryone

/** Lift (true) or restore (false) the Web bubble. True when it changed; nothing to lift outside event mode. */
export function setEveryone(s: Pick<AppState, 'uiRings'>, on: boolean): boolean {
  if (!s.uiRings?.eventMode || (s.uiRings.eventEveryone === true) === on) return false
  const ui = { ...s.uiRings }
  if (on) ui.eventEveryone = true; else delete ui.eventEveryone
  s.uiRings = ui
  return true
}
