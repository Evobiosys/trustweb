// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 card-extend: the order of the expanded card, the one merged timeline, system vs human events. */
import { cardSections, isSystemEvent, mergedTimeline } from '../../src/card_sections.ts'
import { passesAsksOn, Ring } from '../../src/model.ts'

const person = (o = {}) => ({ id: 'p1', name: 'Anna', context: '', ring: 'close', metAt: 0, lines: [], peerId: 'pe1', ...o })
const state = (o = {}) => ({ people: [], peers: [{ id: 'pe1', connectedAt: 5_000 }], log: [], ...o })

describe('cardSections', () => {
  it('orders the expanded card as Jakob listed it, Curate last', () => {
    expect(cardSections({ connected: true, canAskLinks: true })).toEqual(['seen', 'channels', 'askLinks', 'passOn', 'knows', 'other', 'notes', 'timeline', 'curate'])
  })
  it('leaves out what a not-connected person cannot do', () => {
    const ids = cardSections({ connected: false, canAskLinks: false })
    expect(ids).not.toContain('askLinks')
    expect(ids).not.toContain('passOn')
    expect(ids.at(-1)).toBe('curate')
  })
})

describe('passes asks on by default only for the Close zone (G2)', () => {
  it.each([[Ring.Close, true], [Ring.Closest, false], [Ring.Friend, false], [Ring.Acquaintance, false], [Ring.Intending, false]])('%s: %s', (ring, want) => {
    expect(passesAsksOn({ ring })).toBe(want)
  })
  it('an explicit value always wins', () => {
    expect(passesAsksOn({ ring: Ring.Friend, passOn: true })).toBe(true)
    expect(passesAsksOn({ ring: Ring.Close, passOn: false })).toBe(false)
  })
})

describe('mergedTimeline', () => {
  it('shows the connection event once even when it is also stored on the person', () => {
    const p = person({ timeline: [{ at: 5_000, channel: 'trustweb', direction: 'both', summary: 'Connected on TrustWeb', source: 'import' }] })
    const hits = mergedTimeline(state(), p).filter((e) => e.summary === 'Connected on TrustWeb')
    expect(hits).toHaveLength(1)
  })
  it('does not show "Met: Connected on TrustWeb" next to the connection event itself', () => {
    const list = mergedTimeline(state(), person({ metAt: 4_000, context: 'Connected on TrustWeb' }))
    expect(list.map((e) => e.summary)).toEqual(['Connected on TrustWeb'])
  })
  it('is newest first and holds typed entries, own events and meetings together', () => {
    const s = state({ meetings: [{ id: 'm1', personId: 'p1', startedAt: 9_000, endedAt: 9_500 }] })
    const p = person({ timeline: [{ at: 1_000, channel: 'email', direction: 'in', summary: 'Re: garden', source: 'manual' }] })
    const list = mergedTimeline(s, p)
    expect(list.map((e) => e.at)).toEqual([9_000, 5_000, 1_000])
  })
})

describe('isSystemEvent', () => {
  it('marks the connection event, not chats or notes', () => {
    const s = state({ chats: { pe1: { unread: 0, messages: [{ dir: 'in', at: 7_000 }] } } })
    const p = person({ lines: [{ id: 'l', text: 'hi', notedAt: 6_000 }] })
    const byText = Object.fromEntries(mergedTimeline(s, p).map((e) => [e.summary, isSystemEvent(e)]))
    expect(byText['Connected on TrustWeb']).toBe(true)
    expect(byText.hi).toBe(false)
    expect(Object.values(byText).filter(Boolean)).toHaveLength(1)
  })
})
