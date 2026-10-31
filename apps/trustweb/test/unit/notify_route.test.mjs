// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { route } from '../../src/notify_route.ts'
import { NOTIFY_KINDS } from '../../src/notify_kinds.ts'
import { addReminder, dismissReminder, remindersWaiting } from '../../src/reminders_inbox.ts'

describe('notify_route', () => {
  it('sends each kind to its screen', () => {
    expect(route('chat')).toBe('chat')
    expect(route('ask')).toBe('inventory')
    expect(route('connect')).toBe('web')
    expect(route('reminder')).toBe('events')
  })
  it('has a home for every kind', () => {
    for (const k of NOTIFY_KINDS) expect(route(k)).toBeTruthy()
  })
})

describe('reminders_inbox', () => {
  it('collects a reminder once and lets it go', () => {
    const r = { title: 'Call Anna', openLabel: 'Open', onOpen: () => {} }
    addReminder(r)
    addReminder({ ...r })
    expect(remindersWaiting()).toHaveLength(1)
    dismissReminder(r)
    expect(remindersWaiting()).toHaveLength(0)
  })
})
