// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { settingsOrder, sectionOfScreen } from '../../src/settings_sections.ts'

const ROW = ['web', 'chat', 'record', 'events', 'inventory']

describe('settingsOrder', () => {
  it('Events first, then the bottom bar left to right, general last', () => {
    expect(settingsOrder('events', ROW)).toEqual(['events', 'web', 'chat', 'record', 'inventory', 'general'])
  })
  it('Web first keeps the bar order', () => {
    expect(settingsOrder('web', ROW)).toEqual(['web', 'chat', 'record', 'events', 'inventory', 'general'])
  })
  it('each entry point leads with its own section', () => {
    for (const from of ['web', 'chat', 'record', 'events', 'inventory']) {
      const o = settingsOrder(from, ROW)
      expect(o[0]).toBe(from)
      expect(o.at(-1)).toBe('general')
      expect(new Set(o).size).toBe(6)
    }
  })
  it('follows a re-picked bar', () => {
    expect(settingsOrder('chat', ['record', 'chat', 'web', 'inventory'])).toEqual(['chat', 'record', 'web', 'inventory', 'events', 'general'])
  })
  it('no origin: the bar order, general last', () => {
    expect(settingsOrder(undefined, ROW)).toEqual(['web', 'chat', 'record', 'events', 'inventory', 'general'])
  })
  it('ignores bar ids that carry no settings of their own', () => {
    expect(settingsOrder('web', ['web', 'feed', 'network', 'inventory'])).toEqual(['web', 'inventory', 'chat', 'record', 'events', 'general'])
  })
})

describe('sectionOfScreen', () => {
  it('maps sub-screens to their tab', () => {
    expect(sectionOfScreen('meeting')).toBe('record')
    expect(sectionOfScreen('people')).toBe('web')
    expect(sectionOfScreen('events')).toBe('events')
    expect(sectionOfScreen('start')).toBeUndefined()
  })
})
