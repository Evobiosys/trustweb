// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 push-popup: the local inbox of shown notifications and the content of the "missed" popup. Pure, no DOM. */
import { INBOX_CAP, addItem, markSeen, markOneSeen, popupRows, reconcileInbox, unseen, newItem } from '../../src/notify_inbox.ts'
import { workerItems, workerLines, ALL_KINDS_ON } from '../../src/notify_kinds.ts'

const it1 = (id, at, over = {}) => ({ id, kind: 'chat', title: 'TrustWeb', body: `b${id}`, at, seenAt: null, ...over })

describe('inbox', () => {
  it('newItem starts unseen with the kind, title, body and time', () => {
    expect(newItem('chat', 'T', 'B', 5, 'x1')).toEqual({ id: 'x1', kind: 'chat', title: 'T', body: 'B', at: 5, seenAt: null })
  })
  it('addItem keeps newest first, ignores a repeated id and caps the list', () => {
    let l = []
    l = addItem(l, it1('a', 1)); l = addItem(l, it1('b', 2)); l = addItem(l, it1('a', 1))
    expect(l.map((i) => i.id)).toEqual(['b', 'a'])
    for (let i = 0; i < INBOX_CAP + 5; i++) l = addItem(l, it1('n' + i, 10 + i))
    expect(l).toHaveLength(INBOX_CAP)
    expect(l[0].id).toBe('n' + (INBOX_CAP + 4))
  })
  it('unseen lists only seenAt null, newest first', () => {
    const l = [it1('a', 1), it1('b', 3), it1('c', 2, { seenAt: 9 })]
    expect(unseen(l).map((i) => i.id)).toEqual(['b', 'a'])
  })
  it('markSeen sets seenAt on the listed ids only; markOneSeen on one', () => {
    const l = [it1('a', 1), it1('b', 2), it1('c', 3)]
    expect(markSeen(l, ['a', 'c'], 50).map((i) => i.seenAt)).toEqual([50, null, 50])
    expect(markOneSeen(l, 'b', 60).map((i) => i.seenAt)).toEqual([null, 60, null])
    expect(l.every((i) => i.seenAt === null)).toBe(true)
  })
  it('an item already seen keeps its first seenAt', () => {
    expect(markSeen([it1('a', 1, { seenAt: 7 })], ['a'], 50)[0].seenAt).toBe(7)
  })
  it('reconcile unions by id and a seenAt on either side wins', () => {
    const idb = [it1('a', 1), it1('b', 2, { seenAt: 5 })]
    const mirror = [it1('a', 1, { seenAt: 8 }), it1('b', 2), it1('c', 3)]
    const r = reconcileInbox(idb, mirror)
    expect(r.map((i) => [i.id, i.seenAt])).toEqual([['c', null], ['b', 5], ['a', 8]])
  })
})

describe('popupRows', () => {
  const l = [it1('a', 1), it1('b', 3, { kind: 'connect' }), it1('c', 2, { seenAt: 4 })]
  it('is empty while the setting is off or nothing is unseen', () => {
    expect(popupRows(l, true)).toEqual([])
    expect(popupRows([it1('c', 2, { seenAt: 4 })], false)).toEqual([])
  })
  it('lists unseen items newest first, each with the screen it opens', () => {
    expect(popupRows(l, false).map((r) => [r.id, r.body, r.home])).toEqual([['b', 'bb', 'web'], ['a', 'ba', 'chat']])
  })
})

describe('workerItems', () => {
  it('pairs each line with its kind and workerLines stays the same', () => {
    const arr = [{ kind: 'chat', name: 'Ada' }, { kind: 'connect', name: null }]
    const items = workerItems(arr, ALL_KINDS_ON)
    expect(items.map((i) => i.kind)).toEqual(['connect', 'chat'])
    expect(items.map((i) => i.body)).toEqual(workerLines(arr, ALL_KINDS_ON))
  })
})
