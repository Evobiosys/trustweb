// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 network-view: tappable names, mutual-connection filter, archived people (src/network_graph.ts). */
import { isArchived, labelAt, mutualIds } from '../../src/network_graph.ts'

const me = { id: 'me', displayName: 'Me' }
const person = (id, extra = {}) => ({ id, name: id, context: '', ring: 'friend', lines: [], ...extra })

describe('labelAt', () => {
  const boxes = [{ id: 'a', x: 100, y: 50, w: 40 }, { id: 'b', x: 160, y: 50, w: 40 }]
  it('hits a name though the box is narrower than a fingertip', () => expect(labelAt(boxes, 100 + 20, 44)).toBe('a'))
  it('gives a short name a 44 px target', () => expect(labelAt([{ id: 'a', x: 100, y: 50, w: 10 }], 100 + 21, 44 + 20)).toBe('a'))
  it('misses far away', () => expect(labelAt(boxes, 100, 200)).toBeNull())
  it('picks the nearest centre when boxes overlap', () => expect(labelAt(boxes, 150, 44)).toBe('b'))
})

describe('mutualIds', () => {
  it('lists only people connected with another contact', () => {
    const people = [person('a', { context: 'club' }), person('b', { context: 'Club' }), person('c', { context: 'solo' }), person('d', { knows: ['a'] })]
    expect([...mutualIds(me, people)].sort()).toEqual(['a', 'b', 'd'])
  })
  it('does not count a link to me', () => expect(mutualIds(me, [person('a', { knows: ['me'] })]).size).toBe(0))
  it('is empty without people', () => expect(mutualIds(me, []).size).toBe(0))
})

describe('isArchived', () => {
  it('is true for a set-aside invitation or a dismissed reach-out only', () => {
    expect(isArchived(person('a', { pendingInvite: {} }))).toBe(true)
    expect(isArchived(person('a', { wantsToConnect: {} }))).toBe(true)
    expect(isArchived(person('a'))).toBe(false)
  })
})
