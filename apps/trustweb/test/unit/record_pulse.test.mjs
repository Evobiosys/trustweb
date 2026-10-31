// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { recordTabGlyph, RECORD_TAB_GLYPH } from '../../src/record_glyph.ts'
import { recStartNext, recStartFailure } from '../../src/record_start.ts'
import { S } from '../../src/strings.ts'

describe('record tab glyph', () => {
  it('defaults to the pulse', () => expect(RECORD_TAB_GLYPH).toBe('pulse'))
  it('pulse: pulses only on the solo recorder while not recording', () => {
    expect(recordTabGlyph('pulse', { live: false, solo: true, onRecord: true })).toEqual({ glyph: 'mic', pulse: true })
    expect(recordTabGlyph('pulse', { live: true, solo: true, onRecord: true })).toEqual({ glyph: 'mic', pulse: false })
    expect(recordTabGlyph('pulse', { live: false, solo: true, onRecord: false })).toEqual({ glyph: 'mic', pulse: false })
    expect(recordTabGlyph('pulse', { live: false, solo: false, onRecord: true })).toEqual({ glyph: 'mic', pulse: false })
  })
  it('solo-mic keeps the wave-26 behaviour: person with microphone while recording solo', () => {
    expect(recordTabGlyph('solo-mic', { live: true, solo: true, onRecord: true })).toEqual({ glyph: 'solo', pulse: false })
    expect(recordTabGlyph('solo-mic', { live: false, solo: true, onRecord: true })).toEqual({ glyph: 'mic', pulse: false })
  })
})

describe('record start state machine', () => {
  it('idle -> requesting -> recording', () => {
    expect(recStartNext('idle', 'tap')).toBe('requesting')
    expect(recStartNext('requesting', 'granted')).toBe('recording')
  })
  it('requesting -> denied, then a tap asks again', () => {
    expect(recStartNext('requesting', 'rejected')).toBe('denied')
    expect(recStartNext('denied', 'tap')).toBe('requesting')
  })
  it('a second tap while requesting changes nothing; stop returns to idle', () => {
    expect(recStartNext('requesting', 'tap')).toBe('requesting')
    expect(recStartNext('recording', 'stopped')).toBe('idle')
  })
  it('names the failure honestly', () => {
    expect(recStartFailure({ name: 'NotAllowedError' })).toBe(S.recDenied)
    expect(recStartFailure({ name: 'NotFoundError' })).toBe(S.recNoMic)
    expect(recStartFailure(new Error('x'))).toBe(S.recDenied)
    expect(S.recDenied).toContain('allow it in the browser settings')
  })
})
