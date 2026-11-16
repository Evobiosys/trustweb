// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b review fixes: findings F1..F7 of DEVLOG/wave43/review-fixes-43b_result-report.txt, one block each. Fake data only. */
import { EVENT_QR_MAX, shortEventLink } from '../../src/event_join.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { mode } from '../../src/qr_modes.ts'
import { newEvent } from '../../src/events.ts'
import { templatePrompt } from '../../src/event_plan.ts'
import { createActions } from '../../src/actions.ts'
import { defineEventActions } from '../../src/event_actions.ts'
import { zoneState, hideLeaks } from '../../src/audience_filter.ts'
import { Audience, Ring, threadsForRing } from '../../src/model.ts'
import { playUrl, revealLinks, PROTECTED_LINK_ONE_AT_A_TIME } from '../../src/resource_views.ts'
import { S } from '../../src/strings.ts'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const ORIGIN = 'https://app.trustweb.one'
const DID = 'did:peer:2.Ez6LS' + 'a'.repeat(44) + '.Vz6Mk' + 'b'.repeat(44) + '.SeyJ0IjoiZG0iLCJzIjoiaHR0cHM6Ly9yZWxheS50cnVzdHdlYi5vbmUvZCIsImEiOlsiZGlkY29tbS92MiJdfQ'
const CONNECT = `${ORIGIN}/?connect=${encodeURIComponent(DID)}&id=peerid123&name=Ada%20Example`
const base = { name: 'Winter IYG', from: '2026-12-30', to: '2027-01-02', where: 'Gasthof Alpenrose', core: { from: '2026-12-31', to: '2027-01-01' }, hosts: ['Ben Example', 'Cleo Example'] }
const hashOf = (p) => p.slice(p.indexOf('#'))

