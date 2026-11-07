// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { focusAfterPress, panelTitle } from '../../src/dev_preview_rules.ts'

const f = (key, branch, extra = {}) => ({ key, branch, title: key, requires: [], checked: true, ...extra })

describe('panelTitle', () => {
  it('is the preview id and the wave of the newest loaded row', () => {
    expect(panelTitle('tw1', [f('a', 'wave36/a'), f('b', 'wave37/b'), f('c', 'wave35/c')])).toBe('tw1 wave37')
  })
  it('ignores unloaded and merged rows, then falls back to any shown row, then to the id', () => {
    expect(panelTitle('tw1', [f('a', 'wave36/a'), f('b', 'wave37/b', { checked: false }), f('c', 'wave38/c', { merged: true })])).toBe('tw1 wave36')
    expect(panelTitle('tw1', [f('b', 'wave37/b', { checked: false })])).toBe('tw1 wave37')
    expect(panelTitle('tw1', [])).toBe('tw1')
    expect(panelTitle('tw1', [f('a', 'misc/a')])).toBe('tw1 misc')
  })
  it('compares wave numbers as numbers', () => {
    expect(panelTitle('x', [f('a', 'wave9/a'), f('b', 'wave10/b')])).toBe('x wave10')
  })
})

describe('focusAfterPress', () => {
  it('keeps the focused row after approve, needs work or note: no hop to the next row', () => {
    expect(focusAfterPress('a', 'a')).toBe('a')
  })
  it('a press on another row in the full list leaves the focus empty', () => {
    expect(focusAfterPress(null, 'b')).toBeNull()
  })
})
