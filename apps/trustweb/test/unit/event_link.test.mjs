/** Event link (E2, wave 7): round trip, malformed input, size cap, and no person data in the payload. */
import { decodeEventLink, encodeEventLink, linkOrigin } from '../../src/event_link.ts'
import { applyHostLink, joinEvent, newEvent } from '../../src/events.ts'

const ORIGIN = 'https://app.trustweb.one'
const ev = newEvent({ name: 'Forum Südtirol', from: '2026-10-12', to: '2026-10-14', where: 'Innsbruck', conditions: 'Bring a dish', themes: ['trust', 'commons'], organizer: 'Anna Gruber' }, 'e1', 5)
const hashOf = (obj) => '#ev=' + Buffer.from(JSON.stringify(obj)).toString('base64url')

describe('event link', () => {
  it('round trips the event fields, umlauts included', () => {
    const link = encodeEventLink(ev, ORIGIN, 'peer')
    expect(link.startsWith(`${ORIGIN}/#ev=`)).toBe(true)
    expect(decodeEventLink(link.slice(ORIGIN.length + 1))).toEqual({
      kind: 'peer', id: 'e1', name: 'Forum Südtirol', from: '2026-10-12', to: '2026-10-14', where: 'Innsbruck', conditions: 'Bring a dish', themes: ['trust', 'commons'], organizer: 'Anna Gruber',
    })
  })

  it('a host link rides in #ev_host= and a peer link in #ev=; both decode', () => {
    const host = encodeEventLink(ev, ORIGIN, 'host')
    const peer = encodeEventLink(ev, ORIGIN, 'peer')
    expect(host.startsWith(`${ORIGIN}/#ev_host=`)).toBe(true)
    expect(peer.startsWith(`${ORIGIN}/#ev=`)).toBe(true)
    expect(decodeEventLink(host.slice(ORIGIN.length + 1))?.kind).toBe('host')
    expect(decodeEventLink(peer.slice(ORIGIN.length + 1))?.kind).toBe('peer')
  })

  it('carries no attendance, tag or person data', () => {
    const tagged = { ...ev, attended: true, fromLink: true, people: ['p1'], attendees: [{ name: 'Ben Huber' }] }
    const json = Buffer.from(encodeEventLink(tagged, ORIGIN, 'peer').split(/#ev=/)[1], 'base64url').toString()
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['conditions', 'from', 'id', 'kind', 'name', 'organizer', 'themes', 'to', 'where'])
  })

  it.each([
    ['no fragment', ''],
    ['bad base64', '#ev=%%%'],
    ['bad json', '#ev=' + Buffer.from('{nope').toString('base64url')],
    ['not an object', hashOf([1])],
    ['missing name', hashOf({ kind: 'peer', id: 'a', from: '2026-10-12', where: 'x' })],
    ['missing from', hashOf({ kind: 'peer', id: 'a', name: 'n', where: 'x' })],
    ['missing id', hashOf({ kind: 'peer', name: 'n', from: '2026-10-12', where: 'x' })],
    ['invalid date', hashOf({ kind: 'peer', id: 'a', name: 'n', from: 'soon', where: 'x' })],
    ['missing kind', hashOf({ id: 'a', name: 'n', from: '2026-10-12', where: 'x' })],
    ['unknown kind', hashOf({ kind: 'cohost', id: 'a', name: 'n', from: '2026-10-12', where: 'x' })],
    ['oversize', hashOf({ kind: 'peer', id: 'a', name: 'n', from: '2026-10-12', where: 'x'.repeat(4100) })],
  ])('rejects %s', (_label, hash) => {
    expect(decodeEventLink(hash)).toBeNull()
  })
})

describe('an event without a place', () => {
  it('survives the link', () => {
    const e = newEvent({ name: 'Forum', from: '2026-10-12', where: '' }, 'e9', 5)
    expect(decodeEventLink(encodeEventLink(e, ORIGIN, 'peer').slice(ORIGIN.length + 1))).toMatchObject({ id: 'e9', where: '' })
  })
})

describe('joinEvent', () => {
  const decode = (e, kind) => decodeEventLink(encodeEventLink(e, ORIGIN, kind).slice(ORIGIN.length + 1))
  const linked = decode(ev, 'peer')
  const state = () => ({ people: [] })

  it('adds the event attended, from a link, with the same id', () => {
    const s = state()
    expect(joinEvent(s, linked, 9)).toBe('e1')
    const { kind: _k, ...rest } = linked
    expect(s.events).toEqual([{ ...rest, createdAt: 9, attended: true, fromLink: true }])
  })

  it('leaves an event already held as it is', () => {
    const s = state()
    s.events = [{ ...ev, attended: false }]
    joinEvent(s, linked, 9)
    expect(s.events).toEqual([{ ...ev, attended: false }])
  })
})

describe('host link', () => {
  const decode = (e, kind) => decodeEventLink(encodeEventLink(e, ORIGIN, kind).slice(ORIGIN.length + 1))
  const hosted = newEvent({ name: 'Forum Südtirol', from: '2026-10-12', where: 'Innsbruck', hosts: ['Anna Gruber', 'Ben Huber'] }, 'e2', 5)
  const named = { ...hosted, tagName: 'Forum 26', hostNamesTags: false }
  const held = (extra = {}) => ({ people: [], events: [{ ...hosted, ...extra }] })

  it('round trips kind, hosts, hostNamesTags and tagName', () => {
    expect(decode(named, 'host')).toMatchObject({ kind: 'host', hosts: ['Anna Gruber', 'Ben Huber'], hostNamesTags: false, tagName: 'Forum 26' })
    expect(decode(hosted, 'peer')).toMatchObject({ kind: 'peer', hosts: ['Anna Gruber', 'Ben Huber'] })
    expect(decode(hosted, 'host').tagName).toBeUndefined()
  })

  it('a new join stores hosts, hostNamesTags and tagName from the link', () => {
    const s = { people: [] }
    joinEvent(s, decode(named, 'host'), 9)
    expect(s.events[0]).toMatchObject({ hosts: ['Anna Gruber', 'Ben Huber'], hostNamesTags: false, tagName: 'Forum 26', fromLink: true })
    expect(s.events[0].kind).toBeUndefined()
  })

  it('a host link names the tag of an event I hold', () => {
    const s = held()
    applyHostLink(s, decode({ ...hosted, tagName: 'Forum 26' }, 'host'))
    expect(s.events[0].tagName).toBe('Forum 26')
  })

  it('a peer link never changes a tag name I hold', () => {
    const s = held({ tagName: 'Mine' })
    applyHostLink(s, decode({ ...hosted, tagName: 'Forum 26' }, 'peer'))
    expect(s.events[0].tagName).toBe('Mine')
  })

  it('tagLocked wins, and so does hostNamesTags = false', () => {
    const locked = held({ tagName: 'Mine', tagLocked: true })
    applyHostLink(locked, decode({ ...hosted, tagName: 'Forum 26' }, 'host'))
    expect(locked.events[0].tagName).toBe('Mine')
    const closed = held({ hostNamesTags: false })
    applyHostLink(closed, decode({ ...hosted, tagName: 'Forum 26' }, 'host'))
    expect(closed.events[0].tagName).toBeUndefined()
  })
})

describe('link origin', () => {
  it('keeps the three production hosts', () => {
    for (const o of ['https://app.idea2.site', 'https://app.trustintheweb.org', 'https://app.trustweb.one']) expect(linkOrigin(o)).toBe(o)
  })

  it('sends local, dev slot and LAN pages to the live app', () => {
    for (const o of ['http://127.0.0.1:5196', 'https://dev2.trustweb.one', 'http://192.168.1.23:5196']) expect(linkOrigin(o)).toBe('https://app.trustweb.one')
  })

  it('decoding ignores the origin', () => {
    const link = encodeEventLink(ev, 'http://127.0.0.1:5196', 'peer')
    expect(decodeEventLink(link.slice(link.indexOf('/#') + 1))).toEqual(decodeEventLink(encodeEventLink(ev, ORIGIN, 'peer').slice(ORIGIN.length + 1)))
  })
})
