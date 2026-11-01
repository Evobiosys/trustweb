// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { rmsLevel, smoothLevel, pulseSpreadPx, PULSE_IDLE_PX, PULSE_MAX_PX } from '../../src/audio_level.ts'
import { recordTabGlyph } from '../../src/record_glyph.ts'
import { resolveAbout } from '../../src/record_start.ts'
import { S } from '../../src/strings.ts'
import { ICONS } from '../../src/icons.ts'

describe('audio level', () => {
  it('silence (128 = zero in a byte time-domain buffer) is level 0', () => {
    expect(rmsLevel(new Uint8Array(256).fill(128))).toBe(0)
    expect(rmsLevel(new Uint8Array(0))).toBe(0)
  })
  it('a full-scale square wave is level 1, a half-scale one 0.5', () => {
    const full = new Uint8Array(256).map((_, i) => (i % 2 ? 0 : 255))
    expect(rmsLevel(full)).toBeGreaterThan(0.99)
    const half = new Uint8Array(256).map((_, i) => (i % 2 ? 64 : 192))
    expect(rmsLevel(half)).toBeCloseTo(0.5, 1)
  })
  it('smoothing rises fast and falls slowly', () => {
    expect(smoothLevel(0, 1)).toBeGreaterThan(smoothLevel(1, 0) * 0 + 0.4)
    expect(smoothLevel(1, 0)).toBeGreaterThan(0.8)
  })
  it('spread: a small static ring when silent, grows with the level, capped', () => {
    expect(pulseSpreadPx(0)).toBe(PULSE_IDLE_PX)
    expect(pulseSpreadPx(0.1)).toBeGreaterThan(pulseSpreadPx(0.02))
    expect(pulseSpreadPx(5)).toBe(PULSE_MAX_PX)
    expect(pulseSpreadPx(Number.NaN)).toBe(PULSE_IDLE_PX)
  })
})

describe('record tab glyph (wave 28: person with waves)', () => {
  it('solo shows the person with waves at rest and while recording; a meeting keeps the mic', () => {
    expect(recordTabGlyph('person-waves', { live: false, solo: true, onRecord: true })).toEqual({ glyph: 'waves', pulse: true })
    expect(recordTabGlyph('person-waves', { live: true, solo: true, onRecord: true })).toEqual({ glyph: 'waves', pulse: false })
    expect(recordTabGlyph('person-waves', { live: false, solo: false, onRecord: true })).toEqual({ glyph: 'mic', pulse: false })
  })
})

describe('"who or what was this about" is optional', () => {
  it('an empty name becomes a plain note, never blocks', () => {
    expect(resolveAbout('', false)).toEqual({ name: '', plain: true })
    expect(resolveAbout('   ', false)).toEqual({ name: '', plain: true })
  })
  it('a name stays a name', () => expect(resolveAbout(' Ana ', false)).toEqual({ name: 'Ana', plain: false }))
})

describe('save button', () => {
  it('has a floppy-disk icon and the Save label', () => {
    expect(ICONS.save).toContain('<svg')
    expect(S.recSave).toBe('Save')
  })
})
