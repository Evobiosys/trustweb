// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-event-visibility: per-event visibility, share with the community + announce, community calendar filter, strike-through default. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { applyEventSettings } from '../../src/event_press.ts'
import { DEFAULT_EVENT_VISIBILITY, EVENT_VISIBILITIES, announceDue, communityEvents, communityMembers, listedAttendees, noteShow, searchableAttendees, visibilityOf } from '../../src/event_visibility.ts'
import { createEventEnvelopes, receiveAnnounce } from '../../src/event_envelope.ts'
import { encodeEventLink, decodeEventLink } from '../../src/event_link.ts'
import { newEvent } from '../../src/events.ts'
import { centerItems, unreadCount } from '../../src/notify_center.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const NOW = Date.UTC(2026, 10, 16, 12)
const ev = (over = {}) => ({ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, ...over })

describe('my visibility at an event', () => {
  it('defaults to discoverable, nothing stored', () => {
    expect(DEFAULT_EVENT_VISIBILITY).toBe('discoverable')
    expect(EVENT_VISIBILITIES).toEqual(['open', 'discoverable', 'off'])
    expect(visibilityOf(ev())).toBe('discoverable')
    const e = ev()
    applyEventSettings(e, { showMe: 'open' })
    expect(e.showMe).toBe('open')
    applyEventSettings(e, { showMe: 'discoverable' })
    expect('showMe' in e).toBe(false)
    applyEventSettings(e, { showMe: 'off' })
    expect(visibilityOf(e)).toBe('off')
  })
  it('refuses a value outside the three', () => { expect(() => applyEventSettings(ev(), { showMe: 'everyone' })).toThrow(/open, discoverable, off/) })
})

describe('the attendee list respects what people announced', () => {
  const P = (id, show) => ({ id, name: id, ...(show ? { eventShow: { e1: show } } : {}) })
  const people = [P('mine'), P('open', 'open'), P('disc', 'discoverable'), P('off', 'off')]
  it('lists the ones I tagged and the open ones; discoverable only by search; off never', () => {
    expect(listedAttendees(people, 'e1').map((p) => p.id)).toEqual(['mine', 'open'])
    expect(searchableAttendees(people, 'e1').map((p) => p.id)).toEqual(['mine', 'open', 'disc'])
  })
  it('another event is unaffected; noteShow stores a mode and ignores junk', () => {
    expect(listedAttendees(people, 'e2')).toHaveLength(4)
    const p = P('x')
    noteShow(p, 'e1', 'discoverable'); noteShow(p, 'e1', 'bogus'); noteShow(p, 'e2', 'off')
    expect(p.eventShow).toEqual({ e1: 'discoverable', e2: 'off' })
  })
})

describe('wire: show and announce on the event envelope', () => {
  const link = 'https://app.trustweb.one/#ev=abc'
  it('round trips both; a value outside the three is dropped; announce only as true', () => {
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', link, show: 'open', announce: true }))).toEqual({ v: 1, t: 'event', link, show: 'open', announce: true })
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'event', link, show: 'all', announce: 'yes' }))).toEqual({ v: 1, t: 'event', link })
  })
})

const ORIGIN = 'https://app.trustweb.one'
const community = (over = {}) => ev({ communityId: 'iyg', shareCommunity: true, ...over })
function harness(events) {
  const sent = []
  const state = {
    me: { id: 'me', displayName: 'Ben Example' }, events,
    people: [
      { id: 'a', name: 'Ada', peerId: 'pa', fields: { iyg: 'true' } },
      { id: 'b', name: 'Bob', peerId: 'pb', fields: {} },
      { id: 'c', name: 'Cleo', fields: { iyg: 'true' } },   // not connected
    ],
    notifInbox: [],
  }
  const host = {
    state: () => state, save: () => {}, now: () => NOW, link: (e) => encodeEventLink(e, ORIGIN, 'peer', { name: 'Ben Example' }),
    send: async (peer, env) => { sent.push({ to: peer.id, env }) }, pending: () => null, setPending: () => {}, changed: () => {}, later: () => {},
    members: (tag) => communityMembers(state, tag).map((p) => ({ id: p.peerId })),
  }
  return { env: createEventEnvelopes(host), sent, state }
}

