import { describe, expect, it } from 'vitest'
import { Ring } from '../../../trustweb/src/model'
import { communitiesOf, passesFilters } from '../../src/fields'
import { onlyFrom } from '../../../trustweb/src/sources'
import { OUT_OF_WEB, RING_ORDER, choiceEdits, intendingEdits, ringColor, ringOf, ringSyncValue } from '../../src/rings'

describe('rings', () => {
  it('an unknown, older "none" or "family" ring is unsorted; the order runs from the centre out', () => {
    expect(ringOf('none')).toBe('unsorted')
    expect(ringOf('family')).toBe('unsorted')
    expect(ringOf('friend')).toBe('friend')
    expect(RING_ORDER).toEqual(['close', 'friend', 'acquaintance', 'intending'])
    expect(ringColor('intending')).toBe('#EFC978')
  })
  it('a choice sets the ring, and the famous checkbox only where it changes', () => {
    expect(choiceEdits(Ring.Friend, {})).toEqual([['tw-ring', 'friend']])
    expect(choiceEdits(OUT_OF_WEB, {})).toEqual([['tw-ring', 'unsorted'], ['6QzDHIfrlmSz', true]])
    expect(choiceEdits(Ring.Close, { '6QzDHIfrlmSz': true })).toEqual([['tw-ring', 'close'], ['6QzDHIfrlmSz', false]])
  })
  it('out of my web keeps someone with a desire in intending; picking intending starts at 5 when no desire is set', () => {
    expect(choiceEdits(OUT_OF_WEB, { UAfC4PcYo2po: '4' })[0]).toEqual(['tw-ring', 'intending'])
    expect(choiceEdits(Ring.Intending, {}, 'd')).toEqual([['UAfC4PcYo2po', '5'], ['6A0Y1jShWqIg', 'd'], ['tw-ring', 'intending']])
    expect(choiceEdits(Ring.Intending, { UAfC4PcYo2po: '4' })).toEqual([['tw-ring', 'intending']])
  })
  it('a desire sets number, date and the intending ring unless a closer ring holds', () => {
    expect(intendingEdits(4, { 'tw-ring': 'unsorted' }, '2026-10-14')).toEqual([['UAfC4PcYo2po', '4'], ['6A0Y1jShWqIg', '2026-10-14'], ['tw-ring', 'intending']])
    expect(intendingEdits(4, { 'tw-ring': 'friend' }, '2026-10-14')).toEqual([['UAfC4PcYo2po', '4'], ['6A0Y1jShWqIg', '2026-10-14']])
    expect(intendingEdits(0, { 'tw-ring': 'intending', UAfC4PcYo2po: '4' }, '2026-10-15')).toEqual([['UAfC4PcYo2po', '0'], ['6A0Y1jShWqIg', '2026-10-15'], ['tw-ring', 'unsorted']])
    expect(intendingEdits(4, { UAfC4PcYo2po: '4' }, '2026-10-15')).toEqual([])
    expect(intendingEdits(99, {}, 'd')[0]).toEqual(['UAfC4PcYo2po', '10'])
  })
  it('a famous person with a desire to connect still shows', () => {
    const f = { hideDeceased: true, hideFamous: true, onlyConnection: false, rules: [] }
    expect(passesFilters({ '6QzDHIfrlmSz': true }, f)).toBe(false)
    expect(passesFilters({ '6QzDHIfrlmSz': true, UAfC4PcYo2po: '4' }, f)).toBe(true)
  })
})

describe('ringSyncValue (Web view ring change to Tana)', () => {
  it('maps the four rings and unsorted to the ring field value', () => {
    for (const r of ['close', 'friend', 'acquaintance', 'intending', 'unsorted']) expect(ringSyncValue(r)).toBe(r)
  })
  it('sends nothing for family or none', () => {
    expect(ringSyncValue('family')).toBeNull()
    expect(ringSyncValue('none')).toBeNull()
  })
})

describe('hide by source (Jakob 2026-10-16: only people nothing else knows)', () => {
  const f = { hideDeceased: false, hideFamous: false, onlyConnection: false, rules: [], hideSources: ['tana'] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = (source?: object, tanaId?: string): any => ({ id: 'l', text: 'x', tag: 'note', audience: 'me', status: 'current', notedAt: 1, checkedAt: 1, ...(source ? { source } : {}), ...(tanaId ? { tanaId } : {}) })
  it('a Tana-only person is hidden; one with a note line or a typed line stays; a local person stays', () => {
    expect(onlyFrom({ id: 'tana-a', lines: [line(), line(undefined, 'n1')] })).toBe('tana')
    expect(onlyFrom({ id: 'tana-a', lines: [line({ kind: 'local', path: 'j.md' })] })).toBeNull()
    expect(onlyFrom({ id: 'local-b', lines: [line({ kind: 'local', path: 'j.md' })] })).toBe('local')
    expect(onlyFrom({ id: 'typed', lines: [] })).toBeNull()
    expect(passesFilters({}, f, { id: 'tana-a', lines: [line()] })).toBe(false)
    expect(passesFilters({}, f, { id: 'tana-a', lines: [line({ kind: 'typed' })] })).toBe(true)
    expect(passesFilters({}, f, { id: 'local-b', lines: [] })).toBe(true)
    expect(passesFilters({}, f)).toBe(true)
    expect(passesFilters({}, { ...f, hideSources: [] }, { id: 'tana-a', lines: [line()] })).toBe(true)
  })
})

describe('hide by community (only people in no other community)', () => {
  const f = { hideDeceased: false, hideFamous: false, onlyConnection: false, rules: [], hideSources: [], hideCommunities: ['DWeb-Berlin_2026'] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (name: string): any => ({ id: 'l' + name, text: `community: ${name}`, tag: 'custom', customTag: 'community', audience: 'me', status: 'current', notedAt: 1, checkedAt: 1 })
  it('lists communities; hides only-in; keeps people in another community too, and people in none', () => {
    expect(communitiesOf({ lines: [c('DWeb-Berlin_2026'), c('Graz'), c('Graz')] })).toEqual(['DWeb-Berlin_2026', 'Graz'])
    expect(passesFilters({}, f, { id: 'x', lines: [c('DWeb-Berlin_2026')] })).toBe(false)
    expect(passesFilters({}, f, { id: 'x', lines: [c('DWeb-Berlin_2026'), c('Graz')] })).toBe(true)
    expect(passesFilters({}, f, { id: 'x', lines: [] })).toBe(true)
  })
})
