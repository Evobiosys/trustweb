// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-mode-visible: event mode (event_filter_mode.ts) must be seen. While it is on, `body[data-tw-event-mode]` carries the event id and
 * `--event-mode-colour` the event's colour: styles.css tints the header and the bottom bar with it, and a note chip sits in the header.
 * Mode off = both removed, the app looks normal.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { eventColour } from './event_cluster'
import { eventFilterOf, eventModePill } from './event_filter_mode'
import { eventTagSlug } from './event_tag'
import { tagLabel } from './events'

type LookState = Pick<AppState, 'uiRings'> & { events?: AppState['events'] }
interface BodyLike { dataset: Record<string, string | undefined>; style: { setProperty: (k: string, v: string) => void; removeProperty: (k: string) => unknown } }

/** Colour and label of the running event mode; null when off or its event is gone. */
export function eventModeLook(s: LookState): { colour: string; label: string } | null {
  const label = eventModePill(s)
  const ev = s.events?.find((e) => e.id === eventFilterOf(s))
  return label && ev ? { colour: eventColour(eventTagSlug(tagLabel(ev))), label } : null
}

export function applyEventModeLook(body: BodyLike, s: LookState): void {
  const look = eventModeLook(s)
  if (look) { body.dataset.twEventMode = eventFilterOf(s) ?? ''; body.style.setProperty('--event-mode-colour', look.colour) }
  else { delete body.dataset.twEventMode; body.style.removeProperty('--event-mode-colour') }
}

/** The mode note chip, top left of the screen's header (the first `.hdr-left`); idempotent. */
export function mountEventModeNote(host: HTMLElement, s: LookState): void {
  host.querySelector('[data-event-mode-header-note]')?.remove()
  const look = eventModeLook(s)
  host.querySelector('.hdr-left')?.append(...(look ? [el('span', { class: 'chip on event-mode-pill ev-mode-note', 'data-event-mode-header-note': '' }, [look.label])] : []))
}
