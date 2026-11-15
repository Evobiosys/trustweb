// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 review fixes: roles held as person ids count for host / invite checks, one slug everywhere, open decisions as one constant each. */
import { Ring } from '../../src/model.ts'
import { isEventHost, mayInvite, newEvent, revealedBy } from '../../src/events.ts'
import { EVENT_SLUG_CASE, eventTagSlug } from '../../src/event_tag.ts'
import { EVENT_SLUG_CASE as FEED_SLUG_CASE, tagOfEvent } from '../../src/feed_social.ts'
import { eventOrganizers, migrateEventRoles } from '../../src/event_roles.ts'
import { NEW_FROM_EVENT_RING, pickOnEnter } from '../../src/event_person_picker.ts'
import { DEFAULT_INVITE_POLICY, EVENT_OFFERS_DEFAULT, NICK_FALLBACK, offersOf } from '../../src/event_press.ts'
import { BADGE_PRESS } from '../../src/web_focus.ts'
import { SYNC_PHONE_PLACEMENT, syncPlacement } from '../../src/sync_capability.ts'

const NOW = 1_700_000_000_000
const person = (id, name, ring = Ring.Friend) => ({ id, name, context: '', ring, metAt: NOW, lines: [] })
const ev = (extra = {}) => ({ ...newEvent({ name: 'Winter IYG', from: '2026-11-15T09:30', where: 'Wien' }, 'e1', NOW), ...extra })
const state = (people = [], me = 'Mia Probe') => ({ me: { id: 'me', displayName: me }, people })

describe('host and invite checks read roles held as person ids', () => {
  it('a host or tech support added through the picker (a person id) is resolved to the name', () => {
    const s = state([person('p1', 'Mia Probe'), person('p2', 'Hana Host')])
    expect(isEventHost(ev({ hosts: ['p1'] }), s.me.displayName, s.people)).toBe(true)
    expect(isEventHost(ev({ techSupport: ['p1'] }), s.me.displayName, s.people)).toBe(true)
    expect(isEventHost(ev({ hosts: ['p2'] }), s.me.displayName, s.people)).toBe(false)
  })
  it('one of several organizers (organizers list or the legacy "A, B" text) is a host', () => {
    const s = state([person('p2', 'Hana Host')])
    expect(isEventHost(ev({ organizers: ['p2', 'Mia Probe'], organizer: 'Hana Host, Mia Probe' }), s.me.displayName, s.people)).toBe(true)
    expect(isEventHost(ev({ organizer: 'Hana Host, Mia Probe' }), s.me.displayName, s.people)).toBe(true)
  })
  it('an event I made: mine while nobody holds a role; once an organizer is named, I need a role myself', () => {
    const s = state([person('p2', 'Hana Host')])
    expect(isEventHost(ev({ organizers: ['p2'], organizer: 'Hana Host' }), s.me.displayName, s.people)).toBe(false)
    expect(isEventHost(ev({}), s.me.displayName, s.people)).toBe(true)
  })
  it('trusted policy: a host held as a person id in my Close ring lets me invite', () => {
    const e = ev({ hosts: ['h1'], invitePolicy: 'trusted', attended: true })
    expect(mayInvite(e, state([person('h1', 'Hana Host', Ring.Close)]))).toBe(true)
    expect(mayInvite(e, state([person('h1', 'Hana Host', Ring.Friend)]))).toBe(false)
  })
})

describe('legacy organizer text with several names', () => {
  it('splits on commas, like the edit form', () => {
    expect(eventOrganizers({ organizer: 'Cecilia, Chantal' })).toEqual(['Cecilia', 'Chantal'])
    const s = { events: [{ id: 'e', name: 'x', from: '2026-01-01', where: '', createdAt: 0, attended: true, organizer: 'Cecilia, Chantal' }] }
    expect(migrateEventRoles(s)).toBe(true)
    expect(s.events[0].organizers).toEqual(['Cecilia', 'Chantal'])
  })
})

describe('one event slug', () => {
  it('feed_social copy equals event_tag for punctuation, dashes and edge underscores', () => {
    for (const name of ['Winter - IYG', '_x_', 'Fête  du Nord!', 'a__b', ' Forum: Alpbach 2026 ', 'IYG/Wien']) expect(tagOfEvent({ name })).toBe(eventTagSlug(name))
  })
  it('the slug case is one switch, the same in both copies', () => {
    expect(EVENT_SLUG_CASE).toBe(FEED_SLUG_CASE)
    expect(eventTagSlug('Winter IYG')).toBe(EVENT_SLUG_CASE === 'lower' ? 'event_winter_iyg' : 'event_Winter_IYG')
  })
})

describe('the picker: Enter takes the first row', () => {
  it('a partial name with a match picks the match, not a new person', () => {
    const people = [person('p1', 'Anna Gruber')]
    expect(pickOnEnter(people, 'Ann')).toEqual({ id: 'p1' })
    expect(pickOnEnter(people, 'Zoe')).toEqual({ create: 'Zoe' })
    expect(pickOnEnter(people, '  ')).toBeUndefined()
  })
})

describe('open decisions: one constant each, read here', () => {
  it('new person ring', () => expect(NEW_FROM_EVENT_RING).toBe(Ring.Unsorted))
  it('invite policy', () => expect(ev().invitePolicy ?? DEFAULT_INVITE_POLICY).toBe(DEFAULT_INVITE_POLICY))
  it('badge press', () => expect(['list', 'clear']).toContain(BADGE_PRESS))
  it('offers default', () => expect(offersOf({})).toEqual(EVENT_OFFERS_DEFAULT))
  it('sync device predicate: a phone places both entries at SYNC_PHONE_PLACEMENT', () => {
    expect(syncPlacement({ phone: true, tauri: false })).toEqual({ obsidian: SYNC_PHONE_PLACEMENT, tana: SYNC_PHONE_PLACEMENT })
    expect(syncPlacement({ phone: false, tauri: false })).toEqual({ obsidian: 'main', tana: 'main' })
  })
  it('nickname source: Me.nickname, else NICK_FALLBACK', () => {
    expect(revealedBy({ name: 'Ada Probe', nick: 'Addy' }, { nameReveal: 'nick' })).toEqual({ name: 'Addy' })
    expect(revealedBy({ name: 'Ada Probe' }, { nameReveal: 'nick' })).toEqual(NICK_FALLBACK === 'first' ? { name: 'Ada' } : undefined)
  })
})

describe('one notifications switch per event', () => {
  it('the "I\'m here now" announcements stay quiet when the event\'s Notifications are off or the old bell is muted', async () => {
    const { hereMuted } = await import('../../src/ext/calendar/at_event.ts')
    const e = { id: 'e1', name: 'x', from: '2026-11-15', where: '', createdAt: 0, attended: true }
    expect(hereMuted({ atEvent: { eventId: 'e1', since: 0 } }, e)).toBe(false)
    expect(hereMuted({ atEvent: { eventId: 'e1', since: 0 } }, { ...e, notify: false })).toBe(true)
    expect(hereMuted({ atEvent: { eventId: 'e1', since: 0, bell: false } }, e)).toBe(true)
  })
})
