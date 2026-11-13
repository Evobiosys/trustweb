// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 D1: after an in-person connect (QR / pasted code link) the person card shows "Message on Signal" when the other side shared a phone number, and no link when not. */
import { contactFragment, parsePersonShare, shareOfLink } from '../../src/person_share_link.ts'
import { mergeContact, sharedReachables } from '../../src/contact_share.ts'
import { Channel } from '../../src/model.ts'

const NUMBER = '+436601234567'
const TICK = { shareOnConnect: { [Channel.Signal]: true } }

/** What the card builder reads: the person's shared channels after the connect merged them. */
const cardLinks = (link) => {
  const person = { channels: {} }
  const share = shareOfLink(link)
  if (share?.contact) mergeContact(person, share.contact, 1)
  return sharedReachables(person)
}

describe('D1 in-person contact in the QR / code link fragment', () => {
  it('a ticked phone number rides in the fragment and the card gets the Signal link', () => {
    const frag = contactFragment({ [Channel.Signal]: NUMBER }, TICK)
    expect(frag).toContain('signal=')
    expect(parsePersonShare(`#${frag}`)?.contact?.channels[Channel.Signal]).toBe(NUMBER)
    const links = cardLinks(`https://app.example.test/c/ABCDEFGHIJKLMNOPQRSTUV#${frag}`)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ channel: Channel.Signal, link: 'https://signal.me/#p/+436601234567', source: 'theirs' })
  })
  it('a number that is saved but not ticked never travels', () => {
    expect(contactFragment({ [Channel.Signal]: NUMBER }, undefined)).toBe('')
    expect(contactFragment({ [Channel.Signal]: NUMBER }, { shareOnConnect: { [Channel.Signal]: false } })).toBe('')
  })
  it('no number shared: no link on the card', () => {
    expect(contactFragment(undefined, TICK)).toBe('')
    expect(cardLinks('https://app.example.test/c/ABCDEFGHIJKLMNOPQRSTUV')).toEqual([])
    expect(cardLinks('https://app.example.test/c/ABCDEFGHIJKLMNOPQRSTUV#n=hello')).toEqual([])
  })
  it('shareOfLink reads only the fragment of a pasted link; plain codes and junk give null', () => {
    expect(shareOfLink('ABCDEFGHIJKLMNOPQRSTUV')).toBeNull()
    expect(shareOfLink('not a link #signal=nonsense')).toBeNull()
  })
})
