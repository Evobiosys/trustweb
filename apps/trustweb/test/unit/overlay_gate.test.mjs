// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { DWELL_MOVE_PX, OVERLAY_DWELL_MS, overlayAllowed, restedAt } from '../../src/overlay_gate.ts'

describe('overlay gate (overlay_gate.ts)', () => {
  it('dwell is 300 ms', () => expect(OVERLAY_DWELL_MS).toBe(300))
  it('never while a dot is lifted, however long the pointer rests', () => {
    expect(overlayAllowed({ dragging: true, dwellMs: 0 })).toBe(false)
    expect(overlayAllowed({ dragging: true, dwellMs: 5000 })).toBe(false)
  })
  it('opens only after the dwell', () => {
    expect(overlayAllowed({ dragging: false, dwellMs: 100 })).toBe(false)
    expect(overlayAllowed({ dragging: false, dwellMs: 299 })).toBe(false)
    expect(overlayAllowed({ dragging: false, dwellMs: 300 })).toBe(true)
    expect(overlayAllowed({ dragging: false, dwellMs: 350 })).toBe(true)
  })
  it('a move of 6 px or more restarts the rest', () => {
    expect(DWELL_MOVE_PX).toBe(6)
    expect(restedAt({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true)
    expect(restedAt({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(false)
  })
})