describe('F1 short event QR keeps the event-only mode and the tag name', () => {
  const ev = { ...newEvent(base, 'e1abc', 5), linkMode: 'event', tagName: 'IYG Days', srv: '0123456789abcdef' }
  it('mode=event survives the short form (B5 through the QR)', () => {
    const p = mode({ kind: 'event', link: CONNECT, eventLink: encodeEventLink(ev, ORIGIN, 'peer') }).payload
    expect(decodeEventLink(hashOf(p)).linkMode).toBe('event')
  })
  it('the tag name travels as in the long link (host and guest)', () => {
    expect(decodeEventLink(hashOf(shortEventLink(encodeEventLink(ev, ORIGIN, 'host')))).tagName).toBe('IYG Days')
    expect(decodeEventLink(hashOf(shortEventLink(encodeEventLink(ev, ORIGIN, 'peer')))).tagName).toBe('IYG Days')
  })
  it('an event without them stays as short as before', () => {
    const plain = { ...newEvent(base, 'e1abc', 5) }
    const s = shortEventLink(encodeEventLink(plain, ORIGIN, 'peer'))
    expect(decodeEventLink(hashOf(s)).linkMode).toBeUndefined()
    expect(JSON.parse(Buffer.from(s.split('evs=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).length).toBe(7)
  })
})

describe('F2 the event QR budget (EVENT_QR_MAX) holds for long host lists and names', () => {
  const long = { ...newEvent({ ...base, name: 'Winter Integral Youth Gathering at the Alpenrose 2026', hosts: ['Maximilian Oberhuber-Steiner', 'Cleopatra Example-Wanderer', 'Bartholomew Longname'] }, 'e1abc', 5), srv: '0123456789abcdef' }
  const payload = mode({ kind: 'event', link: CONNECT, eventLink: encodeEventLink(long, ORIGIN, 'peer') }).payload
  it('stays within the budget', () => { expect(payload.length).toBeLessThanOrEqual(EVENT_QR_MAX) })
  it('keeps id and dates; the hosts go first, then the name is shortened', () => {
    const e = decodeEventLink(hashOf(payload))
    expect(e).toMatchObject({ id: 'e1abc', from: '2026-12-30', to: '2027-01-02' })
    expect(e.hosts).toBeUndefined()
    expect(e.name.length).toBeGreaterThan(8)
  })
  it('a short event keeps its hosts', () => {
    const p = mode({ kind: 'event', link: CONNECT, eventLink: encodeEventLink({ ...newEvent(base, 'e1abc', 5) }, ORIGIN, 'peer') }).payload
    expect(decodeEventLink(hashOf(p)).hosts).toEqual(['Ben Example', 'Cleo Example'])
  })
})

describe('F3 Add event Informal | Hosted reaches the event', () => {
  const setup = (hosted) => {
    const state = { events: [] }
    const reg = createActions()
    defineEventActions(reg, { state: () => state, save: () => {}, newId: () => 'id1', community: () => 'iyg', hosted: () => hosted, me: () => 'Ana' })
    reg.do('event-create', { name: 'Circle', from: '2027-01-10' }, 'assistant')
    return state.events[0]
  }
  it('hosted: I am the host', () => { expect(setup(true).hosts).toEqual(['Ana']) })
  it('informal: no host', () => { expect(setup(false).hosts).toBeUndefined() })
  it('MCP parity: event_create hosted:true makes me the host, absent stays informal', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-rf43b-')), 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], sameAs: {}, meetings: [], extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } } } } }))
    const by = Object.fromEntries(recordTools({ file, write: true, now: () => new Date('2026-11-15T10:00:00Z') }).map((t) => [t.name, t]))
    by.event_create.run({ community: 'iyg', hosted: true, template: { name: 'Hosted one', from: '2027-01-10' } })
    by.event_create.run({ community: 'iyg', template: { name: 'Informal one', from: '2027-01-11' } })
    const evs = JSON.parse(readFileSync(file, 'utf8')).events
    expect(evs[0].hosts).toEqual(['Ana'])
    expect(evs[1].hosts).toBeUndefined()
  })
  it('the assistant is told which kind', () => {
    expect(templatePrompt('IYG', true)).toMatch(/hosted/i)
    expect(templatePrompt('IYG', false)).toMatch(/informal/i)
    expect(templatePrompt('IYG')).toBe(templatePrompt('IYG', undefined))
  })
})

describe('F4 P2: zones outside the cut are off (struck through), never colour alone', () => {
  it('the picked zone is on, narrower zones are in, wider ones off', () => {
    expect(['closest', 'close', 'friend'].map((z) => zoneState(z, 'close'))).toEqual(['in', 'on', 'off'])
  })
  it('no zone picked (everybody): none is off', () => {
    expect(['closest', 'close', 'friend'].map((z) => zoneState(z, undefined))).toEqual(['in', 'in', 'in'])
  })
})

describe('F5 I7: Hide from is honest about asks that travel further', () => {
  it('warns only when someone is hidden and the ask goes beyond direct contacts', () => {
    expect(hideLeaks({ exclude: ['person:x'], add: [], degree: 2 })).toBe(true)
    expect(hideLeaks({ exclude: ['person:x'], add: [], degree: 1 })).toBe(false)
    expect(hideLeaks({ exclude: [], add: [], degree: 3 })).toBe(false)
    expect(S.askPage.hideTravels).toMatch(/through/i)
  })
})

describe('F6 B17/B20: a protected resource is never matched to an ask (cannot be shared on)', () => {
  const s = { me: { id: 'me', displayName: 'Ana' }, people: [], inventory: [
    { id: 'a', text: 'Mahamudra recording 3', audience: Audience.FriendsOfFriends, included: true, createdAt: 1, protected: true },
    { id: 'b', text: 'Garden tools', audience: Audience.FriendsOfFriends, included: true, createdAt: 1 },
  ] }
  it('only the unprotected line reaches the matcher', () => {
    const texts = threadsForRing(s, Ring.Close).threads.map((t) => t.messages[0].text)
    expect(texts).toEqual(['Garden tools'])
  })
})

describe('F7 B20: a protected recording can be started without showing its link', () => {
  it('Play opens http(s) links only', () => {
    expect(playUrl({ link: 'https://rec.example/3' })).toBe('https://rec.example/3')
    expect(playUrl({ link: 'javascript:alert(1)' })).toBe(null)
    expect(playUrl({})).toBe(null)
    expect(S.resViews.play).toBeTruthy()
  })
})

describe('F8 the PROTECTED_LINK_ONE_AT_A_TIME switch decides (it was read by nothing)', () => {
  it('on: one link at a time; off: each press adds or removes its own', () => {
    expect(PROTECTED_LINK_ONE_AT_A_TIME).toBe(true)
    expect(revealLinks(['a'], 'b')).toEqual(['b'])
    expect(revealLinks(['b'], 'b')).toEqual([])
    expect(revealLinks(['a'], 'b', false)).toEqual(['a', 'b'])
    expect(revealLinks(['a', 'b'], 'a', false)).toEqual(['b'])
  })
})

describe('F9 I7: the event QR text promises nothing that is not built', () => {
  it('no "follow once you are connected" (no detail sync after the connect exists)', () => {
    expect(S.qrEventTrimmed).toMatch(/follow from this phone/i)
    expect(S.qrEventTrimmed).toMatch(/link/i)
  })
})
