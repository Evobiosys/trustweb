// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c event-autosave (Jakob, answer zeta: "only once the person has accepted it should be revealed"): the conference link of an event stays
 * out of its link, QR and invite (event_link.ts carries only `conf: true`, read as confHidden). A guest's "I will attend" sends the hosts an rsvp;
 * the host's device answers with the links, sealed (event_envelope.ts). Pure, plus the one line under Location on the event page.
 */
import { el } from '../../demo/src/ui/dom'
import { isEventHost } from './event_roles'
import type { ConferenceLink } from './event_draft'
import type { AppState, TwEvent } from './model'
import { S } from './strings'

/** What the event page shows under Location: the links, "Revealed once you accept", "asked the host", or nothing (no conference). */
export function conferenceState(ev: Pick<TwEvent, 'conference' | 'confHidden' | 'attended'>): { links: ConferenceLink[] } | 'hidden' | 'asked' | null {
  if (ev.conference?.length) return { links: ev.conference }
  if (!ev.confHidden) return null
  return ev.attended ? 'asked' : 'hidden'
}

/** A sender is a host of the event as the event names them (never the "an event I made alone" fallback of isEventHost). */
export const namedHost = (ev: TwEvent, name: string, people: AppState['people']): boolean => isEventHost({ ...ev, fromLink: true }, name, people)

/** The guest switched "I will attend": a decline hides the link again. True when the hosts are to hear the answer (not my own event). */
export function attendChanged(s: Pick<AppState, 'me' | 'people'>, ev: TwEvent): boolean {
  if (isEventHost(ev, s.me.displayName, s.people)) return false
  if (!ev.attended) delete ev.conference
  return !!ev.confHidden || !!ev.conference?.length
}

export function conferenceLine(ev: TwEvent): HTMLElement | null {
  const c = conferenceState(ev)
  if (!c) return null
  if (typeof c === 'string') return el('p', { class: 'meta', 'data-event-conference': c }, [c === 'hidden' ? S.evConf44c.hidden : S.evConf44c.asked])
  return el('p', { class: 'chips', 'data-event-conference': 'links' }, c.links.map((l) => el('a', { class: 'chip', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, [S.ev44.providers[l.provider]])))
}
