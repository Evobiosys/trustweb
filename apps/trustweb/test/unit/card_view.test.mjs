// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { chatButtonKind, channelEdit, isConnected } from '../../src/card_view.ts'
import { Channel } from '../../src/model.ts'

describe('card views (card_view.ts)', () => {
  it('a person is connected exactly when a peer id is set', () => {
    expect(isConnected({ peerId: 'p1' })).toBe(true)
    expect(isConnected({})).toBe(false)
    expect(isConnected({ peerId: '' })).toBe(false)
  })
  it('the Chat button chats with a connected person, else offers the connect route', () => {
    expect(chatButtonKind({ peerId: 'p1' })).toBe('chat')
    expect(chatButtonKind({})).toBe('connect')
  })
  it('a channel edit normalizes the typed value; empty clears; invalid or unchanged keeps the old', () => {
    expect(channelEdit(Channel.Signal, undefined, '+43 660 1234567')).toBe('+436601234567')
    expect(channelEdit(Channel.Signal, '+436601234567', '')).toBe('')
    expect(channelEdit(Channel.Signal, '+436601234567', '+43 660 1234567')).toBeNull()
    expect(channelEdit(Channel.Signal, '+436601234567', 'not a number')).toBeNull()
  })
})
