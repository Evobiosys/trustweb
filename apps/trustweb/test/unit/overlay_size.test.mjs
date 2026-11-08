// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 overlay-fixes: the per-ring list card is resizable and remembers its size per ring. */
import { MIN_OVERLAY_H, MIN_OVERLAY_W, clampSize, overlayKey, parseSize, serializeSize } from '../../src/overlay_size.ts'

describe('overlay size (overlay_size.ts)', () => {
  it('keys per ring', () => expect(overlayKey('intending')).toBe('tw.overlaySize.intending'))
  it('round-trips a size', () => expect(parseSize(serializeSize({ w: 240, h: 180 }))).toEqual({ w: 240, h: 180 }))
  it('rounds to whole px', () => expect(parseSize(serializeSize({ w: 240.6, h: 180.2 }))).toEqual({ w: 241, h: 180 }))
  it('garbage or missing gives null', () => {
    for (const bad of [null, '', 'x', '{}', '{"w":"a","h":2}', '{"w":-5,"h":100}', '{"w":0,"h":100}', '[1,2]', '{"w":1e9,"h":NaN}']) expect(parseSize(bad)).toBeNull()
  })
  it('clamps to the minimum', () => expect(clampSize({ w: 10, h: 10 }, { w: 1000, h: 1000 })).toEqual({ w: MIN_OVERLAY_W, h: MIN_OVERLAY_H }))
  it('clamps to the room left in the viewport (no horizontal scroll at 360 px)', () => {
    expect(clampSize({ w: 900, h: 900 }, { w: 252, h: 302 })).toEqual({ w: 252, h: 302 })
    expect(clampSize({ w: 200, h: 200 }, { w: 252, h: 302 })).toEqual({ w: 200, h: 200 })
  })
  it('room narrower than the minimum still wins over the minimum', () => {
    expect(clampSize({ w: 300, h: 300 }, { w: 120, h: 352 }).w).toBe(120)
  })
})
