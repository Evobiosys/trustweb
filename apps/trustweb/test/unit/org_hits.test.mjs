/** Organizer counters (wave 8): one anonymous POST per milestone, once each, errors swallowed. */
import { hit } from '../../src/org_hits.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { joinEvent, newEvent, tagPerson } from '../../src/events.ts'

const SRV = '0123456789abcdef'
const ORIGIN = 'https://app.trustweb.one'
const ev = newEvent({ name: 'Forum Südtirol', from: '2026-10-12', where: 'Innsbruck' }, 'e1', 5)

describe('org hit', () => {
  it('posts event and kind only, keepalive', () => {
    const calls = []
    hit((u, i) => { calls.push([u, i]); return Promise.resolve() }, SRV, 'opened')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('/org/hit')
    expect(calls[0][1].method).toBe('POST')
    expect(calls[0][1].keepalive).toBe(true)
    expect(JSON.parse(calls[0][1].body)).toEqual({ event: SRV, kind: 'opened' })
  })

  it('swallows a rejected and a throwing fetch', () => {
    hit(() => Promise.reject(new Error('offline')), SRV, 'joined')
    expect(() => hit(() => { throw new Error('boom') }, SRV, 'tagged')).not.toThrow()
  })
})

describe('srv in the link', () => {
  it('rides beside the payload and survives a re-encode', () => {
    const link = encodeEventLink({ ...ev, srv: SRV }, ORIGIN, 'host')
    expect(link.endsWith(`&srv=${SRV}`)).toBe(true)
    const back = decodeEventLink(link.slice(ORIGIN.length + 1))
    expect(back?.srv).toBe(SRV)
    expect(encodeEventLink(back, ORIGIN, 'peer').endsWith(`&srv=${SRV}`)).toBe(true)
  })

  it('is ignored unless 16 hex, and absent without it', () => {
    const base = encodeEventLink(ev, ORIGIN, 'host')
    expect(decodeEventLink(base.slice(ORIGIN.length + 1))?.srv).toBeUndefined()
    expect(decodeEventLink(base.slice(ORIGIN.length + 1) + '&srv=XYZ')?.srv).toBeUndefined()
    expect(base.includes('srv=')).toBe(false)
  })
})

describe('hits from the model', () => {
  const state = () => ({ people: [{ id: 'p1' }, { id: 'p2' }], events: [] })
  let calls
  beforeEach(() => { calls = []; globalThis.fetch = (u, i) => { calls.push(JSON.parse(i.body).kind); return Promise.resolve() } })

  it('joined once, tagged once, a link without srv sends nothing', () => {
    const s = state()
    const linked = { ...decodeEventLink(encodeEventLink({ ...ev, srv: SRV }, ORIGIN, 'host').slice(ORIGIN.length + 1)) }
    joinEvent(s, linked, 1)
    joinEvent(s, linked, 2)
    tagPerson(s, 'p1', 'e1')
    tagPerson(s, 'p2', 'e1')
    expect(calls).toEqual(['joined', 'tagged'])
    expect(s.events[0].hitTagged).toBe(true)
    const t = state()
    joinEvent(t, { ...decodeEventLink(encodeEventLink(ev, ORIGIN, 'peer').slice(ORIGIN.length + 1)) }, 1)
    tagPerson(t, 'p1', 'e1')
    expect(calls).toEqual(['joined', 'tagged'])
  })
})
