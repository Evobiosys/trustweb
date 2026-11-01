// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b/25: Resources zoom (second press on the active tab zooms in, back zooms out). Membranes no longer zooms. */
import { ZOOM_OUT, back, itemRows, press, zoomable } from '../../src/zoom.ts'

describe('zoom levels', () => {
  it('only Resources zooms', () => {
    expect(zoomable('web')).toBe(false)
    expect(zoomable('inventory')).toBe(true)
    expect(zoomable('chat')).toBe(false)
  })
  it('the first press only opens the tab; the second press on the active tab zooms in', () => {
    expect(press('inventory', 'chat')).toEqual(ZOOM_OUT)
    expect(press('inventory', 'inventory')).toEqual({ inventory: true })
    expect(press('web', 'web')).toEqual(ZOOM_OUT)
  })
  it('a press on another tab zooms everything out; a non-zoomable tab never zooms in', () => {
    expect(press('inventory', 'web')).toEqual(ZOOM_OUT)
    expect(press('chat', 'chat')).toEqual(ZOOM_OUT)
  })
  it('back zooms out', () => {
    expect(back()).toEqual(ZOOM_OUT)
  })
})

describe('itemRows (Resources zoomed in)', () => {
  const items = [
    { id: '1', text: 'Ladder', createdAt: 1 },
    { id: '2', text: 'Apple press', createdAt: 3, context: [{ text: 'borrowed from Ben' }] },
    { id: '3', text: 'Bike pump', createdAt: 2 },
  ]
  it('newest first by default, A to Z on request', () => {
    expect(itemRows(items, '', 'new').map((i) => i.id)).toEqual(['2', '3', '1'])
    expect(itemRows(items, '', 'az').map((i) => i.id)).toEqual(['2', '3', '1'])
  })
  it('search matches the text and the notes, ignoring case', () => {
    expect(itemRows(items, 'LADD', 'new').map((i) => i.id)).toEqual(['1'])
    expect(itemRows(items, 'ben', 'new').map((i) => i.id)).toEqual(['2'])
  })
})
