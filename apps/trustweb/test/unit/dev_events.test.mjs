/** Dev-only events memory (src/dev_events.ts): the merge of the side file into a record, and the seed path keeping them. */
import { mergeDevEvents, pickDevEvents } from '../../src/dev_events.ts'
import { seedDevRecord } from '../../src/dev_record.ts'

const ev = (id) => ({ id, name: id, from: '2026-10-01', where: 'Wien', createdAt: 1, attended: true })
const rec = (extra = {}) => ({ v: 1, me: { id: 'x', displayName: 'J' }, people: [{ id: 'p1', name: 'Anna Huber' }, { id: 'p2', name: 'Ben Gruber' }], peers: [], inventory: [], log: [], notificationsOn: false, ...extra })

describe('mergeDevEvents', () => {
  it('adds a new event and a tag on a known person', () => {
    const s = rec()
    expect(mergeDevEvents(s, { events: [ev('e1')], people: { p1: ['e1'] } })).toBe(true)
    expect(s.events.map((e) => e.id)).toEqual(['e1'])
    expect(s.people[0].events).toEqual(['e1'])
  })
  it('leaves a known event and a known tag alone: nothing changed -> false', () => {
    const s = rec({ events: [ev('e1')] })
    s.people[0].events = ['e1']
    expect(mergeDevEvents(s, { events: [ev('e1')], people: { p1: ['e1'] } })).toBe(false)
    expect(s.people[0].events).toEqual(['e1'])
  })
  it('drops a tag on an unknown person', () => {
    const s = rec()
    expect(mergeDevEvents(s, { events: [], people: { nobody: ['e1'] } })).toBe(false)
    expect(s.people.every((p) => !p.events)).toBe(true)
  })
})

describe('seed keeps events', () => {
  it('a changed seed replaces the record but keeps its events and tags', () => {
    const seed = JSON.stringify(rec())
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text: seed })
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) })
    seedDevRecord('me')
    const mine = JSON.parse(store.get('trustweb.v1.me'))
    mine.events = [ev('e1')]
    mine.people[1].events = ['e1']
    store.set('trustweb.v1.me', JSON.stringify(mine))
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text: seed.replace('"J"', '"Jakob"') })
    seedDevRecord('me')
    const now = JSON.parse(store.get('trustweb.v1.me'))
    expect(now.me.displayName).toBe('Jakob')
    expect(now.events.map((e) => e.id)).toEqual(['e1'])
    expect(pickDevEvents(now).people).toEqual({ p2: ['e1'] })
    vi.unstubAllGlobals()
  })
})
