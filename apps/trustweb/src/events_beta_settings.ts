// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 mastodon-beta-events: Settings > Events > "Beta features" holds the Mastodon instance of each event I host
 * (moved from the event's Advanced box; the data stays ev.mastodonInstance, event_settings_set still sets it).
 */
import { el } from '../../demo/src/ui/dom'
import { applyEventSettings } from './event_press'
import { eventLabel, mayEdit } from './events'
import type { AppState, TwEvent } from './model'
import { S } from './strings'

/** The events whose Mastodon instance I may set (I host, organise or support them). */
export const betaEvents = (s: Pick<AppState, 'me' | 'people' | 'events'>): TwEvent[] => (s.events ?? []).filter((ev) => mayEdit(ev, s.me.displayName, s.people))

/** Stores the host (lower-case; empty clears) and returns what is in force; a bad host throws and keeps the old one. */
export function setEventMastodon(ev: TwEvent, value: string): string {
  applyEventSettings(ev, { mastodonInstance: value })
  return ev.mastodonInstance ?? ''
}

/** One input per event: a change saves when the field loses focus; a bad host shows a line and keeps the old one. */
export function eventsBetaRows(h: { state: () => AppState; save: () => void }): HTMLElement[] {
  const list = betaEvents(h.state())
  if (!list.length) return []
  const T = S.w45mastodon
  return [
    el('p', { class: 'meta', 'data-events-beta': '1' }, [T.hint]),
    ...list.map((ev) => {
      const input = el('input', { class: 'field src-opt', value: ev.mastodonInstance ?? '', placeholder: S.w43answers.mastodonPh, 'aria-label': `${T.label}: ${eventLabel(ev)}`, autocomplete: 'off', 'data-event-mastodon': ev.id }) as HTMLInputElement
      const bad = el('p', { class: 'warn', 'data-event-mastodon-bad': ev.id, hidden: true }, [S.w43answers.mastodonBad])
      input.addEventListener('change', () => {
        try { input.value = setEventMastodon(ev, input.value); bad.hidden = true; h.save() } catch { bad.hidden = false }
      })
      return el('div', { 'data-event-mastodon-row': ev.id }, [el('label', { class: 'meta' }, [eventLabel(ev)]), input, bad])
    }),
  ]
}
