// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 card-small: duplicate-field list, last three timeline events, chat visibility, messenger glyphs, ring and tag edits, context without a date. */
import { DUPLICATE_FIELD_KEYS, TIMELINE_SMALL, addTagTo, chatShown, contextWithoutDate, messengerGlyphs, setMetAt, setRing, smallTimeline, tagsAddable } from '../../src/card_small.ts'
import { ownEvents } from '../../src/timeline.ts'
import { Ring } from '../../src/model.ts'

describe('duplicate fields', () => {
  it('lists the Curator fields the card already shows elsewhere: names, ring, context (timeline), tags', () => {
    expect(DUPLICATE_FIELD_KEYS).toEqual(expect.arrayContaining(['tw-first', 'tw-ring', 'tw-context']))
  })
})

describe('small timeline', () => {
  const e = (at) => ({ at, channel: 'note', direction: 'both', summary: 's' + at, source: 'manual' })
  it('shows the newest three and says whether more exist', () => {
    const all = [5, 4, 3, 2, 1].map(e)
    expect(TIMELINE_SMALL).toBe(3)
    expect(smallTimeline(all)).toEqual({ shown: all.slice(0, 3), more: true })
    expect(smallTimeline(all.slice(0, 3))).toEqual({ shown: all.slice(0, 3), more: false })
  })
})

describe('chat visibility', () => {
  it('a chat button only for a person connected on TrustWeb', () => {
    expect(chatShown({ peerId: 'x' })).toBe(true)
    expect(chatShown({})).toBe(false)
  })
})

describe('messenger glyphs', () => {
  it('solid for TrustWeb when connected, dashed for every other linked service', () => {
    const p = { id: 'p', peerId: 'x', channels: { signal: '+436601234567' }, links: { other: 'https://example.org/a' } }
    expect(messengerGlyphs(p).map((g) => [g.id, g.connected])).toEqual([['trustweb', true], ['ch:signal', false], ['link:other', false]])
  })
  it('an unconnected person shows only dashed glyphs', () => {
    expect(messengerGlyphs({ id: 'p', channels: { signal: '+436601234567' } }).every((g) => !g.connected)).toBe(true)
  })
})

describe('ring edit', () => {
  it('sets the ring and drops the suggestion mark', () => {
    const p = { ring: Ring.Unsorted, ringSuggested: true }
    setRing(p, Ring.Friend)
    expect(p).toEqual({ ring: Ring.Friend })
  })
})

describe('tags', () => {
  const tags = [{ id: 'a', colour: '#000000', label: 'A' }, { id: 'b', colour: '#111111' }]
  it('offers the defined tags the person lacks; adding one sets the field', () => {
    const p = { ring: Ring.Friend, fields: { a: 'true' } }
    expect(tagsAddable(p, tags).map((t) => t.id)).toEqual(['b'])
    addTagTo(p, 'b')
    expect(p.fields.b).toBe(true)
    expect(tagsAddable(p, tags)).toEqual([])
  })
})

describe('context without a date', () => {
  it.each([
    ['2015', ''], ['2018/9', ''], ['4Dec18', ''], ['1Oct18', ''], ['Fri, Jul 28, 2023', ''],
    ['Fair 2024-05-03', 'Fair'], ['Fair · 3.5.2024', 'Fair'], ['Garden party', 'Garden party'], ['', ''],
  ])('%s -> %s', (raw, text) => { expect(contextWithoutDate(raw)).toBe(text) })
})

describe('met date', () => {
  it('setMetAt moves the met date; the Met timeline entry carries no date in its words and is marked', () => {
    const p = { id: 'p', name: 'A', context: 'Fair 2015', ring: 'friend', metAt: 1000, lines: [] }
    setMetAt(p, 5000)
    expect(p.metAt).toBe(5000)
    const met = ownEvents({ peers: [], log: [] }, p).find((x) => x.met)
    expect(met.summary).toBe('Met: Fair')
    expect(met.at).toBe(5000)
  })
})
