// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b filters-communities (item 5): communities are holarchic: a community can hold sub-communities, shown as a tree. */
import { SUBCOMMUNITY_FREE_LIMIT, canAddSub, communityTree, createCommunity, descendantsOf, parseCommunity, rootOf, subCommunityCount } from '../../src/ext/community-mighty/community_data.ts'

const mk = (d, tags, name, parent) => { const o = createCommunity(d, tags, name, 'informal', undefined, parent); return { d: o.data, tags: o.tags, id: o.id } }

describe('sub-communities', () => {
  it('the free limit is 20', () => expect(SUBCOMMUNITY_FREE_LIMIT).toBe(20))
  it('createCommunity with a parent records it; parse keeps it, junk drops', () => {
    const a = mk({}, [], 'Root')
    const b = mk(a.d, a.tags, 'Child', a.id)
    expect(b.d.meta[b.id].parent).toBe(a.id)
    expect(parseCommunity(JSON.parse(JSON.stringify(b.d))).meta[b.id].parent).toBe(a.id)
    expect(parseCommunity({ meta: { x: { kind: 'informal', organizers: [], parent: 7 } } }).meta.x.parent).toBeUndefined()
  })
  it('the tree nests children under parents, in creation order; a missing parent makes a root', () => {
    let st = mk({}, [], 'Root')
    const root = st.id
    st = mk(st.d, st.tags, 'A', root); const a = st.id
    st = mk(st.d, st.tags, 'A1', a)
    st = mk(st.d, st.tags, 'B', root)
    const rows = st.tags.map((t) => ({ id: t.id, name: t.label, kind: 'informal', members: 0, current: false }))
    const tree = communityTree(st.d, rows)
    expect(tree.map((n) => [n.row.name, n.depth])).toEqual([['Root', 0], ['A', 1], ['A1', 2], ['B', 1]])
    const orphan = communityTree({ meta: { z: { kind: 'informal', organizers: [], parent: 'gone' } } }, [{ id: 'z', name: 'Z', kind: 'informal', members: 0, current: false }])
    expect(orphan[0].depth).toBe(0)
  })
  it('a cycle in the data never loops', () => {
    const d = { meta: { a: { kind: 'informal', organizers: [], parent: 'b' }, b: { kind: 'informal', organizers: [], parent: 'a' } } }
    expect(rootOf(d, 'a')).toBeTruthy()
    expect(descendantsOf(d, 'a').length).toBeLessThan(3)
  })
  it('counts per root and asks for more above 20', () => {
    let st = mk({}, [], 'Root')
    const root = st.id
    for (let i = 0; i < SUBCOMMUNITY_FREE_LIMIT; i++) st = mk(st.d, st.tags, 'S' + i, root)
    expect(subCommunityCount(st.d, root)).toBe(20)
    expect(canAddSub(st.d, root)).toBe(false)
    expect(canAddSub(st.d, st.id)).toBe(false) // a child of that root counts against the same root
    expect(canAddSub({}, 'fresh')).toBe(true)
  })
  it('the limit is one constant: a different limit moves the gate', () => {
    const d = { meta: { r: { kind: 'informal', organizers: [] }, s: { kind: 'informal', organizers: [], parent: 'r' } } }
    expect(canAddSub(d, 'r', 1)).toBe(false)
    expect(canAddSub(d, 'r', 2)).toBe(true)
  })
})
