// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 event-editor: drafts, details (repeat, conference, attachment, calendar), RSVP tense, calendars by tag, guests, tech-support takeover. */
import { Ring } from '../../src/model.ts'
import {
  BUILTIN_CALENDARS, CONFERENCE_PROVIDERS, addCalendar, applyEventDetails, calendarOf, calendarTags, calendarVisible, calendarsOf, connectedProviders,
  draftsOf, dropDraft, emptyFields, inviteGuests, isDirty, rememberRooms, rsvpTense, saveDraft, toggleCalendarTag,
} from '../../src/event_draft.ts'
import { mayApprove } from '../../src/event_roles.ts'
import { applyEventSettings, mayInvite } from '../../src/events.ts'

const NOW = Date.parse('2026-11-16T10:00:00Z')
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: Ring.Friend, metAt: NOW, lines: [], ...extra })
const ev = (extra = {}) => ({ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: NOW, attended: true, ...extra })
const state = (extra = {}) => ({ v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [person('p1', 'Anna Gruber'), person('p2', 'Ben Huber')], events: [ev()], ...extra })

describe('event details', () => {
  it('repeat: none is not stored, the others are; anything else throws', () => {
    const e = ev()
    applyEventDetails(e, { repeat: 'weekly' }); expect(e.repeat).toBe('weekly')
    applyEventDetails(e, { repeat: 'none' }); expect(e.repeat).toBeUndefined()
    expect(() => applyEventDetails(e, { repeat: 'hourly' })).toThrow(/repeat/)
  })
  it('conference: several providers, each an https link; empty list clears; unknown provider or plain http throws', () => {
    const e = ev()
    applyEventDetails(e, { conference: [{ provider: 'kmeet', url: 'https://kmeet.infomaniak.com/abc' }, { provider: 'zoom', url: 'https://zoom.us/j/1' }] })
    expect(e.conference.map((c) => c.provider)).toEqual(['kmeet', 'zoom'])
    expect(() => applyEventDetails(e, { conference: [{ provider: 'skype', url: 'https://x.y' }] })).toThrow(/provider/)
    expect(() => applyEventDetails(e, { conference: [{ provider: 'jitsi', url: 'http://meet.jit.si/a' }] })).toThrow(/https/)
    applyEventDetails(e, { conference: [] }); expect(e.conference).toBeUndefined()
    expect(CONFERENCE_PROVIDERS).toEqual(['kmeet', 'zoom', 'jitsi', 'custom'])
  })
  it('attachment (kDrive link) must be https; description goes to docs.description; calendar id kept unless the default', () => {
    const e = ev()
    applyEventDetails(e, { attachment: 'https://kdrive.infomaniak.com/app/share/1', description: 'Two days of practice', calendar: 'c-vienna' })
    expect(e).toMatchObject({ attachment: 'https://kdrive.infomaniak.com/app/share/1', docs: { description: 'Two days of practice' }, calendar: 'c-vienna' })
    expect(() => applyEventDetails(e, { attachment: 'javascript:alert(1)' })).toThrow(/https/)
    applyEventDetails(e, { attachment: '', description: '', calendar: 'mine' })
    expect(e.attachment).toBeUndefined(); expect(e.docs).toBeUndefined(); expect(e.calendar).toBeUndefined()
  })
  it('remembered rooms make a provider "connected"', () => {
    const s = state()
    expect(connectedProviders(s)).toEqual([])
    rememberRooms(s, [{ provider: 'kmeet', url: 'https://kmeet.infomaniak.com/room' }])
    expect(connectedProviders(s)).toEqual(['kmeet'])
    expect(s.calendars.rooms.kmeet).toBe('https://kmeet.infomaniak.com/room')
  })
})

describe('drafts', () => {
  it('a new editor starts empty with me as co-host; dirty only after a change', () => {
    const f = emptyFields('2026-11-16', 'Jakob')
    expect(f).toMatchObject({ name: '', from: '2026-11-16', repeat: 'none', cohosts: ['Jakob'], meRole: 'cohost', guests: [] })
    expect(isDirty(f, { ...f })).toBe(false)
    expect(isDirty(f, { ...f, name: 'x' })).toBe(true)
  })
  it('saveDraft adds one, the same id replaces it; dropDraft removes it; drafts never join the events', () => {
    const s = state()
    const f = { ...emptyFields('2026-11-16', 'Jakob'), name: 'Picnic' }
    const id = saveDraft(s, f, NOW, 'd1')
    expect(id).toBe('d1')
    saveDraft(s, { ...f, name: 'Picnic 2' }, NOW + 1, 'd1')
    expect(draftsOf(s).map((d) => d.fields.name)).toEqual(['Picnic 2'])
    expect(s.events.length).toBe(1)
    dropDraft(s, 'd1')
    expect(draftsOf(s)).toEqual([]); expect(s.eventDrafts).toBeUndefined()
  })
  it('a draft of an existing event remembers which one', () => {
    const s = state()
    saveDraft(s, emptyFields('2026-11-16', 'Jakob'), NOW, 'd2', 'e1')
    expect(draftsOf(s)[0].eventId).toBe('e1')
  })
})

