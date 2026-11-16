// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * Wave 44 steer-people-picker-4: "+ tag" picker (existing tags + a new name), placement as segmented pills. */
import { Ring } from '../../src/model.ts'
import { SCAN_RINGS } from '../../src/scan_rules.ts'
import { placementPills } from '../../src/placement_pills.ts'
import { smallCard } from '../../src/membranes_five_view.ts'

const card = (over = {}) => smallCard({
  person: { id: 'p1', name: 'Ben', ring: 'close', lines: [], context: '', metAt: 1, fields: {} },
  zone: 'Close', tags: [], visible: { count: 0, categories: [] }, onOpenResources: () => {}, kindOf: () => '', chat: document.createElement('span'), onOpen: () => {}, onTag: () => {},
  addableTags: [{ id: 'fam', colour: '#7b1fa2', label: 'family' }], ...over,
})

describe('placement pills (item 2)', () => {
  it('one pill per scan zone in order, the current one on and aria-pressed', () => {
    const g = placementPills(Ring.Friend, () => {})
    const b = [...g.querySelectorAll('button')]
    expect(b.map((x) => x.getAttribute('data-ring'))).toEqual(SCAN_RINGS)
    expect(g.classList.contains('seg')).toBe(true)
    expect(b.filter((x) => x.classList.contains('on')).map((x) => x.getAttribute('data-ring'))).toEqual(['friend'])
    expect(b.find((x) => x.getAttribute('data-ring') === 'friend').getAttribute('aria-pressed')).toBe('true')
  })
  it('a press reports the zone and moves the mark', () => {
    const got = []
    const g = placementPills(Ring.Friend, (r) => got.push(r))
    g.querySelector('[data-ring="closest"]').click()
    expect(got).toEqual(['closest'])
    expect(g.querySelector('.on').getAttribute('data-ring')).toBe('closest')
  })
})

describe('+ tag picker (item 1)', () => {
  it('+ tag opens the picker with the existing tags and a name box', () => {
    const c = card()
    const pick = c.querySelector('[data-tag-pick]')
    expect(pick.hidden).toBe(true)
    c.querySelector('[data-tag-add]').click()
    expect(pick.hidden).toBe(false)
    expect(pick.querySelectorAll('[data-tag-choice]').length).toBe(1)
    expect(pick.querySelector('input[data-tag-new]')).not.toBeNull()
  })
  it('an existing tag chip adds that tag', () => {
    const got = []
    const c = card({ onAddTag: (id) => got.push(id) })
    c.querySelector('[data-tag-add]').click()
    c.querySelector('[data-tag-choice="fam"]').click()
    expect(got).toEqual(['fam'])
  })
  it('a new name + Enter adds it; an empty name does nothing; the box shows even with no tag defined', () => {
    const got = []
    const c = card({ addableTags: [], onNewTag: (n) => got.push(n) })
    c.querySelector('[data-tag-add]').click()
    const input = c.querySelector('input[data-tag-new]')
    input.value = '  '; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    input.value = 'Choir'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(got).toEqual(['Choir'])
  })
})
