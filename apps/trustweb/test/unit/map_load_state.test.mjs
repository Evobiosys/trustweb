// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { nextMapLoad } from '../../src/map_load_state.ts'

describe('map load state', () => {
  it('starts loading and becomes ready on the first render', () => {
    expect(nextMapLoad('loading', 'loaded')).toBe('ready')
  })
  it('becomes failed when the outline cannot load', () => {
    expect(nextMapLoad('loading', 'error')).toBe('failed')
  })
  it('retry returns a failed map to loading', () => {
    expect(nextMapLoad('failed', 'retry')).toBe('loading')
  })
  it('ignores events that do not apply', () => {
    expect(nextMapLoad('ready', 'error')).toBe('ready')
    expect(nextMapLoad('ready', 'retry')).toBe('ready')
    expect(nextMapLoad('failed', 'loaded')).toBe('failed')
    expect(nextMapLoad('loading', 'retry')).toBe('loading')
  })
})
