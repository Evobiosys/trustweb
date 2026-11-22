// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-group-chat: ONE shared thread per event (replaces the answers-44d fan-out into each person's chat). Pure store rules, the
 * receive / forward rules of the engine with a fake transport, the own-device merge (sync_core SETTING_MERGERS) and the wire boundary. Fake names only.
 */
import {
  EVENT_CHAT_KEEP, EVENT_CHAT_HISTORY, EVENT_CHAT_TEXT_MAX, sanitizeEventChats, mergeEventChats, threadOf, eventChatUnread, memberNames, createEventGroupChat,
} from '../../src/event_group_chat.ts'
import { SETTING_MERGERS } from '../../src/sync_core.ts'
import { decodeFromQr as parseEnvelope } from '../../../demo/src/wire.ts'

const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], ...over })
const EV = { id: 'ev1', name: 'Winter OG', from: '2026-12-30', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], fromLink: true }

/** Hanna hosts; Ben and Cleo join; each guest is connected to the host only. `me` picks whose device this is. */
function device(me, over = {}) {
  const people = {
    Hanna: [P('pb', 'Ben', { peerId: 'peer-b', events: ['ev1'] }), P('pc', 'Cleo', { peerId: 'peer-c', events: ['ev1'] }), P('px', 'Xena', { peerId: 'peer-x' })],
    Ben: [P('ph', 'Hanna', { peerId: 'peer-h' })],
    Cleo: [P('ph', 'Hanna', { peerId: 'peer-h' })],
  }[me]
  const s = { v: 1, me: { id: 'me', displayName: me }, people, peers: people.filter((p) => p.peerId).map((p) => ({ id: p.peerId })), events: [{ ...EV, ...(me === 'Hanna' ? { fromLink: false } : {}) }], ...over }
  const sent = []
  let ids = 0
  let t = 1000
  const changed = []
  const chat = createEventGroupChat({
    state: () => s, save: () => {}, now: () => (t += 10), newId: () => `m${me[0]}${++ids}`, peers: () => s.peers,
    send: async (peer, env) => { if (peer.id === 'peer-down') throw new Error('offline'); sent.push({ to: peer.id, env }) }, changed: (id) => changed.push(id),
  })
  return { s, sent, chat, changed }
}
const gc = (o) => ({ id: 'ev1', m: 'mz1', k: 'msg', by: 'Ben', ts: 900, text: 'hello all', ...o })

describe('wire: the gc (group chat) event envelope', () => {
  it('parses {id, m, k, by, ts, text}; a msg without text, text on join/leave, a long text, bad ids, a mix with link are refused', () => {
    const ok = { v: 1, t: 'event', gc: gc({}) }
    expect(parseEnvelope(JSON.stringify(ok))).toEqual(ok)
    expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', gc: gc({ k: 'join', text: undefined }) }))).toEqual({ v: 1, t: 'event', gc: { id: 'ev1', m: 'mz1', k: 'join', by: 'Ben', ts: 900 } })
    for (const bad of [gc({ text: undefined }), gc({ k: 'leave' }), gc({ text: 'x'.repeat(EVENT_CHAT_TEXT_MAX + 1) }), gc({ id: 'bad id!' }), gc({ m: '' }), gc({ k: 'shout' }), gc({ by: '' }), gc({ by: 'y'.repeat(41) }), gc({ ts: 'soon' })]) {
      expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', gc: bad })), JSON.stringify(bad)).toBeNull()
    }
    expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', gc: gc({}), link: 'x' }))).toBeNull()
  })
})

