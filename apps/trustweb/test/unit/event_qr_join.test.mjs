// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b event-qr-join: the short event QR (length budget), where a link opens, what follows a connect, past asks per person. Fake data only. */
import { EVENT_QR_MAX, EVENT_QR_SERVER_LOOKUP, afterConnect, eventLinkView, pastAsksOf, shortEventLink } from '../../src/event_join.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { decodeModeLink, mode } from '../../src/qr_modes.ts'
import { newEvent } from '../../src/events.ts'
import { S } from '../../src/strings.ts'

const ORIGIN = 'https://app.trustweb.one'
const DID = 'did:peer:2.Ez6LS' + 'a'.repeat(44) + '.Vz6Mk' + 'b'.repeat(44) + '.SeyJ0IjoiZG0iLCJzIjoiaHR0cHM6Ly9yZWxheS50cnVzdHdlYi5vbmUvZCIsImEiOlsiZGlkY29tbS92MiJdfQ'
const CONNECT = `${ORIGIN}/?connect=${encodeURIComponent(DID)}&id=peerid123&name=Ada%20Example`
const conditions = 'Bring warm clothes, your own cup and an open mind. '.repeat(8).trim()
const ev = { ...newEvent({ name: 'Winter IYG', from: '2026-12-30', to: '2027-01-02', where: 'Gasthof Alpenrose, Hinterstoder, Austria', conditions, themes: ['trust', 'commons', 'regeneration'], organizer: 'Verein Beispiel', core: { from: '2026-12-31', to: '2027-01-01' }, hosts: ['Ben Example', 'Cleo Example'] }, 'e1abc', 5), srv: '0123456789abcdef' }
const full = encodeEventLink(ev, ORIGIN, 'peer', { name: 'Ada Example', did: DID })
const qr = () => mode({ kind: 'event', link: CONNECT, eventLink: full })

describe('short event QR', () => {
  it('the full link is far over the budget, the QR payload within it (QR <= v16, 450 chars)', () => {
    expect(CONNECT.length + full.length).toBeGreaterThan(1400)
    expect(EVENT_QR_MAX).toBe(450)
    expect(qr().payload.length).toBeLessThanOrEqual(EVENT_QR_MAX)
  })
  it('the short form round trips through the decoder', () => {
    const e = decodeEventLink(qr().payload.slice(qr().payload.indexOf('#')))
    expect(e.where).toBe('')
  })
  it('still connects and still decodes as an event mode', () => {
    expect(decodeModeLink(qr().payload)).toEqual({ kind: 'event' })
    expect(qr().payload).toContain('connect=')
  })
  it('keeps id, name, dates, core and the hosts; drops conditions, themes, place, organizer and the sender', () => {
    const e = decodeEventLink(qr().payload.slice(qr().payload.indexOf('#')))
    expect(e).toMatchObject({ kind: 'peer', id: 'e1abc', name: 'Winter IYG', from: '2026-12-30', to: '2027-01-02', core: { from: '2026-12-31', to: '2027-01-01' }, hosts: ['Ben Example', 'Cleo Example'], srv: '0123456789abcdef' })
    expect(e.conditions).toBeUndefined()
    expect(e.themes).toBeUndefined()
    expect(e.by).toBeUndefined()
    expect(e.organizer).toBeUndefined()
  })
  it('keeps the host kind', () => {
    const host = encodeEventLink(ev, ORIGIN, 'host')
    expect(shortEventLink(host)).toMatch(/#evs_host=/)
  })
  it('anything that is not an event link stays as it is', () => {
    expect(shortEventLink('https://x.example/#nothing')).toBe('https://x.example/#nothing')
  })
  it('the over-length message names what was trimmed, not an option that does not exist', () => {
    expect(S.qrEventTooLong).not.toMatch(/option/i)
    expect(S.qrEventTooLong).toMatch(/conditions/i)
  })
  it('server lookup stays off', () => { expect(EVENT_QR_SERVER_LOOKUP).toBe(false) })
})

describe('where an event link opens', () => {
  const host = { ...ev, hosts: ['Ben Example'], fromLink: true }
  it('edit for a host / organizer / tech support, normal for everyone else', () => {
    expect(eventLinkView(host, 'peer', 'Ben Example', [])).toBe('edit')
    expect(eventLinkView({ ...host, hosts: [], organizers: ['Cleo Example'] }, 'peer', 'Cleo Example', [])).toBe('edit')
    expect(eventLinkView({ ...host, hosts: [], techSupport: ['Dan Example'] }, 'peer', 'Dan Example', [])).toBe('edit')
    expect(eventLinkView(host, 'peer', 'Zoe Guest', [])).toBe('normal')
  })
  it('a host link opens the edit view whoever holds it', () => {
    expect(eventLinkView(host, 'host', 'Zoe Guest', [])).toBe('edit')
  })
})

describe('after a connect', () => {
  it('an event waiting opens next, then a share, else the person', () => {
    expect(afterConnect({ hasShare: false, hasEvent: true })).toBe('event')
    expect(afterConnect({ hasShare: true, hasEvent: true })).toBe('share')
    expect(afterConnect({ hasShare: false, hasEvent: false })).toBe('person')
  })
})

describe('past asks of one person', () => {
  const held = (qid, peerId, receivedAt, extra = {}) => ({ qid, peerId, text: `ask ${qid}`, fromName: 'Ada', through: [], doorName: null, relayed: false, matches: [], receivedAt, deadline: receivedAt + 1000, lateMode: true, ...extra })
  const list = [held('a', 'p1', 10), held('b', 'p2', 20), held('c', 'p1', 30), held('d', 'p1', 40, { yesAt: 41 })]
  it('lists the undecided asks from that person, newest first', () => {
    expect(pastAsksOf(list, 'p1', 50).map((a) => a.qid)).toEqual(['c', 'a'])
  })
  it('none for a person without asks', () => { expect(pastAsksOf(list, 'p9', 50)).toEqual([]) })
})
