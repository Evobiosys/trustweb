// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29 chat-switch: the Chat header carries the messenger switch in the slot where Web keeps its eye. */
import { headerControls } from '../../src/header_controls.ts'

describe('chat switch', () => {
  it('orders the Chat header: switch, QR, settings (the switch before the pins)', () => {
    const order = headerControls('chat')
    expect(order.filter((c) => ['switch', 'qr', 'settings'].includes(c))).toEqual(['switch', 'qr', 'settings'])
    expect(order.indexOf('switch')).toBeLessThan(order.indexOf('pins'))
  })
  it('keeps the eye (views) off Chat and the switch off every other screen', () => {
    expect(headerControls('chat')).not.toContain('views')
    for (const s of ['web', 'events', 'inventory']) expect(headerControls(s)).not.toContain('switch')
  })
})
