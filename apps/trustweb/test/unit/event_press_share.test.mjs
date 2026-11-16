// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-press-share (events.ts): since/until wording, notifications, nickname reveal, who may invite, what the event offers, time edits. */
import {
  EVENT_OFFERS_DEFAULT, INVITE_POLICIES, NAME_REVEALS, applyEventSettings, eventOffersFeed, localSettings, mayInvite, newEvent, notifyOn, offersOf,
  revealedBy, setEventTimes, sinceLabel, untilLabel,
} from '../../src/events.ts'

const NOW = new Date('2026-11-15T12:00').getTime()
const ev = (over = {}) => ({ ...newEvent({ name: 'Winter Forum', from: '2026-11-15T09:30', to: '2026-11-18', where: 'Probe Town', core: { from: '2026-11-16', to: '2026-11-17' } }, 'e1', NOW), ...over })
const person = (id, name, ring) => ({ id, name, context: '', ring, metAt: 0, lines: [] })
const state = (people = [], me = 'Mia Probe') => ({ me: { id: 'me', displayName: me }, people })

describe('sinceLabel / untilLabel', () => {
  it('today with a time: since <time> today', () => {
    expect(sinceLabel(ev(), '2026-11-15')).toBe('since 09:30 today')
  })
  it('today without a time: since today', () => {
    expect(sinceLabel(ev({ from: '2026-11-15' }), '2026-11-15')).toBe('since today')
  })
  it('another day: the date span as before', () => {
    expect(sinceLabel(ev({ from: '2026-11-20', to: '2026-11-22' }), '2026-11-15')).toBe('20 Nov 2026 to 22 Nov 2026')
    expect(sinceLabel(ev({ from: '2026-11-10', to: undefined }), '2026-11-15')).toBe('10 Nov 2026')
  })
  it('until names the end (with a time when it has one); empty without an end', () => {
    expect(untilLabel(ev())).toBe('until 18 Nov 2026')
    expect(untilLabel(ev({ to: '2026-11-18T17:00' }))).toBe('until 18 Nov 2026 17:00')
    expect(untilLabel(ev({ to: undefined }))).toBe('')
  })
})

describe('setEventTimes', () => {
  it('stores a valid from/to (a later end = staying longer); an empty to removes it', () => {
    const e = ev()
    expect(setEventTimes(e, '2026-11-15T09:30', '2026-11-20')).toBeUndefined()
    expect(e.to).toBe('2026-11-20')
    expect(setEventTimes(e, '2026-11-15T09:30', '')).toBeUndefined()
    expect('to' in e).toBe(false)
  })
  it('refuses a bad date or an end before the start and leaves the event as it was', () => {
    const e = ev()
    expect(setEventTimes(e, 'soon', '')).toBe('from')
    expect(setEventTimes(e, '2026-11-15', '2026-11-01')).toBe('to')
    expect(e).toMatchObject({ from: '2026-11-15T09:30', to: '2026-11-18' })
  })
  it('drops a core time that no longer fits inside', () => {
    const e = ev()
    expect(setEventTimes(e, '2026-11-15', '2026-11-16')).toBeUndefined()
    expect('core' in e).toBe(false)
  })
})

describe('notifications', () => {
  it('on by default; off only when false', () => {
    expect(notifyOn(ev())).toBe(true)
    expect(notifyOn(ev({ notify: false }))).toBe(false)
    expect(notifyOn(ev({ notify: true }))).toBe(true)
  })
})

describe('nickname reveal', () => {
  it('is a fourth choice after hidden', () => {
    expect(NAME_REVEALS).toEqual(['full', 'first', 'hidden', 'nick'])
  })
  it('gives the nickname, else the first name, never the did', () => {
    const by = { name: 'Ada Probe', did: 'did:key:z6MkProbe', nick: 'Addy' }
    expect(revealedBy(by, { nameReveal: 'nick' })).toEqual({ name: 'Addy' })
    expect(revealedBy({ name: 'Ada Probe', did: 'did:x' }, { nameReveal: 'nick' })).toEqual({ name: 'Ada' })
  })
  it('full never carries the nickname field', () => {
    expect(revealedBy({ name: 'Ada Probe', did: 'did:x', nick: 'Addy' }, {})).toEqual({ name: 'Ada Probe', did: 'did:x' })
  })
})

