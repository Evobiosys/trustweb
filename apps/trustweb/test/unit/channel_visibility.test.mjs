// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Settings "Show my Signal / WhatsApp links to people who connect" (src/channel_visibility.ts): absent = shown (today's behaviour),
 * only false is stored; the switch hides Signal and WhatsApp only, and a link already sent is never taken back.
 */
import { channelShown, shownChannels, messengerLinksShown, toggleMessengerLinks } from '../../src/channel_visibility.ts'
import { answerPlan, buildContactPayload } from '../../src/contact_share.ts'
import { Channel } from '../../src/model.ts'

const MINE = { [Channel.Signal]: 'https://signal.me/#eu/abcDEF123_-xyz', [Channel.Matrix]: '@lena:matrix.org' }
const TICKS = { shareOnConnect: { [Channel.Signal]: true, [Channel.Matrix]: true } }

describe('channelShown', () => {
  it('shows every channel when the setting is absent or on', () => {
    for (const ch of Object.values(Channel)) {
      expect(channelShown(undefined, ch)).toBe(true)
      expect(channelShown(true, ch)).toBe(true)
    }
  })
  it('off hides Signal and WhatsApp only', () => {
    expect(channelShown(false, Channel.Signal)).toBe(false)
    expect(channelShown(false, Channel.WhatsApp)).toBe(false)
    expect(channelShown(false, Channel.Matrix)).toBe(true)
  })
  it('shownChannels filters a list', () => {
    expect(shownChannels(false, [Channel.Signal, Channel.Matrix])).toEqual([Channel.Matrix])
    expect(shownChannels(undefined, [Channel.Signal, Channel.Matrix])).toEqual([Channel.Signal, Channel.Matrix])
  })
})

describe('settings round trip', () => {
  it('off is stored as false, on as absent, and both survive JSON', () => {
    const s = {}
    expect(messengerLinksShown(s)).toBe(true)
    toggleMessengerLinks(s)
    expect(s.showMessengerLinks).toBe(false)
    expect(messengerLinksShown(JSON.parse(JSON.stringify(s)))).toBe(false)
    toggleMessengerLinks(s)
    expect('showMessengerLinks' in s).toBe(false)
    expect(messengerLinksShown(JSON.parse(JSON.stringify(s)))).toBe(true)
  })
})

describe('through the contact_share answer path', () => {
  it('Signal is left out when the switch is off', () => {
    const plan = answerPlan(MINE, TICKS, shownChannels(false, [Channel.Signal, Channel.Matrix]))
    expect(plan.auto).toEqual([Channel.Matrix])
    expect(plan.ask).toEqual([])
  })
  it('Signal is present when the switch is on', () => {
    expect(answerPlan(MINE, TICKS, shownChannels(true, [Channel.Signal, Channel.Matrix])).auto).toEqual([Channel.Signal, Channel.Matrix])
  })
  it('turning it off removes nothing already held by the other side (no retroactive change)', () => {
    const held = { [Channel.Signal]: MINE[Channel.Signal] }
    const next = { ...held, ...buildContactPayload('https://x/', { [Channel.Matrix]: MINE[Channel.Matrix] }, TICKS).payload.channels }
    expect(next[Channel.Signal]).toBe(MINE[Channel.Signal])
  })
})