describe('RSVP tense', () => {
  it('"I will attend" before the start, past tense from the start on', () => {
    expect(rsvpTense(ev({ from: '2026-12-30' }), NOW)).toBe('future')
    expect(rsvpTense(ev({ from: '2026-11-01', to: '2026-11-30' }), NOW)).toBe('past')
    expect(rsvpTense(ev({ from: '2026-11-16T09:00' }), Date.parse('2026-11-16T08:00:00'))).toBe('future')
  })
})

describe('guests (invite directly)', () => {
  it('invites people; co-host adds them to hosts too; nobody twice', () => {
    const e = ev()
    inviteGuests(e, ['p1', 'p2', 'p1'])
    expect(e.people).toEqual(['p1', 'p2'])
    inviteGuests(e, ['p2'], true)
    expect(e.hosts).toEqual(['p2'])
    expect(e.people).toEqual(['p1', 'p2'])
  })
})

describe('tech support takes over only when the host allows it (43-D7)', () => {
  const people = [person('p1', 'Anna Gruber')]
  it('hosts and organizers approve; tech support sees but does not approve', () => {
    expect(mayApprove(ev({ hosts: ['Jakob'] }), 'Jakob', people)).toBe(true)
    expect(mayApprove(ev({ organizers: ['Jakob'], hosts: ['p1'] }), 'Jakob', people)).toBe(true)
    expect(mayApprove(ev({ hosts: ['p1'], techSupport: ['Jakob'] }), 'Jakob', people)).toBe(false)
  })
  it('the host switch "can take over" lets tech support approve', () => {
    const e = ev({ hosts: ['p1'], techSupport: ['Jakob'] })
    applyEventSettings(e, { techTakeover: true })
    expect(e.techTakeover).toBe(true)
    expect(mayApprove(e, 'Jakob', people)).toBe(true)
    applyEventSettings(e, { techTakeover: false })
    expect(e.techTakeover).toBeUndefined()
  })
  it('an event I made alone is mine to approve', () => expect(mayApprove(ev(), 'Jakob', [])).toBe(true))
  it('tech support may not invite under the hosts-only policy until it may take over', () => {
    const s = state({ people })
    const e = ev({ hosts: ['p1'], techSupport: ['Jakob'], invitePolicy: 'hosts' })
    expect(mayInvite(e, s)).toBe(false)
    e.techTakeover = true
    expect(mayInvite(e, s)).toBe(true)
  })
})

describe('calendars by tag', () => {
  it('two built-in calendars: mine and shared with me (events from a link)', () => {
    expect(BUILTIN_CALENDARS.map((c) => c.id)).toEqual(['mine', 'shared'])
    expect(calendarOf(ev())).toBe('mine')
    expect(calendarOf(ev({ fromLink: true }))).toBe('shared')
    expect(calendarOf(ev({ calendar: 'c1' }))).toBe('c1')
  })
  it('addCalendar: a name and #tags; the tags of all calendars, first seen first', () => {
    const s = state()
    const id = addCalendar(s, 'Vienna', '#here, #anna', 'c1')
    expect(id).toBe('c1')
    expect(calendarsOf(s).map((c) => c.name)).toEqual(['My events', 'Shared with me', 'Vienna'])
    expect(calendarTags(s)).toEqual(['mine', 'shared', 'here', 'anna'])
    expect(() => addCalendar(s, ' ', '', 'c2')).toThrow(/name/)
  })
  it('a tag switched off hides every calendar carrying it; switching on shows it again', () => {
    const s = state()
    addCalendar(s, 'Vienna', 'here anna', 'c1')
    const v = ev({ id: 'e2', calendar: 'c1' })
    expect(calendarVisible(s, v)).toBe(true)
    toggleCalendarTag(s, 'anna')
    expect(calendarVisible(s, v)).toBe(false)
    expect(calendarVisible(s, ev())).toBe(true)
    toggleCalendarTag(s, 'anna', true)
    expect(calendarVisible(s, v)).toBe(true)
    expect(s.calendars.off).toBeUndefined()
  })
})
