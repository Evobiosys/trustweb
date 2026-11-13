// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 web-zoom-dots: an overlay (ring card, menu) re-clamps into the clip and above the bottom bar after every zoom. */
import { BAR_GAP, fitInto, floorOf } from '../../src/overlay_fit.ts'

const clip = { left: 0, top: 100, right: 360, bottom: 700 }
const box = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h })
describe('fitInto', () => {
  it('a card inside stays put', () => expect(fitInto(box(20, 150, 200, 100), clip, 690)).toEqual({ dx: 0, dy: 0 }))
  it('a card past the right edge moves left', () => expect(fitInto(box(250, 150, 200, 100), clip, 690)).toEqual({ dx: -90, dy: 0 }))
  it('a card left of the clip moves right', () => expect(fitInto(box(-30, 150, 200, 100), clip, 690)).toEqual({ dx: 30, dy: 0 }))
  it('a card under the bottom bar moves up to bar top - 8', () => expect(fitInto(box(20, 640, 200, 100), clip, 690)).toEqual({ dx: 0, dy: -(740 - 682) }))
  it('without a bar the clip bottom is the limit', () => expect(fitInto(box(20, 650, 200, 100), clip, null)).toEqual({ dx: 0, dy: -50 }))
  it('a card higher than the room is top-aligned (its title stays reachable)', () => expect(fitInto(box(20, 300, 200, 900), clip, 690)).toEqual({ dx: 0, dy: -200 }))
  it('a card wider than the clip is left-aligned', () => expect(fitInto(box(40, 150, 500, 100), clip, 690)).toEqual({ dx: -40, dy: 0 }))
  it('a bar above the clip bottom beats the clip bottom', () => expect(fitInto(box(20, 600, 200, 80), clip, 600).dy).toBe(-(680 - 592)))
})

// Review wave 42 (P06): at k = 4 the open ring card ran under the floating "Ask your web" button (screen web-zoom-dots-360-card-k4.png).
describe('floorOf: the bar and any floating button under the card', () => {
  const card = { left: 10, top: 100, right: 350, bottom: 700 }
  it('a floating button the card spans horizontally lowers the floor to its top', () => {
    expect(floorOf(card, 694, [{ left: 208, top: 624, right: 344, bottom: 676 }])).toBe(624)
  })
  it('a button beside the card (no horizontal overlap) and an absent button change nothing', () => {
    expect(floorOf({ ...card, right: 150 }, 694, [{ left: 208, top: 624, right: 344, bottom: 676 }])).toBe(694)
    expect(floorOf(card, 694, [])).toBe(694)
    expect(floorOf(card, null, [])).toBeNull()
  })
  it('fitInto with that floor lifts the card above the button', () => {
    const { dy } = fitInto({ left: 10, top: 300, right: 350, bottom: 640 }, { left: 0, top: 160, right: 360, bottom: 694 }, floorOf(card, 694, [{ left: 208, top: 624, right: 344, bottom: 676 }]))
    expect(640 + dy).toBeLessThanOrEqual(624 - BAR_GAP)
  })
})
