// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Chat tab list (wave 24): newest first, last line, unread count. */
import { chatFindRows, chatListRows, chatPickerRows, messengerSymbols } from '../../src/chat_list.ts'

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

describe('chat_list picker (New message)', () => {
  it('lists only people who can be chatted with, by name', () => {
    const rows = chatPickerRows([{ id: 'c', name: 'Cy' }, { id: 'b', peerId: 'pb', name: 'Ben' }, { id: 'a', peerId: 'pa', name: 'Anna' }])
    expect(rows).toEqual([{ personId: 'a', name: 'Anna', connected: true }, { personId: 'b', name: 'Ben', connected: true }])
  })
  it('a typed name also finds a person who is not connected, flagged', () => {
    const rows = chatPickerRows(people, 'cy')
    expect(rows).toEqual([{ personId: 'c', name: 'Cy', connected: false }])
  })
  it('is empty without people', () => {
    expect(chatPickerRows([])).toEqual([])
  })
})

describe('chat_list search, hidden, find, symbols', () => {
  const book = { pa: { messages: [msg('lunch tomorrow', 10)], unread: 2 }, pb: { messages: [msg('yo', 20)], unread: 0 } }
  it('filters by name and by message text, case-insensitive', () => {
    expect(chatListRows(book, people, { query: 'ANN' }).map((r) => r.personId)).toEqual(['a'])
    expect(chatListRows(book, people, { query: 'lunch' }).map((r) => r.personId)).toEqual(['a'])
    expect(chatListRows(book, people, { query: 'zzz' })).toEqual([])
  })
  it('hidden (Do Not Disturb) shows no conversation at all', () => {
    expect(chatListRows(book, people, { hidden: true })).toEqual([])
  })
  it('find section: connected people without a thread, filtered by name', () => {
    const more = [...people, { id: 'd', peerId: 'pd', name: 'Dee' }]
    expect(chatFindRows(book, more).map((r) => r.personId)).toEqual(['d'])
    expect(chatFindRows(book, more, 'x')).toEqual([])
  })
  it('symbols: TrustWeb when connected, Signal and WhatsApp when a link is stored', () => {
    const p = { id: 'e', peerId: 'pe', name: 'Eve', channels: { signal: '+4366412345', whatsapp: '+4366412345', matrix: '@e:x.org' } }
    const s = messengerSymbols(p)
    expect(s.map((x) => x.kind)).toEqual(['trustweb', 'signal', 'whatsapp'])
    expect(s[0].href).toBeUndefined()
    expect(s[1].href).toBe('https://signal.me/#p/+4366412345')
    expect(s[2].href).toBe('https://wa.me/4366412345')
    expect(messengerSymbols({ id: 'f', name: 'Fay' })).toEqual([])
  })
})