describe('store', () => {
  it('sanitizes: bad items and threads go, items bounded, order by sender time then id', () => {
    const raw = { ev1: { unread: 3, items: [{ m: 'b', k: 'msg', by: 'Ben', ts: 20, at: 5, text: 'two' }, { m: 'a', k: 'msg', by: 'Ben', ts: 10, at: 6, text: 'one' }, { m: 'c', k: 'msg', by: 'Ben', ts: 1, at: 1 }, null] }, __proto__: { items: [] }, ev2: 'x' }
    const c = sanitizeEventChats(raw)
    expect(Object.keys(c)).toEqual(['ev1'])
    expect(c.ev1.items.map((i) => i.m)).toEqual(['a', 'b'])
    expect(c.ev1.unread).toBe(3)
    const many = { ev1: { unread: 0, items: Array.from({ length: EVENT_CHAT_KEEP + 5 }, (_, i) => ({ m: `m${i}`, k: 'msg', by: 'B', ts: i, at: i, text: 't' })) } }
    expect(sanitizeEventChats(many).ev1.items.length).toBe(EVENT_CHAT_KEEP)
    expect(sanitizeEventChats(many).ev1.items[0].m).toBe('m5')
    expect(sanitizeEventChats(null)).toEqual({})
  })
  it('own-device merge: union by id, read state and membership by the newer change; registered with sync_core', () => {
    const a = { ev1: { unread: 0, items: [{ m: 'a', k: 'msg', by: 'Ben', ts: 10, at: 1, text: 'one', mine: true, state: 'pending' }], mem: { me: { on: false, at: 5 } } } }
    const b = { ev1: { unread: 2, items: [{ m: 'a', k: 'msg', by: 'Ben', ts: 10, at: 3, text: 'one', mine: true, state: 'sent' }, { m: 'b', k: 'msg', by: 'Cleo', ts: 11, at: 4, text: 'two' }], mem: { me: { on: true, at: 9 } } }, ev2: { unread: 0, items: [{ m: 'z', k: 'join', by: 'Xena', ts: 1, at: 1 }] } }
    const m = mergeEventChats(a, b)
    expect(m.ev1.items.map((i) => [i.m, i.state])).toEqual([['a', 'sent'], ['b', undefined]])
    expect(m.ev1.mem.me).toEqual({ on: true, at: 9 })
    expect(m.ev1.unread).toBe(2)
    expect(Object.keys(m).sort()).toEqual(['ev1', 'ev2'])
    expect(SETTING_MERGERS.get('eventChats')).toBe(mergeEventChats)
  })
})

