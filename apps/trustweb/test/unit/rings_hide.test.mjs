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

import { togglePoints, TOGGLE_GAP } from '../../src/rings_hide.ts'
test('ring toggles are small: column spacing >= 16 px, diamond 12 px across (side 8.5 px), glyph 9 px', async () => {
  const css = (await import('node:fs')).readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  const rule = (sel) => css.split('\n').find((l) => l.startsWith(sel + '{')) ?? ''
  assert.ok(TOGGLE_GAP >= 16 && TOGGLE_GAP < 22, `gap ${TOGGLE_GAP}`)
  assert.match(rule('.ring-toggle::before'), /width:8\.5px; height:8\.5px/)
  assert.match(rule('.ring-toggle'), /font-size:9px/)
  assert.match(rule('.ring-toggle'), /width:16px; height:16px/)
})

test('ring toggles stand in one vertical column above "you"; equal radii are pushed apart (Jakob 20:37)', () => {
  const C = 176, k = 1
  const same = togglePoints([160, 160, 160], C, k)
  assert.deepEqual(same.map((p) => p.left), [C, C, C])
  same.slice(1).forEach((p, i) => assert.ok(same[i].top - p.top >= TOGGLE_GAP, `gap ${same[i].top - p.top}`))
  const apart = togglePoints([60, 110, 160], C, k)
  assert.deepEqual(apart.map((p) => p.top), [C - 60, C - 110, C - 160])
  assert.deepEqual(togglePoints([100, 101], C, 2).map((p) => p.top), [C - 200, C - 200 - TOGGLE_GAP])
})
