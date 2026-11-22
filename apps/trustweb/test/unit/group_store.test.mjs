// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 group-chat-list: the pure group store (group_store.ts): create, sanitize, own-device merge, lists (LWW), members, the invite tag. Fake names only. */
import {
  GROUP_KEEP, GROUP_LIST_ITEMS_MAX, GROUP_MAX, activeListId, applyItem, applyList, addChatItem, groupOfTag, groupTag, liveItems, memberNames,
  mergeGroups, newGroup, sanitizeGroups, setMember, archivedOf, lastLine,
} from '../../src/group_store.ts'

const g0 = () => newGroup({ id: 'g1', name: '  Flat  ', now: 1_000, listId: 'l1', listName: 'Shopping & errands' })

describe('newGroup', () => {
  it('a group with me as member, one list that is active; name cleaned; empty name refused', () => {
    const g = g0()
    expect(g).toMatchObject({ id: 'g1', name: 'Flat', at: 1_000, items: [], unread: 0, mem: { me: { name: '', on: true, at: 1_000 } }, lists: [{ id: 'l1', name: 'Shopping & errands', u: 1_000 }], li: [] })
    expect(activeListId(g)).toBe('l1')
    expect(newGroup({ id: 'g2', name: ' ​ ', now: 1, listId: 'l', listName: 'x' })).toBeNull()
    expect(newGroup({ id: 'bad id', name: 'x', now: 1, listId: 'l', listName: 'x' })).toBeNull()
  })
})

describe('the invite tag', () => {
  it('grp:<id> both ways; anything else is no group', () => {
    expect(groupTag('g1')).toBe('grp:g1')
    expect(groupOfTag('grp:g1')).toBe('g1')
    expect(groupOfTag('community-x')).toBeNull()
    expect(groupOfTag('grp:bad id')).toBeNull()
  })
})

describe('lists: last writer wins per list and per item', () => {
  it('a newer list op renames, an older one changes nothing; act sets the active list', () => {
    let g = g0()
    let r = applyList(g, { id: 'l2', name: 'Hardware' }, 2_000)
    expect(r.changed).toBe(true); g = r.g
    expect(g.lists.map((l) => l.name)).toEqual(['Shopping & errands', 'Hardware'])
    expect(applyList(g, { id: 'l2', name: 'Old' }, 1_500).changed).toBe(false)
    expect(applyList(g, { id: 'l2', name: 'Hardware' }, 2_000).changed).toBe(false)
    r = applyList(g, { id: 'l2', name: 'Hardware', act: true }, 3_000); g = r.g
    expect(r.changed).toBe(true)
    expect(activeListId(g)).toBe('l2')
    expect(applyList(g, { id: 'l1', name: 'Shopping & errands', act: true }, 2_500).g.active?.id).toBe('l2')
  })
  it('items: added, checked (who, when), older ops ignored; the adder stays; items of an unknown list refused', () => {
    let g = g0()
    let r = applyItem(g, { id: 'i1', l: 'l1', text: 'Milk', o: 1 }, 2_000, 'Ana'); g = r.g
    expect(r.changed).toBe(true)
    r = applyItem(g, { id: 'i2', l: 'l1', text: 'Bread', o: 2 }, 2_100, 'Ben'); g = r.g
    r = applyItem(g, { id: 'i1', l: 'l1', text: 'Milk', o: 1, done: { by: 'Ben', at: 3_000 } }, 3_000, 'Ben'); g = r.g
    expect(g.li.find((i) => i.id === 'i1')).toMatchObject({ by: 'Ana', done: { by: 'Ben', at: 3_000 }, u: 3_000 })
    expect(applyItem(g, { id: 'i1', l: 'l1', text: 'Milk', o: 1 }, 2_500, 'Cleo').changed).toBe(false)
    expect(applyItem(g, { id: 'i1', l: 'l1', text: 'Milk', o: 1, done: { by: 'Ben', at: 3_000 } }, 3_000, 'Ben').changed).toBe(false)   // the same op again: no change, so a flood stops
    expect(applyItem(g, { id: 'i9', l: 'nope', text: 'x', o: 1 }, 9_000, 'Cleo').changed).toBe(false)
    expect(applyItem(g, { id: 'i9', l: 'l1', text: '  ', o: 1 }, 9_000, 'Cleo').changed).toBe(false)
    expect(liveItems(g, 'l1').map((i) => i.text)).toEqual(['Milk', 'Bread'])
    r = applyItem(g, { id: 'i1', l: 'l1', text: 'Milk', o: 3 }, 4_000, 'Ana'); g = r.g
    expect(liveItems(g, 'l1').map((i) => i.text)).toEqual(['Bread', 'Milk'])
    r = applyItem(g, { id: 'i1', l: 'l1', text: 'Milk', o: 3, done: { by: 'Ben', at: 3_000 }, arc: true }, 5_000, 'Ana'); g = r.g
    expect(liveItems(g, 'l1').map((i) => i.text)).toEqual(['Bread'])
    expect(archivedOf(g, 'l1').map((i) => i.text)).toEqual(['Milk'])
  })
  it('bounded: the oldest archived items go first', () => {
    let g = g0()
    for (let n = 0; n < GROUP_LIST_ITEMS_MAX + 5; n++) g = applyItem(g, { id: `i${n}`, l: 'l1', text: `t${n}`, o: n, ...(n < 10 ? { arc: true, done: { by: 'A', at: 1 } } : {}) }, 2_000 + n, 'A').g
    expect(g.li).toHaveLength(GROUP_LIST_ITEMS_MAX)
    expect(g.li.some((i) => i.id === 'i0')).toBe(false)
    expect(g.li.some((i) => i.id === `i${GROUP_LIST_ITEMS_MAX + 4}`)).toBe(true)
  })
})

