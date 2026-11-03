// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { applyChanges } from '../../src/notes_client'
import { firstNameKey, joinChanges, offerCandidates } from '../../src/notes_offers'
import type { JoinOffer } from '../../src/notes_offers'

const offer = (o: Partial<JoinOffer> = {}): JoinOffer => ({
  key: '0123456789abcdef', name: 'Taro', path: 'journals/2026_08_01.md', date: '2026-08-01', context: 'At the market',
  facts: ['Bakes bread', 'Has a van'], candidates: [{ id: 'tana-t2', name: 'Taro Berg' }], ...o,
})
const people = () => [
  { id: 'tana-t1', name: 'Taro Lindqvist', lines: [] },
  { id: 'tana-t2', name: 'Taro Berg', lines: [] },
  { id: 'local-i', name: 'Ines Vogl', lines: [] },
  { id: 'tana-z', name: 'Zoë Brandt', lines: [] },
]

describe('notes join offers (owner 2026-11-03)', () => {
  it('firstNameKey matches the converter: first word, lowercased, diacritics folded, ß as ss', () => {
    expect(firstNameKey('Zoë Brandt')).toBe('zoe')
    expect(firstNameKey(' zoe')).toBe('zoe')
    expect(firstNameKey('Joß Weber')).toBe('joss')
    expect(firstNameKey('')).toBe('')
  })
  it('candidates come from the live people (same first name), the converter\'s first, then by name; a gone candidate drops out', () => {
    expect(offerCandidates(offer(), people())).toEqual([{ id: 'tana-t2', name: 'Taro Berg' }, { id: 'tana-t1', name: 'Taro Lindqvist' }])
    expect(offerCandidates(offer({ candidates: [{ id: 'gone', name: 'Taro Gone' }] }), people())).toEqual([{ id: 'tana-t2', name: 'Taro Berg' }, { id: 'tana-t1', name: 'Taro Lindqvist' }])
    expect(offerCandidates(offer({ name: 'Zoe', candidates: [] }), people())).toEqual([{ id: 'tana-z', name: 'Zoë Brandt' }])
    expect(offerCandidates(offer({ name: 'Ines', candidates: [] }), [{ id: 'x', name: 'Ines' }, ...people()])).toEqual([{ id: 'x', name: 'Ines' }, { id: 'local-i', name: 'Ines Vogl' }])
    expect(offerCandidates(offer({ name: 'Nobody' }), people())).toEqual([])
  })
  it('a join is a change for applyChanges: the facts (the context when there are none) with the note\'s date, local provenance', () => {
    expect(joinChanges(offer(), 'tana-t1')).toEqual({ id: 'tana-t1', path: 'journals/2026_08_01.md', newLines: [{ text: 'Bakes bread', date: '2026-08-01' }, { text: 'Has a van', date: '2026-08-01' }] })
    expect(joinChanges(offer({ facts: [] }), 'tana-t1').newLines).toEqual([{ text: 'At the market', date: '2026-08-01' }])
    expect(joinChanges(offer({ facts: [], context: '' }), 'tana-t1').newLines).toEqual([])
    const calls: unknown[] = []
    const r = applyChanges([joinChanges(offer(), 'tana-t1')], people() as never, { addLine: (id, l) => calls.push([id, l.text, l.notedAt, l.source]), now: () => 1, newId: () => 'vault-1' })
    expect(r).toEqual({ lines: 2 })
    expect(calls[0]).toEqual(['tana-t1', 'Bakes bread', Date.parse('2026-08-01T12:00:00Z'), { kind: 'local', path: 'journals/2026_08_01.md' }])
  })
})