describe('engine: one shared thread per event', () => {
  it('a guest sends: one sealed gc envelope per connected member (here the host), the thread holds it once, pending until a send succeeds', async () => {
    const B = device('Ben')
    const item = await B.chat.send('ev1', '  see you at the Alm  ')
    expect(item).toMatchObject({ k: 'msg', by: 'Ben', text: 'see you at the Alm', mine: true, state: 'sent' })
    expect(B.sent).toEqual([{ to: 'peer-h', env: { v: 1, t: 'event', gc: { id: 'ev1', m: item.m, k: 'msg', by: 'Ben', ts: item.ts, text: 'see you at the Alm' } } }])
    expect(threadOf(B.s, 'ev1').items.length).toBe(1)
    expect(await B.chat.send('ev1', '   ')).toBeNull()
    expect(await B.chat.send('nope', 'x')).toBeNull()
    B.s.peers[0].id = 'peer-down'; B.s.people[0].peerId = 'peer-down'
    expect((await B.chat.send('ev1', 'later')).state).toBe('pending')
    B.s.peers[0].id = 'peer-h'; B.s.people[0].peerId = 'peer-h'
    expect(await B.chat.retry('ev1')).toBe(1)
    expect(threadOf(B.s, 'ev1').items.every((i) => i.state === 'sent')).toBe(true)
  })

  it('the host stores a guest message once (author = the sender as the host knows them) and forwards it to the other members, never back, never to non-members', async () => {
    const H = device('Hanna')
    expect(await H.chat.onEnvelope({ id: 'peer-b' }, gc({ by: 'Spoofed Name' }))).toBe(true)
    expect(threadOf(H.s, 'ev1').items).toMatchObject([{ m: 'mz1', by: 'Ben', text: 'hello all' }])
    expect(threadOf(H.s, 'ev1').unread).toBe(1)
    expect(H.sent.map((x) => x.to)).toEqual(['peer-c'])
    expect(H.sent[0].env.gc).toMatchObject({ m: 'mz1', by: 'Ben', text: 'hello all' })
    expect(await H.chat.onEnvelope({ id: 'peer-b' }, gc({}))).toBe(false)   // redelivery
    expect(H.sent.length).toBe(1)
    expect(await H.chat.onEnvelope({ id: 'peer-x' }, gc({ m: 'mz2' }))).toBe(false)   // Xena is not at the event
    expect(await H.chat.onEnvelope({ id: 'peer-b' }, gc({ m: 'mz3', id: 'other' }))).toBe(false)   // an event I do not hold
    expect(H.changed).toEqual(['ev1'])
  })

  it('a guest takes the host-forwarded author name; from a non-host the name is the sender itself', async () => {
    const C = device('Cleo')
    expect(await C.chat.onEnvelope({ id: 'peer-h' }, gc({ by: 'Ben' }))).toBe(true)
    expect(threadOf(C.s, 'ev1').items[0].by).toBe('Ben')
    expect(C.sent).toEqual([])   // only hosts forward
    const notAttending = device('Cleo', { events: [{ ...EV, attended: false }] })
    expect(await notAttending.chat.onEnvelope({ id: 'peer-h' }, gc({}))).toBe(false)
  })

  it('joins and leaves are announced by the host; a joiner gets the recent history; a member who left gets nothing more', async () => {
    const H = device('Hanna')
    await H.chat.send('ev1', 'welcome')
    H.sent.length = 0
    const xena = H.s.people.find((p) => p.name === 'Xena')
    xena.events = ['ev1']
    expect(await H.chat.announce('ev1', 'px', 'join')).toBe(true)
    expect(await H.chat.announce('ev1', 'px', 'join')).toBe(false)   // already announced
    const joinItem = threadOf(H.s, 'ev1').items.at(-1)
    expect(joinItem).toMatchObject({ k: 'join', by: 'Xena' })
    expect(H.sent.filter((x) => x.env.gc.k === 'join').map((x) => x.to).sort()).toEqual(['peer-b', 'peer-c', 'peer-x'])
    expect(H.sent.filter((x) => x.to === 'peer-x' && x.env.gc.k === 'msg').map((x) => x.env.gc.text)).toEqual(['welcome'])
    H.sent.length = 0
    expect(await H.chat.onEnvelope({ id: 'peer-c' }, gc({ m: 'lc1', k: 'leave', by: 'Cleo', text: undefined, ts: 5000 }))).toBe(true)
    expect(threadOf(H.s, 'ev1').items.at(-1)).toMatchObject({ k: 'leave', by: 'Cleo' })
    expect(H.sent.map((x) => x.to).sort()).toEqual(['peer-b', 'peer-x'])
    H.sent.length = 0
    await H.chat.send('ev1', 'only the ones still in')
    expect(H.sent.map((x) => x.to).sort()).toEqual(['peer-b', 'peer-x'])
    expect(memberNames(H.s, H.s.events[0])).toEqual(['Hanna', 'Ben', 'Xena'])
    expect(EVENT_CHAT_HISTORY).toBeGreaterThan(0)
  })

  it('I leave: my leave goes out, nothing more arrives; I come back: my join goes out', async () => {
    const B = device('Ben')
    expect(await B.chat.leave('ev1', true)).toBe(true)
    expect(B.sent.at(-1).env.gc).toMatchObject({ k: 'leave', by: 'Ben' })
    expect(await B.chat.onEnvelope({ id: 'peer-h' }, gc({ by: 'Cleo' }))).toBe(false)
    expect(await B.chat.send('ev1', 'hi')).toBeNull()
    expect(await B.chat.leave('ev1', false)).toBe(true)
    expect(B.sent.at(-1).env.gc).toMatchObject({ k: 'join', by: 'Ben' })
    expect(await B.chat.onEnvelope({ id: 'peer-h' }, gc({ by: 'Cleo' }))).toBe(true)
  })

  it('after an event envelope: a joined (filled) or a yes rsvp announces a join on the host, a no rsvp a leave', async () => {
    const H = device('Hanna')
    const ben = { id: 'peer-b' }
    await H.chat.afterEnvelope(ben, { v: 1, t: 'event', joined: { id: 'ev1' } }, 'filled')
    expect(threadOf(H.s, 'ev1').items.at(-1)).toMatchObject({ k: 'join', by: 'Ben' })
    await H.chat.afterEnvelope(ben, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: false } }, 'answered')
    expect(threadOf(H.s, 'ev1').items.at(-1)).toMatchObject({ k: 'leave', by: 'Ben' })
    await H.chat.afterEnvelope(ben, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } }, 'ignored')
    expect(threadOf(H.s, 'ev1').items.at(-1)).toMatchObject({ k: 'join', by: 'Ben' })
    const n = threadOf(H.s, 'ev1').items.length
    await H.chat.afterEnvelope(ben, { v: 1, t: 'event', joined: { id: 'ev1' } }, 'ignored')
    expect(threadOf(H.s, 'ev1').items.length).toBe(n)
    const B = device('Ben')
    await B.chat.afterEnvelope({ id: 'peer-h' }, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } }, 'answered')
    expect(threadOf(B.s, 'ev1').items).toEqual([])   // only a host announces
  })

  it('read state and the unread total', async () => {
    const H = device('Hanna')
    await H.chat.onEnvelope({ id: 'peer-b' }, gc({}))
    await H.chat.onEnvelope({ id: 'peer-c' }, gc({ m: 'c1', by: 'Cleo' }))
    expect(eventChatUnread(H.s)).toBe(2)
    H.chat.markRead('ev1')
    expect(eventChatUnread(H.s)).toBe(0)
  })
})