describe('share with the whole community: announce', () => {
  it('is due only when shared, in a community, not announced yet and not received from a link', () => {
    expect(announceDue(community())).toBe(true)
    expect(announceDue(community({ shareCommunity: undefined }))).toBe(false)
    expect(announceDue(community({ communityId: undefined }))).toBe(false)
    expect(announceDue(community({ community: 'iyg', communityId: undefined }))).toBe(true)
    expect(announceDue(community({ announcedAt: 5 }))).toBe(false)
    expect(announceDue(community({ fromLink: true }))).toBe(false)
  })
  it('sends the event once to the connected members of the community, marks it, and never twice', () => {
    const h = harness([community()])
    expect(h.env.announceDue()).toBe(true)
    expect(h.sent.map((x) => x.to)).toEqual(['pa'])
    expect(h.sent[0].env).toMatchObject({ v: 1, t: 'event', announce: true, show: 'discoverable' })
    expect(h.state.events[0].announcedAt).toBe(NOW)
    expect(h.env.announceDue()).toBe(false)
    expect(h.sent).toHaveLength(1)
  })
  it('sends nothing for an event that is not shared', () => {
    const h = harness([community({ shareCommunity: undefined })])
    expect(h.env.announceDue()).toBe(false)
    expect(h.sent).toHaveLength(0)
  })
  it('the receiver gets the event (not attending) and one inbox row: bell badge and the Events section', async () => {
    const sender = harness([community({ organizer: 'Verein', hosts: ['Ben Example'] })])
    sender.env.announceDue()
    const got = harness([])
    got.state.people = [{ id: 'ben', name: 'Ben Example', peerId: 'pb' }]
    expect(await got.env.onEnvelope({ id: 'pb' }, sender.sent[0].env)).toBe('filled')
    expect(got.state.events).toMatchObject([{ id: 'e1', name: 'Winter IYG', attended: false, fromLink: true }])
    const rows = centerItems(got.state, NOW).filter((i) => i.section === 'events')
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toMatch(/Winter IYG/)
    expect(unreadCount(got.state, NOW)).toBe(1)
    expect(got.state.people[0].eventShow).toEqual({ e1: 'discoverable' })
    // a second arrival of the same event adds nothing
    expect(receiveAnnounce(got.state, decodeEventLink(sender.sent[0].env.link.slice(sender.sent[0].env.link.indexOf('#'))), 'Ben', NOW)).toBe(false)
    expect(got.state.notifInbox).toHaveLength(1)
  })
  it('respects the receiver\'s Notifications switch of that event (quiet event: no row)', async () => {
    const sender = harness([community()])
    sender.env.announceDue()
    const got = harness([])
    got.state.people = [{ id: 'ben', name: 'Ben Example', peerId: 'pb' }]
    await got.env.onEnvelope({ id: 'pb' }, sender.sent[0].env)
    got.state.events[0].notify = false
    expect(centerItems(got.state, NOW).filter((i) => i.section === 'events')).toHaveLength(0)
  })
  it('an announce from nobody I know is ignored', async () => {
    const sender = harness([community()])
    sender.env.announceDue()
    const got = harness([])
    expect(await got.env.onEnvelope({ id: 'stranger' }, sender.sent[0].env)).not.toBe('filled')
    expect(got.state.events).toHaveLength(0)
  })
  it('the receiver\'s "Alert me about new events" switch off drops the announce silently (no event, no row)', async () => {
    const sender = harness([community()])
    sender.env.announceDue()
    const got = harness([])
    got.state.people = [{ id: 'ben', name: 'Ben Example', peerId: 'pb' }]
    const r = {}
    expect(readSetting(r, 'events.alertCommunity')).toBe(true)
    writeSetting(r, 'events.alertCommunity', false)
    expect(r.eventAlerts).toBe(false)
    got.state.eventAlerts = false
    expect(await got.env.onEnvelope({ id: 'pb' }, sender.sent[0].env)).toBe('ignored')
    expect(got.state.events).toHaveLength(0)
    expect(got.state.notifInbox ?? []).toHaveLength(0)
    writeSetting(r, 'events.alertCommunity', true)
    expect('eventAlerts' in r).toBe(false)
    delete got.state.eventAlerts
    expect(await got.env.onEnvelope({ id: 'pb' }, sender.sent[0].env)).toBe('filled')
  })
  it('the settings patch switches sharing on and off', () => {
    const e = ev()
    applyEventSettings(e, { shareCommunity: true })
    expect(e.shareCommunity).toBe(true)
    applyEventSettings(e, { shareCommunity: false })
    expect('shareCommunity' in e).toBe(false)
  })
})

describe('community calendar: the community\'s own events', () => {
  it('picks events by communityId, else the community they were made in', () => {
    const list = [ev({ id: '1', communityId: 'iyg' }), ev({ id: '2', community: 'iyg' }), ev({ id: '3', communityId: 'other' }), ev({ id: '4' })]
    expect(communityEvents(list, 'iyg').map((e) => e.id)).toEqual(['1', '2'])
  })
})

describe('strike-through of switched-off options is off by default', () => {
  it('Settings > Variations switch: default false, stored only when on; MCP settings_set reaches it', () => {
    const r = {}
    expect(readSetting(r, 'variations.strike')).toBe(false)
    writeSetting(r, 'variations.strike', true)
    expect(r.strikeSwitchedOff).toBe(true)
    writeSetting(r, 'variations.strike', false)
    expect('strikeSwitchedOff' in r).toBe(false)
  })
})

describe('MCP parity: event_settings_set carries showMe and shareCommunity', () => {
  it('is listed, changes both, reports them', () => {
    expect(MCP_TOOLS.map((t) => t.name)).toContain('event_settings_set')
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-vis-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { displayName: 'Jakob' }, people: [], sameAs: {}, meetings: [], events: [ev()] }))
    const by = Object.fromEntries(recordTools({ file, write: true, now: () => new Date('2026-11-16T10:00:00Z') }).map((t) => [t.name, t]))
    expect(by.event_settings_set.run({ event: 'e1' })).toMatchObject({ showMe: 'discoverable', shareCommunity: false })
    expect(by.event_settings_set.run({ event: 'e1', showMe: 'open', shareCommunity: true, communityId: 'iyg' })).toMatchObject({ showMe: 'open', shareCommunity: true })
    expect(JSON.parse(readFileSync(file, 'utf8')).events[0]).toMatchObject({ showMe: 'open', shareCommunity: true })
    expect(() => by.event_settings_set.run({ event: 'e1', showMe: 'nope' })).toThrow()
  })
})
