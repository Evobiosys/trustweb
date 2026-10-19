/** Dev seed of the Network view demo connections (src/network_seed.ts). */
import { addNetworkDemo } from '../../src/network_seed.ts'
import { knowsLinks } from '../../src/network_graph.ts'
import { Ring } from '../../src/model.ts'

const p = (id, name) => ({ id, name, context: '', ring: Ring.Friend, metAt: 0, lines: [] })
const state = (names) => ({ me: { id: 'me', displayName: 'Jakob' }, people: names.map((n, i) => p('p' + i, n)) })
const pair = (s, a, b) => {
  const links = knowsLinks('me', s.people)
  const ia = a === 'me' ? 0 : s.people.findIndex((x) => x.name.startsWith(a)) + 1
  const ib = b === 'me' ? 0 : s.people.findIndex((x) => x.name.startsWith(b)) + 1
  return links.find((l) => (l[0] === ia && l[1] === ib) || (l[0] === ib && l[1] === ia))
}

describe('network demo seed', () => {
  it('Kevin, Day and me all mutual; Manuel with Kevin and me, not Day; dummies added', () => {
    const s = state(['Kevin Z', 'Day Davis Waterbury', 'Manuel Spornberger'])
    addNetworkDemo(s, 1)
    expect(s.people.map((x) => x.name)).toContain('Dummy Alpha')
    expect(pair(s, 'Kevin', 'Day')?.[2]).toBe(true)
    expect(pair(s, 'Kevin', 'me')?.[2]).toBe(true)
    expect(pair(s, 'Day', 'me')?.[2]).toBe(true)
    expect(pair(s, 'Manuel', 'Kevin')?.[2]).toBe(true)
    expect(pair(s, 'Manuel', 'me')?.[2]).toBe(true)
    expect(pair(s, 'Manuel', 'Day')).toBeUndefined()
    expect(pair(s, 'Dummy Alpha', 'Kevin')?.[2]).toBe(false)
  })

  it('skips absent names without throwing, and is idempotent', () => {
    const s = state(['Kevin'])
    addNetworkDemo(s, 1); addNetworkDemo(s, 2)
    expect(s.people.filter((x) => x.name.startsWith('Dummy'))).toHaveLength(3)
    expect(s.people[0].knows).toEqual([...new Set(s.people[0].knows)])
  })

  it('marks the dummies as demo content (state.demo), so Hide / Remove demo content reach them; existing marks and dummies are kept', () => {
    const s = state(['Kevin'])
    addNetworkDemo(s, 1)
    expect(s.demo.people.sort()).toEqual(['dummy-alpha', 'dummy-beta', 'dummy-gamma'])
    expect(s.demo.inventory).toEqual([])
    const marked = { ...state(['Kevin']), demo: { people: ['other'], inventory: ['thing'] } }
    marked.people.push({ id: 'dummy-alpha', name: 'Dummy Alpha', context: '', ring: Ring.Acquaintance, metAt: 0, lines: [] })
    expect(addNetworkDemo(marked, 1)).toBe(true)
    expect(marked.demo.people.sort()).toEqual(['dummy-alpha', 'dummy-beta', 'dummy-gamma', 'other'])
    expect(marked.demo.inventory).toEqual(['thing'])
    expect(addNetworkDemo(marked, 1)).toBe(false)
  })
})
