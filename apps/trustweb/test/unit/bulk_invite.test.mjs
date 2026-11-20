// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 bulk-invite-filter: the filter (Include / Exclude chips), the not-yet-invited list, the community warning, the invite. Fake data. */
import { matching, nonMembers, toInvite } from '../../src/bulk_invite.ts'

const P = (id, tags = [], over = {}) => ({ id, name: `Person ${id}`, ring: 'friend', lines: [], context: '', metAt: 1, fields: Object.fromEntries(tags.map((t) => [t, 'true'])), ...over })
const s = { people: [P('a', ['iyg', 'cook']), P('b', ['iyg']), P('c', ['cook']), P('d'), P('e', ['iyg'], { deleted_at: '2026-01-01' }), P('f', ['iyg'], { via: 'a' })] }
const ids = (l) => l.map((p) => p.id)

describe('matching', () => {
  it('a tag chip lists its holders, a person chip that person; deleted and second-hand people never', () => {
    expect(ids(matching(s, ['tag:iyg'], []))).toEqual(['a', 'b'])
    expect(ids(matching(s, ['person:d', 'tag:cook'], []))).toEqual(['a', 'c', 'd'])
  })
  it('an Exclude chip takes people out, a person or a whole tag, and wins over Include', () => {
    expect(ids(matching(s, ['tag:iyg', 'tag:cook'], ['tag:cook']))).toEqual(['b'])
    expect(ids(matching(s, ['tag:iyg'], ['person:a']))).toEqual(['b'])
    expect(ids(matching(s, ['person:a'], ['person:a']))).toEqual([])
  })
  it('no Include chip: nobody (Exclude alone adds nobody)', () => expect(matching(s, [], ['tag:cook'])).toEqual([]))
})

describe('toInvite', () => {
  it('leaves out who is already invited', () => {
    expect(ids(toInvite(s, { people: ['a'] }, ['tag:iyg'], []))).toEqual(['b'])
    expect(ids(toInvite(s, {}, ['tag:iyg'], []))).toEqual(['a', 'b'])
  })
})

describe('nonMembers', () => {
  it('a community event: those who do not hold the community tag; community or communityId names it', () => {
    const who = matching(s, ['tag:cook', 'person:d'], [])
    expect(nonMembers(who, { communityId: 'iyg' })).toEqual({ community: 'iyg', people: who.filter((p) => p.id !== 'a') })
    expect(nonMembers(who, { community: 'iyg' }).community).toBe('iyg')
  })
  it('a personal event has no community and nobody to warn about', () => expect(nonMembers(s.people, {})).toEqual({ community: null, people: [] }))
})
