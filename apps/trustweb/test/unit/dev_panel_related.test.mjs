// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { relatedRows, stepCardPlace } from '../../src/dev_preview_rules.ts'

const f = (key, extra = {}) => ({ key, branch: 'b/' + key, title: key, requires: [], checked: true, ...extra })

describe('relatedRows', () => {
  it('follows requires in both directions', () => {
    const rows = [f('a'), f('b', { requires: ['a'] }), f('c')]
    expect(relatedRows(rows, 'a')).toEqual(['b'])
    expect(relatedRows(rows, 'b')).toEqual(['a'])
    expect(relatedRows(rows, 'c')).toEqual([])
  })
  it('matches the same context', () => {
    const rows = [f('a', { context: 'X' }), f('b', { context: 'X' }), f('c', { context: 'Y' }), f('d')]
    expect(relatedRows(rows, 'a')).toEqual(['b'])
    expect(relatedRows(rows, 'd')).toEqual([])
  })
  it('matches a common where or selector root, not the row itself', () => {
    const rows = [f('a', { selector: '.card .x' }), f('b', { selector: '.card > .y' }), f('c', { selector: '.other .x' }), f('d', { where: 'Chat' }), f('e', { where: 'Chat' })]
    expect(relatedRows(rows, 'a')).toEqual(['b'])
    expect(relatedRows(rows, 'd')).toEqual(['e'])
  })
  it('unknown key gives nothing', () => { expect(relatedRows([f('a')], 'zz')).toEqual([]) })
})

describe('stepCardPlace', () => {
  const t = (l, tp, w, h) => ({ left: l, top: tp, right: l + w, bottom: tp + h, width: w, height: h })
  it('without a phone frame sits below the target, inside the viewport', () => {
    const p = stepCardPlace(null, t(600, 300, 200, 40), 90, 1440, 900)
    expect(p.top).toBe(348); expect(p.left).toBe(600); expect(p.width).toBe(320)
  })
  it('goes above when below does not fit', () => {
    const p = stepCardPlace(null, t(100, 850, 200, 40), 90, 1440, 900)
    expect(p.top).toBe(850 - 8 - 90)
  })
  it('clamps to the viewport on a phone width', () => {
    const p = stepCardPlace(null, t(300, 100, 80, 40), 90, 390, 844)
    expect(p.width).toBe(320); expect(p.left).toBe(62)
  })
  it('keeps the phone-frame placement when a frame exists', () => {
    const p = stepCardPlace(t(500, 20, 390, 800), t(520, 100, 100, 30), 90, 1440, 900)
    expect(p.left).toBe(508); expect(p.width).toBe(374); expect(p.bottom).toBe(900 - 820 + 8)
  })
})
