// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { clipToVisible } from '../../src/dev_pointer.ts'

const box = (left, top, right, bottom) => ({ left, top, right, bottom })
const view = box(0, 0, 400, 800)

describe('clipToVisible', () => {
  it('keeps a target fully inside the viewport', () => {
    expect(clipToVisible(box(10, 10, 100, 50), [view])).toEqual(box(10, 10, 100, 50))
  })
  it('crops a target that sticks out of a clip box', () => {
    expect(clipToVisible(box(300, 700, 500, 900), [view])).toEqual(box(300, 700, 400, 800))
  })
  it('returns null for a target wholly outside the viewport (pointer must not be drawn)', () => {
    expect(clipToVisible(box(10, 900, 100, 950), [view])).toBeNull()
    expect(clipToVisible(box(-200, 10, -5, 50), [view])).toBeNull()
  })
  it('returns null for a target scrolled out of an overflow ancestor', () => {
    expect(clipToVisible(box(10, 300, 100, 340), [box(0, 0, 400, 200), view])).toBeNull()
  })
  it('returns null for an empty box', () => {
    expect(clipToVisible(box(10, 10, 10, 10), [view])).toBeNull()
  })
})
