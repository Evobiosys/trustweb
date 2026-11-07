// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { UNDO_SINGLE_MS, UNDO_MULTI_MS, undoMs, ringFilterShown, dragIds, ownInitial } from '../../src/select_tool.ts'

describe('select tool (select_tool.ts)', () => {
  it('a single action undoes for 5 s, a multi action for 10 s', () => {
    expect(UNDO_SINGLE_MS).toBe(5000)
    expect(UNDO_MULTI_MS).toBe(10000)
    expect(undoMs(1)).toBe(5000)
    expect(undoMs(2)).toBe(10000)
    expect(undoMs(3)).toBe(10000)
  })
  it('the trust-zone filter shows only on Network and Map', () => {
    expect(ringFilterShown('network')).toBe(true)
    expect(ringFilterShown('map')).toBe(true)
    for (const v of ['rings', 'people', 'complete', 'dex']) expect(ringFilterShown(v)).toBe(false)
  })
  it('dragging a selected dot moves every selected dot; an unselected dot moves alone', () => {
    const sel = new Set(['a', 'b', 'c'])
    expect(dragIds(sel, 'b')).toEqual(['a', 'b', 'c'])
    expect(dragIds(sel, 'z')).toEqual(['z'])
    expect(dragIds(new Set(), 'z')).toEqual(['z'])
  })
  it('the owner dot shows an initial, never the name', () => {
    expect(ownInitial('Jakob Possert')).toBe('J')
    expect(ownInitial('  élan')).toBe('É')
    expect(ownInitial('')).toBe('?')
  })
})