describe('chat items and members', () => {
  it('chat items dedupe by id, sort by time, count unread for messages of others; last line', () => {
    let g = g0()
    g = addChatItem(g, { m: 'a', k: 'msg', by: 'Ben', ts: 2_000, at: 2_000, text: 'hi' }).g
    expect(addChatItem(g, { m: 'a', k: 'msg', by: 'Ben', ts: 2_000, at: 2_000, text: 'hi' }).changed).toBe(false)
    g = addChatItem(g, { m: 'b', k: 'check', by: 'Ana', ts: 1_500, at: 2_100, text: 'Milk' }).g
    g = addChatItem(g, { m: 'c', k: 'msg', by: 'Ana', ts: 2_500, at: 2_500, text: 'mine', mine: true, state: 'sent' }).g
    expect(g.items.map((i) => i.m)).toEqual(['b', 'a', 'c'])
    expect(g.unread).toBe(1)
    expect(lastLine(g)?.m).toBe('c')
  })
  it('members by name, me as my name, left ones out', () => {
    let g = g0()
    g = setMember(g, 'p1', 'Ben', true, 2_000)
    g = setMember(g, 'n:cleo', 'Cleo', true, 2_000)
    g = setMember(g, 'n:dora', 'Dora', false, 2_000)
    expect(memberNames(g, 'Ana')).toEqual(['Ana', 'Ben', 'Cleo'])
  })
})

describe('sanitize and own-device merge', () => {
  it('drops junk, keeps valid groups, bounded count', () => {
    const many = Object.fromEntries(Array.from({ length: GROUP_MAX + 3 }, (_, n) => [`g${n}`, { ...g0(), id: `g${n}` }]))
    expect(Object.keys(sanitizeGroups(many))).toHaveLength(GROUP_MAX)
    expect(sanitizeGroups({ g1: { nope: 1 }, 'bad id': g0(), g2: g0() })).toEqual({ g2: { ...g0(), id: 'g2' } })
    expect(sanitizeGroups('x')).toEqual({})
    const long = { ...g0(), items: Array.from({ length: GROUP_KEEP + 4 }, (_, n) => ({ m: `m${n}`, k: 'msg', by: 'B', ts: n, at: n, text: 't' })) }
    expect(sanitizeGroups({ g1: long }).g1.items).toHaveLength(GROUP_KEEP)
  })
  it('merges two devices: items united, list items by newer u, members by newer change, the newer active list', () => {
    const a = { g1: { ...g0(), items: [{ m: 'x', k: 'msg', by: 'B', ts: 1, at: 1, text: 'one' }], li: [{ id: 'i1', l: 'l1', text: 'Milk', o: 1, u: 5, by: 'A' }] } }
    const b = { g1: { ...g0(), items: [{ m: 'y', k: 'msg', by: 'B', ts: 2, at: 2, text: 'two' }], li: [{ id: 'i1', l: 'l1', text: 'Milk', o: 1, u: 9, by: 'A', done: { by: 'B', at: 9 } }], mem: { me: { name: '', on: false, at: 9_000 } } } }
    const m = mergeGroups(a, b).g1
    expect(m.items.map((i) => i.m)).toEqual(['x', 'y'])
    expect(m.li[0].done).toEqual({ by: 'B', at: 9 })
    expect(m.mem.me.on).toBe(false)
  })
})
