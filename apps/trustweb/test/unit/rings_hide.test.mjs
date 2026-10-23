/** Per-ring hide toggles of the Web rings (src/rings_hide.ts): parse/serialize, toggle, visible-people filter, guide ring state. */
import { guideDimmed, parseHidden, serializeHidden, toggleHidden, visiblePeople } from '../../src/rings_hide.ts'

const people = [{ id: 'a', ring: 'close' }, { id: 'b', ring: 'friend' }, { id: 'c', ring: 'close' }]

describe('rings hide', () => {
  it('toggles a ring on and off without touching the input', () => {
    const none = new Set()
    const one = toggleHidden(none, 'close')
    expect([...one]).toEqual(['close'])
    expect(none.size).toBe(0)
    expect(toggleHidden(one, 'close').size).toBe(0)
  })
  it('round-trips through storage and ignores garbage', () => {
    expect([...parseHidden(serializeHidden(new Set(['close', 'friend'])))].sort()).toEqual(['close', 'friend'])
    for (const bad of [null, '', 'x', '{"a":1}', '[1,"close"]']) expect(parseHidden(bad).size).toBeLessThanOrEqual(1)
    expect([...parseHidden('[1,"close"]')]).toEqual(['close'])
  })
  it('drops the people of hidden rings', () => {
    expect(visiblePeople(people, new Set(['close']), (p) => p.ring).map((p) => p.id)).toEqual(['b'])
    expect(visiblePeople(people, new Set(), (p) => p.ring)).toHaveLength(3)
  })
  it('hides a person only with THEIR ring: missing, unsorted, none, suggested and intending rings stay apart', () => {
    const all = [{ id: 'c' , ring: 'close' }, { id: 'i', ring: 'intending' }, { id: 'u', ring: 'unsorted' }, { id: 'n', ring: undefined }, { id: 'x', ring: 'none' }, { id: 's', ring: 'friend', ringSuggested: 'close' }]
    const left = (h) => visiblePeople(all, new Set(h)).map((p) => p.id).join('')
    expect(left(['intending'])).toBe('cunxs')
    expect(left(['unsorted'])).toBe('ci')
    expect(left(['friend'])).toBe('ciunxs')
    expect(left(['close', 'intending', 'unsorted'])).toBe('')
  })
  it('dims a hidden ring guide unless a person is being dragged', () => {
    expect(guideDimmed(true, false)).toBe(true)
    expect(guideDimmed(true, true)).toBe(false)
    expect(guideDimmed(false, false)).toBe(false)
  })
})

import { togglePoint } from '../../src/rings_hide.ts'
test('ring toggles fan out so near-equal radii never overlap (Jakob 20:05: pressing Intending hid the whole web)', () => {
  const C = 176, k = 1
  const a = togglePoint(0, 160, C, k), b = togglePoint(1, 166, C, k)
  assert.ok(Math.hypot(a.left - b.left, a.top - b.top) > 22, `distance ${Math.hypot(a.left - b.left, a.top - b.top)}`)
  const first = togglePoint(0, 100, C, k)
  assert.deepEqual([Math.round(first.left), Math.round(first.top)], [C, C - 100])
})