describe('mayInvite', () => {
  it('policy hosts (answers-43: no longer the default): host and organizer; tech support once it may take over (wave 44)', () => {
    const s = state()
    const only = { invitePolicy: 'hosts' }
    expect(mayInvite(ev({ hosts: ['Mia Probe'], ...only }), s)).toBe(true)
    expect(mayInvite(ev({ hosts: ['Other'], organizer: 'mia probe', ...only }), s)).toBe(true)
    // wave 44 (43-D7 flip): technical support sees but invites only once a host lets it take over
    expect(mayInvite(ev({ hosts: ['Other'], techSupport: ['Mia Probe'], ...only }), s)).toBe(false)
    expect(mayInvite(ev({ hosts: ['Other'], techSupport: ['Mia Probe'], techTakeover: true, ...only }), s)).toBe(true)
    expect(mayInvite(ev({ hosts: ['Other'], ...only }), s)).toBe(false)
    expect(mayInvite(ev({ hosts: ['Other'] }), s)).toBe(true)   // the default is everyone
  })
  it('an event I made without hosts is mine; one that came through a link is not', () => {
    expect(mayInvite(ev({ hosts: undefined }), state())).toBe(true)
    expect(mayInvite(ev({ hosts: undefined, fromLink: true, invitePolicy: 'hosts' }), state())).toBe(false)
  })
  it('everyone: any attendee, nobody who does not attend', () => {
    const e = ev({ hosts: ['Other'], invitePolicy: 'everyone' })
    expect(mayInvite({ ...e, attended: true }, state())).toBe(true)
    expect(mayInvite({ ...e, attended: false }, state())).toBe(false)
  })
  it('trusted: a host of mine in the Close ring or closer lets me invite; a Friend host does not', () => {
    const e = ev({ hosts: ['Hana Host'], invitePolicy: 'trusted' })
    for (const ring of ['closest', 'close']) expect(mayInvite(e, state([person('h', 'Hana Host', ring)]))).toBe(true)
    expect(mayInvite(e, state([person('h', 'Hana Host', 'family')]))).toBe(true)
    expect(mayInvite(e, state([person('h', 'Hana Host', 'friend')]))).toBe(false)
    expect(mayInvite(e, state([]))).toBe(false)
    expect(mayInvite({ ...e, attended: false }, state([person('h', 'Hana Host', 'close')]))).toBe(false)
  })
  it('the policies are hosts, trusted, everyone', () => {
    expect(INVITE_POLICIES).toEqual(['hosts', 'trusted', 'everyone'])
  })
})

describe('offers', () => {
  it('all off by default (one constant)', () => {
    expect(EVENT_OFFERS_DEFAULT).toEqual({ support: false, resources: false, feed: false })
    expect(offersOf(ev())).toEqual(EVENT_OFFERS_DEFAULT)
    expect(eventOffersFeed(ev())).toBe(false)
  })
  it('reads what the host switched on', () => {
    expect(offersOf(ev({ offers: { feed: true } }))).toEqual({ support: false, resources: false, feed: true })
    expect(eventOffersFeed(ev({ offers: { feed: true } }))).toBe(true)
  })
})

describe('applyEventSettings (the app and MCP share it)', () => {
  it('sets the policy, notifications, offers and name reveal; defaults are not stored', () => {
    const e = ev()
    applyEventSettings(e, { invitePolicy: 'hosts', notify: false, offers: { support: true }, nameReveal: 'nick' })
    expect(e).toMatchObject({ invitePolicy: 'hosts', notify: false, offers: { support: true }, nameReveal: 'nick' })
    applyEventSettings(e, { invitePolicy: 'everyone', notify: true, offers: { support: false }, nameReveal: 'full' })
    expect(e.invitePolicy).toBeUndefined()
    expect(e.notify).toBeUndefined()
    expect(e.offers).toBeUndefined()
    expect(e.nameReveal).toBeUndefined()
  })
  it('refuses a value outside the choices', () => {
    expect(() => applyEventSettings(ev(), { invitePolicy: 'anyone' })).toThrow(/invitePolicy/)
    expect(() => applyEventSettings(ev(), { nameReveal: 'bogus' })).toThrow(/nameReveal/)
  })
})

describe('local settings survive an edit of the form', () => {
  it('notify, invitePolicy and offers stay', () => {
    const e = ev({ notify: false, invitePolicy: 'trusted', offers: { feed: true } })
    expect(localSettings(e)).toMatchObject({ notify: false, invitePolicy: 'trusted', offers: { feed: true } })
  })
})
