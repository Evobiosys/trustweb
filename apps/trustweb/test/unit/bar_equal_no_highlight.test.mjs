// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { ringLead } from '../../src/bottom_bar.ts'

describe('bar ring lead (wave45 bar-equal-no-highlight)', () => {
  it('equal counts: nobody wears the extra ring', () => {
    expect(ringLead({ chat: 3, events: 3 }, ['chat', 'events'])).toBeNull()
    expect(ringLead({}, ['chat', 'events'])).toBeNull()
  })
  it('a strict maximum wears it', () => {
    expect(ringLead({ chat: 5, events: 3 }, ['chat', 'events'])).toBe('chat')
    expect(ringLead({ chat: 0, events: 1 }, ['chat', 'events'])).toBe('events')
  })
  it('a tie at the top is no maximum; ids outside the group are ignored', () => {
    expect(ringLead({ chat: 4, events: 4, feed: 9 }, ['chat', 'events'])).toBeNull()
    expect(ringLead({ chat: 2 }, ['chat'])).toBeNull()
  })
})
