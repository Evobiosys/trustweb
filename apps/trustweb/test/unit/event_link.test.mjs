/** Event link (E2, wave 7): round trip, malformed input, size cap, and no person data in the payload. */
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { joinEvent, newEvent } from '../../src/events.ts'

const ORIGIN = 'https://app.trustweb.one'
const ev = newEvent({ name: 'Forum Südtirol', from: '2026-10-12', to: '2026-10-14', where: 'Innsbruck', conditions: 'Bring a dish', themes: ['trust', 'commons'], organizer: 'Anna Gruber' }, 'e1', 5)
const hashOf = (obj) => '#ev=' + Buffer.from(JSON.stringify(obj)).toString('base64url')

describe('event link', () => {
  it('round trips the event fields, umlauts included', () => {
    const link = encodeEventLink(ev, ORIGIN)
    expect(link.startsWith(`${ORIGIN}/#ev=`)).toBe(true)
    expect(decodeEventLink(link.slice(ORIGIN.length + 1))).toEqual({
      id: 'e1', name: 'Forum Südtirol', from: '2026-10-12', to: '2026-10-14', where: 'Innsbruck', conditions: 'Bring a dish', themes: ['trust', 'commons'], organizer: 'Anna Gruber',
    })
  })

  it('carries no attendance, tag or person data', () => {
    const tagged = { ...ev, attended: true, fromLink: true, people: ['p1'], attendees: [{ name: 'Ben Huber' }] }
    const json = Buffer.from(encodeEventLink(tagged, ORIGIN).split('#ev=')[1], 'base64url').toString()
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['conditions', 'from', 'id', 'name', 'organizer', 'themes', 'to', 'where'])
  })

  it.each([
    ['no fragment', ''],
    ['bad base64', '#ev=%%%'],
    ['bad json', '#ev=' + Buffer.from('{nope').toString('base64url')],
    ['not an object', hashOf([1])],
    ['missing name', hashOf({ id: 'a', from: '2026-10-12', where: 'x' })],
    ['missing from', hashOf({ id: 'a', name: 'n', where: 'x' })],
    ['missing where', hashOf({ id: 'a', name: 'n', from: '2026-10-12' })],
    ['missing id', hashOf({ name: 'n', from: '2026-10-12', where: 'x' })],
    ['invalid date', hashOf({ id: 'a', name: 'n', from: 'soon', where: 'x' })],
    ['oversize', hashOf({ id: 'a', name: 'n', from: '2026-10-12', where: 'x'.repeat(4100) })],
  ])('rejects %s', (_label, hash) => {
    expect(decodeEventLink(hash)).toBeNull()
  })
})

describe('joinEvent', () => {
  const linked = decodeEventLink(encodeEventLink(ev, ORIGIN).slice(ORIGIN.length + 1))
  const state = () => ({ people: [] })

  it('adds the event attended, from a link, with the same id', () => {
    const s = state()
    expect(joinEvent(s, linked, 9)).toBe('e1')
    expect(s.events).toEqual([{ ...linked, createdAt: 9, attended: true, fromLink: true }])
  })

  it('leaves an event already held as it is', () => {
    const s = state()
    s.events = [{ ...ev, attended: false }]
    joinEvent(s, linked, 9)
    expect(s.events).toEqual([{ ...ev, attended: false }])
  })
})
