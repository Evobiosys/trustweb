// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 outliner-quickadd: the # / @ typeahead of the outline's quick-add input and the chips of a line. */
import { completeToken, lineChips, quickHits } from '../../src/resource_quick_add.ts'

const known = { tags: ['Books', 'bio', 'Events'], people: ['Ada Lovelace', 'Alan Turing', 'Bob'] }

describe('quickHits', () => {
  it('suggests tags for a trailing #word, case-insensitive prefix first', () => {
    expect(quickHits('read #b', known)).toEqual(['#Books', '#bio'])
  })
  it('suggests people for a trailing @word', () => {
    expect(quickHits('met @al', known)).toEqual(['@Alan Turing'])
    expect(quickHits('@', known)).toEqual(['@Ada Lovelace', '@Alan Turing', '@Bob'])
  })
  it('nothing without a trailing token, after a space, or for an exact match', () => {
    expect(quickHits('plain', known)).toEqual([])
    expect(quickHits('read #books ', known)).toEqual([])
    expect(quickHits('x #Books', known)).toEqual([])
    expect(quickHits('a#b', known)).toEqual([])
  })
  it('caps the list at 6', () => {
    expect(quickHits('#t', { tags: Array.from({ length: 9 }, (_, i) => `t${i}`), people: [] })).toHaveLength(6)
  })
})

describe('completeToken', () => {
  it('replaces the trailing token and adds a space', () => {
    expect(completeToken('read #b', '#Books')).toBe('read #Books ')
    expect(completeToken('@al', '@Alan Turing')).toBe('@Alan Turing ')
  })
})

describe('lineChips', () => {
  it('lists #tags and @names of a line', () => {
    expect(lineChips('buy #books and #bio-x for @Ada')).toEqual(['#books', '#bio-x', '@Ada'])
    expect(lineChips('no chips, a#b')).toEqual([])
  })
})
