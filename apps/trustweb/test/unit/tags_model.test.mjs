// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 group-tags: nested group tags, exclusions, cycles, forks (pure). */
import { addParent, childrenOf, fork, forkInto, removeParent, resolveMembers, setKind, toTag } from '../../src/tags_model.ts'

const t = (id, extra = {}) => ({ id, name: id, kind: 'personal', parents: [], excludes: [], stewardIds: [], ...extra })
const held = { c1: ['a', 'b'], c2: ['b', 'c'], c3: ['d'], iyg: ['z'] }
const direct = (id) => held[id] ?? []
const sorted = (l) => [...l].sort()

describe('resolveMembers', () => {
  const tags = [t('iyg', { kind: 'group' }), t('c1', { parents: ['iyg'] }), t('c2', { parents: ['iyg'] }), t('c3')]

  it('a plain tag resolves to its own holders', () => {
    expect(sorted(resolveMembers(tags[3], tags, direct))).toEqual(['d'])
  })

  it('a group is the union of its children (and its own holders), each person once', () => {
    expect(sorted(resolveMembers(tags[0], tags, direct))).toEqual(['a', 'b', 'c', 'z'])
  })

  it('excludes take people out of the union, even when a child holds them', () => {
    const g = { ...tags[0], excludes: ['b', 'z'] }
    expect(sorted(resolveMembers(g, [g, ...tags.slice(1)], direct))).toEqual(['a', 'c'])
  })

  it('nests through several levels and several parents', () => {
    const all = [t('all', { kind: 'group' }), t('iyg', { kind: 'group', parents: ['all'] }), t('c1', { parents: ['iyg'] }), t('c2', { parents: ['iyg'] }), t('c3', { parents: ['all'] })]
    expect(sorted(resolveMembers(all[0], all, direct))).toEqual(['a', 'b', 'c', 'd', 'z'])
  })

  it('an exclude on a nested group stays inside that group', () => {
    const all = [t('all', { kind: 'group' }), t('iyg', { kind: 'group', parents: ['all'], excludes: ['a'] }), t('c1', { parents: ['iyg', 'all'] }), t('c2', { parents: ['iyg'] })]
    expect(sorted(resolveMembers(all[1], all, direct))).toEqual(['b', 'c', 'z'])
    expect(sorted(resolveMembers(all[0], all, direct))).toEqual(['a', 'b', 'c', 'z'])
  })

  it('survives a cycle already in the data', () => {
    const loop = [t('x', { parents: ['y'] }), t('y', { parents: ['x'] })]
    expect(resolveMembers(loop[0], loop, (id) => (id === 'x' ? ['p'] : ['q']))).toEqual(expect.arrayContaining(['p', 'q']))
  })
})

describe('addParent', () => {
  const tags = [t('g', { kind: 'group' }), t('a', { parents: ['g'] }), t('b')]
  it('links a child to a parent without touching the input', () => {
    const out = addParent(tags, 'b', 'g')
    expect(childrenOf(out, 'g').map((x) => x.id)).toEqual(['a', 'b'])
    expect(tags[2].parents).toEqual([])
  })
  it('rejects itself, a direct loop and a deep loop', () => {
    expect(() => addParent(tags, 'g', 'g')).toThrow(/cycle/)
    expect(() => addParent(tags, 'g', 'a')).toThrow(/cycle/)
    const deep = addParent(tags, 'b', 'a')
    expect(() => addParent(deep, 'g', 'b')).toThrow(/cycle/)
  })
  it('rejects unknown tags and adding twice is harmless', () => {
    expect(() => addParent(tags, 'nope', 'g')).toThrow(/unknown/)
    expect(addParent(addParent(tags, 'b', 'g'), 'b', 'g').find((x) => x.id === 'b').parents).toEqual(['g'])
  })
  it('removeParent takes the link away', () => {
    expect(removeParent(tags, 'a', 'g').find((x) => x.id === 'a').parents).toEqual([])
  })
})

describe('fork', () => {
  it('copies the tag with forkedFrom, fresh id, no parents, never managed', () => {
    const src = t('iyg', { kind: 'managed', parents: ['all'], excludes: ['q'], stewardIds: ['s1'] })
    const f = fork(src, 'iyg-2', 'My IYG')
    expect(f).toMatchObject({ id: 'iyg-2', name: 'My IYG', kind: 'personal', parents: [], excludes: ['q'], stewardIds: [], forkedFrom: 'iyg' })
    expect(src.stewardIds).toEqual(['s1'])
  })
  it('a group fork stays a group', () => {
    expect(fork(t('g', { kind: 'group' }), 'g2').kind).toBe('group')
  })
  it('forkInto gives the fork the same children, leaves the source alone', () => {
    const tags = [t('g', { kind: 'group' }), t('a', { parents: ['g'] })]
    const out = forkInto(tags, 'g', 'g2')
    expect(childrenOf(out, 'g2').map((x) => x.id)).toEqual(['a'])
    expect(childrenOf(out, 'g').map((x) => x.id)).toEqual(['a'])
  })
})

describe('toTag and setKind', () => {
  it('fills the defaults of an old colour tag', () => {
    expect(toTag({ id: 'yoga', colour: '#2e7d32', label: 'Yoga' })).toEqual(t('yoga', { name: 'Yoga' }))
  })
  it('setKind managed keeps stewards, other kinds drop them', () => {
    const m = setKind(t('x', { stewardIds: ['s'] }), 'managed')
    expect(m.kind).toBe('managed')
    expect(setKind(m, 'group').stewardIds).toEqual([])
  })
})
