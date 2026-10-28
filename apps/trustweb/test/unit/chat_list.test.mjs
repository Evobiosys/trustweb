// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Chat tab list (wave 24): newest first, last line, unread count. */
import { chatListRows } from '../../src/chat_list.ts'

const msg = (text, at, dir = 'in') => ({ key: dir + at, dir, text, at, sentAt: at, state: dir === 'in' ? 'received' : 'delivered' })
const people = [{ id: 'a', peerId: 'pa', name: 'Anna' }, { id: 'b', peerId: 'pb', name: 'Ben' }, { id: 'c', name: 'Cy' }]

describe('chat_list', () => {
  it('lists people with a thread, newest message first', () => {
    const book = { pa: { messages: [msg('hi', 10)], unread: 0 }, pb: { messages: [msg('yo', 20), msg('later', 30, 'out')], unread: 1 } }
    const rows = chatListRows(book, people)
    expect(rows.map((r) => r.personId)).toEqual(['b', 'a'])
    expect(rows[0]).toMatchObject({ name: 'Ben', last: 'later', at: 30, unread: 1 })
  })
  it('skips empty threads and threads of unknown peers', () => {
    const book = { pa: { messages: [], unread: 0 }, zz: { messages: [msg('x', 5)], unread: 0 } }
    expect(chatListRows(book, people)).toEqual([])
  })
  it('keeps the last line short and on one line', () => {
    const rows = chatListRows({ pa: { messages: [msg('a\nb ' + 'x'.repeat(200), 1)], unread: 0 } }, people)
    expect(rows[0].last.includes('\n')).toBe(false)
    expect(rows[0].last.length).toBeLessThanOrEqual(80)
  })
  it('tolerates an absent book', () => {
    expect(chatListRows(undefined, people)).toEqual([])
  })
})
