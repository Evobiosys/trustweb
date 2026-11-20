// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 4, Jakob's Tana memo "Improve community event sharing and participant visibility"): the top of the event page, a little more
 * inviting: the mode note "Community view: <community>" (top left, like the Web's event-mode note), a cover in the event's colour with the first
 * sentence of the description and the share controls, "Hosted by", "by <community>" (opens that community), who joins, the community's members for
 * an intimate community, "Message everyone" and "Resources of <event>". Plus the share audience of a community event (joiners become community
 * members, or Choose later). Rules: event_community.ts.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState, Person, TwEvent } from './model'
import { eventColour } from './event_cluster'
import { eventTagLabel, eventTagSlug } from './event_tag'
import { tagLabel } from './events'
import { communityOfEvent } from './event_visibility'
import { communityRowOf, firstSentence, hostedBy, joiningOf, setShareAudience, shareAudienceOf, type ShareAudience } from './event_community'
import { S } from './strings'

export interface EventTopHooks {
  state: () => AppState
  save: () => void
  redraw: () => void
  /** The share icons (link, QR) as the page's share row draws them; here a second time at the top. */
  shareIcons: (ev: TwEvent) => HTMLElement
  communityName?: (tag: string) => string
  openCommunity?: (tag: string) => void
  messageAll?: (ev: TwEvent) => void
  /** wave45 bulk-invite-filter: the Invite many sheet; absent when I may not invite. */
  inviteMany?: (ev: TwEvent) => void
  eventResources?: (ev: TwEvent) => void
  openPerson?: (id: string) => void
}

const chipsOf = (people: readonly Person[], attr: string, open?: (id: string) => void): HTMLElement =>
  el('div', { class: 'chips ev-who', [attr]: '' }, people.map((p) => el('button', { type: 'button', class: 'chip', 'data-person-chip': p.id, onclick: () => open?.(p.id) }, [p.name])))

/** The mode note in the top left: this event belongs to a community, so the page is in the Community view. Null for a personal event. */
export function communityNote(ev: TwEvent, name: (tag: string) => string): HTMLElement | null {
  const tag = communityOfEvent(ev)
  return tag ? el('span', { class: 'chip on event-mode-pill ev-mode-note', 'data-event-mode-note': tag }, [S.a44d.communityView(name(tag))]) : null
}

export function eventTop(ev: TwEvent, h: EventTopHooks): (Node | null)[] {
  const s = h.state()
  const tag = communityOfEvent(ev)
  const name = (t: string): string => h.communityName?.(t) ?? t
  const hosts = hostedBy(ev)
  const joining = joiningOf(s, ev)
  const members = communityRowOf(s, ev)
  const line = firstSentence(ev.docs?.description ?? ev.conditions ?? '')
  const colour = eventColour(eventTagSlug(tagLabel(ev)))
  return [
    communityNote(ev, name),
    el('div', { class: 'ev-cover', 'data-event-cover': colour, style: `border-left:6px solid ${colour};background:color-mix(in srgb, ${colour} 12%, transparent)` }, [
      line ? el('p', { class: 'ev-what', 'data-event-what': '' }, [line]) : null,
      h.shareIcons(ev),
    ]),
    hosts.length ? el('p', { class: 'meta', 'data-event-hosted-by': '' }, [S.a44d.hostedBy(hosts.join(', '))]) : null,
    tag ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm ev-by-community', 'data-event-by-community': tag, onclick: () => h.openCommunity?.(tag) }, [el('u', {}, [S.a44d.byCommunity(name(tag))])]) : null,
    el('div', { class: 'ev-joining', 'data-event-joining': String(joining.length) }, [
      el('b', {}, [S.a44d.joining(joining.length)]),
      joining.length ? chipsOf(joining, 'data-event-joining-list', h.openPerson) : el('span', { class: 'meta' }, [` ${S.a44d.nobodyYet}`]),
    ]),
    members.length ? el('div', { class: 'ev-joining', 'data-event-community-members': String(members.length) }, [el('b', {}, [S.a44d.communityRow]), chipsOf(members, 'data-event-community-list', h.openPerson)]) : null,
    el('div', { class: 'chips' }, [
      h.messageAll ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-event-message-all': '', onclick: () => h.messageAll?.(ev) }, [el('u', {}, [S.a44d.messageAll])]) : null,
      h.inviteMany ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-event-invite-many': '', onclick: () => h.inviteMany?.(ev) }, [el('u', {}, [S.bulkInvite.open])]) : null,
      h.eventResources ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-event-resources': '', onclick: () => h.eventResources?.(ev) }, [el('u', {}, [S.a44d.resourcesOf(eventTagLabel(tagLabel(ev)))])]) : null,
    ]),
  ]
}

/** A community event's share audience: "Joiners become community members" (default) or "Choose later". Null for a personal event. */
export function shareAudienceRow(ev: TwEvent, h: Pick<EventTopHooks, 'save' | 'redraw'>): HTMLElement | null {
  const cur = shareAudienceOf(ev)
  if (!cur) return null
  const opt = (a: ShareAudience): HTMLElement => el('button', {
    type: 'button', class: a === cur ? 'on' : '', 'aria-pressed': String(a === cur), 'data-event-share-aud': a,
    onclick: () => { if (a !== cur) { setShareAudience(ev, a); h.save(); h.redraw() } },
  }, [S.a44d.audience[a]])
  return el('div', { class: 'afv-row', 'data-event-share-audience': cur }, [
    el('small', { class: 'meta' }, [S.a44d.audienceLabel]),
    el('div', { class: 'seg', role: 'group', 'aria-label': S.a44d.audienceLabel }, [opt('community'), opt('later')]),
  ])
}
