// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 chat-row: which service the Chat button opens (chat_row.ts). */
import { chatServices, pickService, noteUsed, togglePin, TRUSTWEB } from '../../src/chat_row.ts'

const person = { id: 'p1', peerId: 'x', channels: { signal: '+436601234567' }, theirChannels: { matrix: '@a:b.org' }, links: { other: 'https://example.org/a', whatsapp: 'https://wa.me/4366' } }

describe('chat services', () => {
  it('lists TrustWeb first for a connected person, then channels, then typed links', () => {
    expect(chatServices(person).map((s) => s.id)).toEqual([TRUSTWEB, 'ch:signal', 'ch:matrix', 'link:whatsapp', 'link:other'])
  })
  it('an unconnected person has no TrustWeb entry; a link kind already a channel is not listed twice', () => {
    const p = { id: 'p2', channels: { whatsapp: '+436601234567' }, links: { whatsapp: 'https://wa.me/1' } }
    expect(chatServices(p).map((s) => s.id)).toEqual(['ch:whatsapp'])
  })
  it('external entries carry an https link; TrustWeb carries none', () => {
    const [tw, sig] = chatServices(person)
    expect(tw.url).toBeUndefined()
    expect(sig.url).toBe('https://signal.me/#p/+436601234567')
  })
})

describe('pickService', () => {
  const svc = chatServices(person)
  it('no prefs: the first service', () => expect(pickService(svc, undefined)?.id).toBe(TRUSTWEB))
  it('the most recently used wins', () => {
    expect(pickService(svc, { lastUsed: { 'ch:signal': 5, 'ch:matrix': 9 } })?.id).toBe('ch:matrix')
  })
  it('a pinned service beats recency', () => {
    expect(pickService(svc, { pinned: 'ch:signal', lastUsed: { 'ch:matrix': 9 } })?.id).toBe('ch:signal')
  })
  it('a pin or use of a service no longer linked is ignored', () => {
    expect(pickService(svc, { pinned: 'ch:telegram', lastUsed: { 'ch:gone': 99 } })?.id).toBe(TRUSTWEB)
  })
  it('nothing linked: null', () => expect(pickService([], {})).toBeNull())
})

describe('prefs updates', () => {
  it('noteUsed stamps the service for that person only', () => {
    const s = {}
    noteUsed(s, 'p1', 'ch:signal', 7)
    expect(s.chatPrefs).toEqual({ p1: { lastUsed: { 'ch:signal': 7 } } })
  })
  it('togglePin pins, then unpins and drops empty prefs', () => {
    const s = {}
    togglePin(s, 'p1', 'ch:signal')
    expect(s.chatPrefs.p1.pinned).toBe('ch:signal')
    togglePin(s, 'p1', 'ch:matrix')
    expect(s.chatPrefs.p1.pinned).toBe('ch:matrix')
    togglePin(s, 'p1', 'ch:matrix')
    expect(s.chatPrefs).toBeUndefined()
  })
})
