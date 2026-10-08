/**
 * Chat store (src/chat.ts, wave 6 U3): bounds, dedupe, ordering,
 * pending -> delivered, sanitising, routing of incoming texts.
 */
import {
  CHAT_KEEP_PER_PERSON, CHAT_MAX_THREADS, CHAT_TEXT_MAX, ChatDirection, MessageState, TextKind, cleanChatText, emptyBook, markDelivered,
  markRead, messageKey, migrateChats, pendingOutgoing, peersWithPending, queueOutgoing, receiveText, removeThread, routeText, sanitizeChatBook, unreadTotal,
} from '../../src/chat.ts'
import { contactText } from '../../src/contact_share.ts'
import { shareUrl } from '../../src/share.ts'
import { Channel } from '../../src/model.ts'
import { CHAT_MAX_LEN } from '../../../demo/src/wire.ts'

const APP = 'https://app.example.test/'
const T0 = 1_800_000_000_000

describe('limits agree with the wire', () => {
  it('CHAT_TEXT_MAX equals the relay boundary (a longer text would be dropped by the receiver)', () => {
    expect(CHAT_TEXT_MAX).toBe(CHAT_MAX_LEN)
  })
})

describe('cleanChatText', () => {
  it('trims, tidies line breaks and strips hidden characters', () => {
    expect(cleanChatText('  hi\r\nthere \n\n\n\nbye‮\u0000  ')).toBe('hi\nthere\n\nbye')
  })
  it('refuses empty, whitespace-only, non-strings and over-long text; accepts exactly the bound', () => {
    expect(cleanChatText('')).toBeNull()
    expect(cleanChatText(' \n\t ')).toBeNull()
    expect(cleanChatText('‮')).toBeNull()
    expect(cleanChatText(42)).toBeNull()
    expect(cleanChatText(undefined)).toBeNull()
    expect(cleanChatText('a'.repeat(CHAT_TEXT_MAX))).toHaveLength(CHAT_TEXT_MAX)
    expect(cleanChatText('a'.repeat(CHAT_TEXT_MAX + 1))).toBeNull()
  })
  it('keeps markup as plain text (the view only ever sets textContent)', () => {
    expect(cleanChatText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('sending: pending then delivered', () => {
  it('a new message is pending, keeps its place and carries the timestamp to send', () => {
    const { book, message } = queueOutgoing(emptyBook(), 'p1', 'Hello', T0)
    expect(message).toMatchObject({ dir: ChatDirection.Out, text: 'Hello', state: MessageState.Pending, sentAt: T0, at: T0 })
    expect(book.p1.messages).toHaveLength(1)
    expect(pendingOutgoing(book, 'p1')).toEqual([message])
  })
  it('marking delivered flips only that message and is idempotent', () => {
    const a = queueOutgoing(emptyBook(), 'p1', 'one', T0)
    const b = queueOutgoing(a.book, 'p1', 'two', T0 + 5)
    const d = markDelivered(b.book, 'p1', a.message.key)
    expect(d.p1.messages.map((m) => m.state)).toEqual([MessageState.Delivered, MessageState.Pending])
    expect(pendingOutgoing(d, 'p1').map((m) => m.text)).toEqual(['two'])
    expect(markDelivered(d, 'p1', a.message.key)).toBe(d)
  })
  it('unknown peer or key leaves the book untouched', () => {
    const { book } = queueOutgoing(emptyBook(), 'p1', 'one', T0)
    expect(markDelivered(book, 'nobody', 'x')).toBe(book)
    expect(markDelivered(book, 'p1', 'nope')).toBe(book)
  })
  it('two messages in the same millisecond get distinct, increasing timestamps (a retry key never collides)', () => {
    const a = queueOutgoing(emptyBook(), 'p1', 'same', T0)
    const b = queueOutgoing(a.book, 'p1', 'same', T0)
    expect(b.message.sentAt).toBe(T0 + 1)
    expect(b.message.key).not.toBe(a.message.key)
  })
  it('a retry reuses the original sentAt, so its key stays the same', () => {
    const { message } = queueOutgoing(emptyBook(), 'p1', 'retry me', T0)
    expect(messageKey(ChatDirection.Out, message.sentAt, message.text)).toBe(message.key)
  })
  it('empty or over-long text queues nothing', () => {
    const book = emptyBook()
    expect(queueOutgoing(book, 'p1', '   ', T0)).toEqual({ book, message: null })
    expect(queueOutgoing(book, 'p1', 'x'.repeat(CHAT_TEXT_MAX + 1), T0).message).toBeNull()
    expect(queueOutgoing(book, '', 'hello', T0).message).toBeNull()
  })
  it('never mutates the book it was given', () => {
    const a = queueOutgoing(emptyBook(), 'p1', 'one', T0)
    const snapshot = JSON.stringify(a.book)
    queueOutgoing(a.book, 'p1', 'two', T0 + 1)
    markDelivered(a.book, 'p1', a.message.key)
    receiveText(a.book, 'p1', 'hey', T0, T0)
    expect(JSON.stringify(a.book)).toBe(snapshot)
  })
})

describe('receiving', () => {
  it('stores a message as received and counts it unread', () => {
    const r = receiveText(emptyBook(), 'p1', 'Hi Jakob', T0 - 1000, T0)
    expect(r.message).toMatchObject({ dir: ChatDirection.In, state: MessageState.Received, text: 'Hi Jakob', at: T0 })
    expect(r.book.p1.unread).toBe(1)
    expect(unreadTotal(r.book)).toBe(1)
  })
  it('drops a redelivery of the same message (idempotent)', () => {
    const a = receiveText(emptyBook(), 'p1', 'once', T0, T0 + 10)
    const b = receiveText(a.book, 'p1', 'once', T0, T0 + 99)
    expect(b.duplicate).toBe(true)
    expect(b.message).toBeNull()
    expect(b.book).toBe(a.book)
    expect(b.book.p1.messages).toHaveLength(1)
  })
  it('the same words at another time are a new message', () => {
    const a = receiveText(emptyBook(), 'p1', 'ok', T0, T0)
    expect(receiveText(a.book, 'p1', 'ok', T0 + 60_000, T0 + 60_000).book.p1.messages).toHaveLength(2)
  })
  it('the same message from two different people lands in both threads', () => {
    const a = receiveText(emptyBook(), 'p1', 'ok', T0, T0)
    expect(receiveText(a.book, 'p2', 'ok', T0, T0).book.p2.messages).toHaveLength(1)
  })
  it('rejects invalid input without throwing', () => {
    const book = emptyBook()
    for (const [text, ts] of [['', T0], ['hi', 'x'], ['hi', Number.NaN], ['hi', Infinity], [null, T0], ['y'.repeat(CHAT_TEXT_MAX + 1), T0]]) {
      const r = receiveText(book, 'p1', text, ts, T0)
      expect(r.message).toBeNull()
      expect(r.book).toBe(book)
    }
    expect(receiveText(book, '', 'hi', T0, T0).message).toBeNull()
  })
  it('clamps a sender clock from the far future and from before the epoch, for display only', () => {
    const future = receiveText(emptyBook(), 'p1', 'x', T0 + 10 * 24 * 3600_000, T0).message
    expect(future.sentAt).toBeLessThanOrEqual(T0 + 5 * 60_000)
    const past = receiveText(emptyBook(), 'p1', 'x', -5, T0).message
    expect(past.sentAt).toBe(0)
  })
  it('strips hidden characters before keeping', () => {
    expect(receiveText(emptyBook(), 'p1', 'ab‮cd', T0, T0).message.text).toBe('abcd')
  })
})

describe('ordering', () => {
  it('follows arrival, and a message never sorts before the one before it even when the clock steps back', () => {
    let book = receiveText(emptyBook(), 'p1', 'first', T0, T0 + 100).book
    book = queueOutgoing(book, 'p1', 'second', T0 + 50).book
    book = receiveText(book, 'p1', 'third', T0 - 9999, T0 + 20).book
    expect(book.p1.messages.map((m) => m.text)).toEqual(['first', 'second', 'third'])
    const ats = book.p1.messages.map((m) => m.at)
    expect([...ats].sort((a, b) => a - b)).toEqual(ats)
  })
  it('a sender claiming an old time does not jump ahead of newer arrivals', () => {
    let book = receiveText(emptyBook(), 'p1', 'arrived first', T0 + 5000, T0 + 10).book
    book = receiveText(book, 'p1', 'claims earlier', T0, T0 + 20).book
    expect(book.p1.messages.map((m) => m.text)).toEqual(['arrived first', 'claims earlier'])
  })
})

describe('bounds', () => {
  it('keeps at most CHAT_KEEP_PER_PERSON messages per person, dropping the oldest', () => {
    let book = emptyBook()
    for (let i = 0; i < CHAT_KEEP_PER_PERSON + 25; i++) book = receiveText(book, 'p1', `m${i}`, T0 + i, T0 + i).book
    const texts = book.p1.messages.map((m) => m.text)
    expect(texts).toHaveLength(CHAT_KEEP_PER_PERSON)
    expect(texts[0]).toBe('m25')
    expect(texts[texts.length - 1]).toBe(`m${CHAT_KEEP_PER_PERSON + 24}`)
  })
  it('a message still waiting to be sent outlives older delivered ones', () => {
    let book = queueOutgoing(emptyBook(), 'p1', 'waiting', T0).book
    for (let i = 0; i < CHAT_KEEP_PER_PERSON + 5; i++) book = receiveText(book, 'p1', `m${i}`, T0 + i + 1, T0 + i + 1).book
    expect(book.p1.messages).toHaveLength(CHAT_KEEP_PER_PERSON)
    expect(book.p1.messages.some((m) => m.text === 'waiting')).toBe(true)
  })
  it('keeps at most CHAT_MAX_THREADS threads, dropping the quietest, never the one just used', () => {
    let book = emptyBook()
    for (let i = 0; i < CHAT_MAX_THREADS; i++) book = receiveText(book, `p${i}`, 'hi', T0, T0 + i).book
    book = receiveText(book, 'newcomer', 'hi', T0, T0 + CHAT_MAX_THREADS + 1).book
    expect(Object.keys(book)).toHaveLength(CHAT_MAX_THREADS)
    expect(book.newcomer).toBeDefined()
    expect(book.p0).toBeUndefined()
    expect(book.p1).toBeDefined()
  })
  it('unread never exceeds the kept messages', () => {
    let book = emptyBook()
    for (let i = 0; i < CHAT_KEEP_PER_PERSON + 30; i++) book = receiveText(book, 'p1', `m${i}`, T0 + i, T0 + i).book
    expect(book.p1.unread).toBe(CHAT_KEEP_PER_PERSON)
  })
})

describe('reading and removing', () => {
  it('markRead clears unread, and is a no-op when there is nothing', () => {
    const a = receiveText(emptyBook(), 'p1', 'hey', T0, T0).book
    const b = markRead(a, 'p1')
    expect(b.p1.unread).toBe(0)
    expect(markRead(b, 'p1')).toBe(b)
    expect(markRead(b, 'nobody')).toBe(b)
  })
  it('removeThread forgets one person only', () => {
    let book = receiveText(emptyBook(), 'p1', 'a', T0, T0).book
    book = receiveText(book, 'p2', 'b', T0, T0).book
    const next = removeThread(book, 'p1')
    expect(Object.keys(next)).toEqual(['p2'])
    expect(removeThread(next, 'p1')).toBe(next)
  })
})

describe('routing incoming texts', () => {
  const link = { keyText: 'TW1ABCDEFGHIJKLMNOPQRSTUVWXYZ', title: 'Coffee' }
  it('a meeting share link goes to the share path', () => {
    expect(routeText(APP, shareUrl(APP, link))).toBe(TextKind.Share)
  })
  it('a valid contact text goes to the contact path', () => {
    const text = contactText(APP, { v: 1, channels: { [Channel.Signal]: 'https://signal.me/#eu/abcDEF123_-xyz' } })
    expect(routeText(APP, text)).toBe(TextKind.Contact)
  })
  it('a malformed contact or share text is ignored, never shown as chat', () => {
    expect(routeText(APP, `${APP}?contact=1#signal=nonsense`)).toBe(TextKind.Ignore)
    expect(routeText(APP, `${APP}?contact=1#`)).toBe(TextKind.Ignore)
    expect(routeText(APP, `${APP}?share=1#k=short`)).toBe(TextKind.Ignore)
  })
  it('everything else is chat, including a link to this app that is not protocol text', () => {
    expect(routeText(APP, 'see you at 5')).toBe(TextKind.Chat)
    expect(routeText(APP, `look at ${APP}`)).toBe(TextKind.Chat)
  })
  it('a non-string is ignored', () => {
    expect(routeText(APP, undefined)).toBe(TextKind.Ignore)
  })
})

describe('sanitizeChatBook (reading a stored record never throws)', () => {
  const good = () => {
    let b = queueOutgoing(emptyBook(), 'p1', 'mine', T0).book
    b = receiveText(b, 'p1', 'theirs', T0 + 5, T0 + 6).book
    return JSON.parse(JSON.stringify(b))
  }
  it('a stored book survives a round trip unchanged', () => {
    const b = good()
    expect(sanitizeChatBook(b)).toEqual(b)
  })
  it('junk becomes an empty book', () => {
    for (const junk of [null, undefined, 3, 'x', [], true]) expect(sanitizeChatBook(junk)).toEqual({})
  })
  it('drops invalid messages and threads, keeps the valid ones', () => {
    const b = good()
    b.p1.messages.push({ nonsense: true }, null, 5, { ...b.p1.messages[0], text: '' }, { ...b.p1.messages[0], state: 'wat' })
    b.p2 = { messages: 'no' }
    b.p3 = null
    b[''] = { messages: b.p1.messages }
    const out = sanitizeChatBook(b)
    expect(Object.keys(out)).toEqual(['p1'])
    expect(out.p1.messages).toHaveLength(2)
  })
  it('a message whose direction and state disagree is dropped', () => {
    const b = good()
    b.p1.messages[1].state = 'pending'
    expect(sanitizeChatBook(b).p1.messages).toHaveLength(1)
  })
  it('re-applies the bounds, dedupes keys, strips hidden characters and clamps unread', () => {
    const msgs = []
    for (let i = 0; i < CHAT_KEEP_PER_PERSON + 40; i++) msgs.push({ key: `k${i}`, dir: 'in', text: `m${i}‮`, at: i, sentAt: i, state: 'received' })
    msgs.push({ ...msgs[0] })
    const out = sanitizeChatBook({ p1: { messages: msgs, unread: 99999 }, '__proto__': { messages: msgs } })
    expect(out.p1.messages).toHaveLength(CHAT_KEEP_PER_PERSON)
    expect(out.p1.messages[0].text).toBe('m40')
    expect(out.p1.unread).toBe(CHAT_KEEP_PER_PERSON)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })
  it('keeps the stored key, so a redelivery after a reload is still recognised', () => {
    const first = receiveText(emptyBook(), 'p1', 'once', T0 + 10 * 24 * 3600_000, T0)
    const reloaded = sanitizeChatBook(JSON.parse(JSON.stringify(first.book)))
    expect(receiveText(reloaded, 'p1', 'once', T0 + 10 * 24 * 3600_000, T0 + 5).duplicate).toBe(true)
  })
  it('bounds the number of threads', () => {
    const book = {}
    for (let i = 0; i < CHAT_MAX_THREADS + 20; i++) book[`p${i}`] = { messages: [{ key: 'k', dir: 'in', text: 'x', at: i, sentAt: i, state: 'received' }], unread: 0 }
    expect(Object.keys(sanitizeChatBook(book))).toHaveLength(CHAT_MAX_THREADS)
  })
})

describe('migrateChats and peersWithPending', () => {
  it('no record: nothing to do', () => {
    expect(migrateChats({})).toBe(false)
  })
  it('a clean record is left alone', () => {
    const state = { chats: queueOutgoing(emptyBook(), 'p1', 'hi', T0).book }
    const before = JSON.stringify(state)
    expect(migrateChats(state)).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
  })
  it('a damaged record is repaired in place, junk becomes empty, nothing throws', () => {
    const state = { chats: { p1: { messages: [{ nonsense: 1 }] }, p2: 5 } }
    expect(migrateChats(state)).toBe(true)
    expect(state.chats).toEqual({})
    const junk = { chats: 'garbage' }
    expect(migrateChats(junk)).toBe(true)
    expect(junk.chats).toEqual({})
  })
  it('lists the peers that still have something waiting', () => {
    let book = queueOutgoing(emptyBook(), 'p1', 'a', T0).book
    const q = queueOutgoing(book, 'p2', 'b', T0)
    book = markDelivered(q.book, 'p2', q.message.key)
    book = receiveText(book, 'p3', 'c', T0, T0).book
    expect(peersWithPending(book)).toEqual(['p1'])
  })
})
