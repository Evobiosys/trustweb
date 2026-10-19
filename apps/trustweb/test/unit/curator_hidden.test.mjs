/** Wave 16 bug 6: a person the Web Curator hid stays off the rings even while the record holds them (dev seed, device sync). */
import { curatorHiddenIds } from '../../src/curator.ts'
import { Ring } from '../../src/model.ts'
import { shown } from '../../src/sources.ts'

const person = (id, name) => ({ id, name, context: '', ring: Ring.Friend, metAt: 0, lines: [] })
const record = () => ({ v: 1, me: { id: 'me', displayName: 'Me' }, peers: [], people: [person('a', 'Ada'), person('tana-x', 'tester100'), person('b', 'Ben')], inventory: [], log: [], notificationsOn: false })

describe('Curator-hidden people leave the rings', () => {
  afterEach(() => { delete globalThis.localStorage })

  it('shown() drops the hidden ids, keeps the record intact', () => {
    const s = record()
    expect(shown(s, new Set(['tana-x'])).people.map((p) => p.name)).toEqual(['Ada', 'Ben'])
    expect(s.people).toHaveLength(3)
    expect(shown(s)).toBe(s)
  })

  it('curatorHiddenIds() reads the Curator store key without its chunk; junk or none: empty', () => {
    const store = { 'trustweb-crm.v1.me': JSON.stringify({ hiddenPeople: [{ id: 'tana-x', name: 'tester100' }, { id: 7 }] }) }
    globalThis.localStorage = { getItem: (k) => store[k] ?? null }
    expect([...curatorHiddenIds()]).toEqual(['tana-x'])
    expect(shown(record(), curatorHiddenIds()).people.map((p) => p.name)).toEqual(['Ada', 'Ben'])
    store['trustweb-crm.v1.me'] = '{bad'
    expect(curatorHiddenIds().size).toBe(0)
    delete globalThis.localStorage
    expect(curatorHiddenIds().size).toBe(0)
  })
})
