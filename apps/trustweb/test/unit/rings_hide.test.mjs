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
  it('dims a hidden ring guide unless a person is being dragged', () => {
    expect(guideDimmed(true, false)).toBe(true)
    expect(guideDimmed(true, true)).toBe(false)
    expect(guideDimmed(false, false)).toBe(false)
  })
})
