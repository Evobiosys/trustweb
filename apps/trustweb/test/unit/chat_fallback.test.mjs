// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { STUCK_AFTER_MS, fallbackOffers, isStuck } from '../../src/chat_fallback.ts'
import { MessageState, ChatDirection } from '../../src/chat.ts'
import { Channel } from '../../src/model.ts'

const H = 60 * 60 * 1000
const msg = (state, at = 0, dir = ChatDirection.Out) => ({ key: 'k', dir, text: 'x', at, sentAt: at, state })

describe('isStuck', () => {
  it('pending: 23 h no, 25 h yes', () => {
    expect(STUCK_AFTER_MS).toBe(24 * H)
    expect(isStuck(msg(MessageState.Pending), 23 * H)).toBe(false)
    expect(isStuck(msg(MessageState.Pending), 25 * H)).toBe(true)
  })
  it('delivered and received never', () => {
    expect(isStuck(msg(MessageState.Delivered), 99 * H)).toBe(false)
    expect(isStuck(msg(MessageState.Received, 0, ChatDirection.In), 99 * H)).toBe(false)
  })
})

describe('fallbackOffers', () => {
  const both = { [Channel.WhatsApp]: '+436601234567', [Channel.Signal]: '+436601234567' }
  it('no channel known: nothing', () => {
    expect(fallbackOffers(undefined, 'hi')).toEqual([])
    expect(fallbackOffers({ [Channel.Matrix]: '@a:b.org' }, 'hi')).toEqual([])
  })
  it('Signal first, WhatsApp second, text encoded', () => {
    expect(fallbackOffers(both, 'a b&c?\nü')).toEqual([
      { kind: 'signal', url: 'https://signal.me/#p/+436601234567' },
      { kind: 'whatsapp', url: 'https://wa.me/436601234567?text=a%20b%26c%3F%0A%C3%BC' },
    ])
  })
  it('single channels; WhatsApp share link cannot prefill', () => {
    expect(fallbackOffers({ [Channel.Signal]: 'https://signal.me/#eu/abcDEF123_-xyz' }, 'hi').map((o) => o.kind)).toEqual(['signal'])
    expect(fallbackOffers({ [Channel.WhatsApp]: 'https://wa.me/qr/ABCDEFGHIJKLM' }, 'hi')).toEqual([{ kind: 'whatsapp', url: 'https://wa.me/qr/ABCDEFGHIJKLM' }])
  })
})
