// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list: the group engine (group_chat.ts) over a fake transport. Ana creates "Flat"; Ben and Cleo are connected to Ana only and
 * come in through her invite (admit / joined). A message, a list item, a check (with its quiet line in the chat) reach everyone by flooding:
 * each device passes a new op on to its other members, never back; ids and last-writer-wins stop loops. Leave: nothing more reaches the leaver.
 * The wire parse of `gg` is checked here too. Fake names only.
 */
import { createGroupChat } from '../../src/group_chat.ts'
import { mergeGroups } from '../../src/group_store.ts'
import { SETTING_MERGERS } from '../../src/sync_core.ts'
import { decodeFromQr } from '../../../demo/src/wire.ts'

const parseEnvelope = (o) => decodeFromQr(JSON.stringify(o))

const NAMES = { a: 'Ana', b: 'Ben', c: 'Cleo' }
function world(links) {
  const dev = {}
  let clock = 10_000
  let seq = 0
  const wire = []
  for (const k of Object.keys(NAMES)) {
    const others = links.filter((l) => l.includes(k)).map((l) => l.replace(k, ''))
    const state = {
      v: 1, me: { id: k, displayName: NAMES[k] }, log: [], inventory: [],
      peers: others.map((o) => ({ id: `p-${o}`, displayName: NAMES[o] })),
      people: others.map((o) => ({ id: `${k}-${o}`, name: NAMES[o], ring: 'friend', lines: [], peerId: `p-${o}` })),
    }
    dev[k] = { state, changed: [] }
    dev[k].chat = createGroupChat({
      state: () => state, save: () => {}, now: () => ++clock, newId: () => `${k}${++seq}`, peers: () => state.peers,
      send: async (peer, env) => {
        const to = peer.id.slice(2)
        if (dev[to].offline) throw new Error('offline')
        const parsed = parseEnvelope(env)   // what the receiver's wire parse lets through
        expect(parsed).toEqual(env)
        wire.push([k, to, env.gg.k])
        await dev[to].chat.onEnvelope({ id: `p-${k}` }, parsed.gg)
      },
      changed: (g) => dev[k].changed.push(g),
    })
  }
  return { dev, wire }
}
const G = (d) => Object.values(d.state.chatGroups ?? {})[0]

async function flat() {
  const w = world(['ab', 'ac'])
  const { a, b, c } = w.dev
  const gid = a.chat.create('Flat')
  expect(gid).toBeTruthy()
  // Ben and Cleo opened Ana's group invite: their devices hold the group with Ana; Ana's device admits them
  expect(b.chat.joined(gid, 'Flat', 'b-a')).toBe(true)
  expect(c.chat.joined(gid, 'Flat', 'c-a')).toBe(true)
  expect(await a.chat.admit(gid, 'a-b')).toBe(true)
  expect(await a.chat.admit(gid, 'a-c')).toBe(true)
  return { ...w, gid }
}

describe('a group: create, admit, members', () => {
  it('the creator holds the group, one active list; joiners get the roster, the lists and the join notices', async () => {
    const { dev: { a, b, c }, gid } = await flat()
    expect(G(a)).toMatchObject({ id: gid, name: 'Flat' })
    expect(G(a).lists).toHaveLength(1)
    expect(G(c).lists.map((l) => l.id)).toEqual(G(a).lists.map((l) => l.id))
    const names = (d) => Object.values(G(d).mem).filter((m) => m.on).map((m) => m.name || 'me').sort()
    expect(names(a)).toEqual(['Ben', 'Cleo', 'me'])
    expect(names(c)).toEqual(['Ana', 'Ben', 'me'])
    expect(G(b).items.filter((i) => i.k === 'join').map((i) => i.by)).toEqual(['Ben', 'Cleo'])
    expect(await a.chat.admit(gid, 'a-b')).toBe(false)   // already in
    expect(a.chat.create('  ')).toBeNull()
  })
})

describe('flooding: one thread, one list, for everyone', () => {
  it('Ben writes, Cleo reads it (passed on by Ana); each device holds it once; nothing goes back to the sender', async () => {
    const { dev: { a, b, c }, gid, wire } = await flat()
    wire.length = 0
    const item = await b.chat.send(gid, ' tea tonight? ')
    expect(item).toMatchObject({ k: 'msg', text: 'tea tonight?', mine: true, state: 'sent' })
    for (const d of [a, c]) expect(G(d).items.filter((i) => i.k === 'msg').map((i) => [i.by, i.text])).toEqual([['Ben', 'tea tonight?']])
    expect(G(c).unread).toBe(1)
    expect(wire).toEqual([['b', 'a', 'msg'], ['a', 'c', 'msg']])
    expect(await b.chat.send(gid, '   ')).toBeNull()
  })
  it('a list item added by Cleo, checked by Ben: everyone sees who checked it, and a quiet line in the chat', async () => {
    const { dev: { a, b, c }, gid } = await flat()
    const id = await c.chat.addItem(gid, 'Oat milk')
    expect(id).toBeTruthy()
    for (const d of [a, b]) expect(G(d).li.map((i) => i.text)).toEqual(['Oat milk'])
    expect(await b.chat.check(gid, id, true)).toBe(true)
    for (const d of [a, b, c]) {
      expect(G(d).li[0].done).toMatchObject({ by: 'Ben' })
      expect(G(d).items.filter((i) => i.k === 'check').map((i) => [i.by, i.text])).toEqual([['Ben', 'Oat milk']])
    }
    expect(await a.chat.check(gid, id, false)).toBe(true)
    expect(G(c).li[0].done).toBeUndefined()
    expect(G(c).items.filter((i) => i.k === 'check')).toHaveLength(1)   // unchecking posts nothing
  })
  it('several lists, one active; move and archive done travel', async () => {
    const { dev: { a, b, c }, gid } = await flat()
    const l2 = await b.chat.listCreate(gid, 'Hardware')
    expect(G(c).lists.map((l) => l.name)).toEqual([G(a).lists[0].name, 'Hardware'])
    expect(await c.chat.setActive(gid, l2)).toBe(true)
    expect(G(a).active.id).toBe(l2)
    const x = await a.chat.addItem(gid, 'Screws')
    const y = await a.chat.addItem(gid, 'Glue')
    expect(G(b).li.filter((i) => i.l === l2).map((i) => i.text)).toEqual(['Screws', 'Glue'])   // goes to the active list
    expect(await b.chat.move(gid, y, -1)).toBe(true)
    const order = (d) => G(d).li.filter((i) => i.l === l2 && !i.arc).sort((p, q) => p.o - q.o).map((i) => i.text)
    expect(order(c)).toEqual(['Glue', 'Screws'])
    expect(await b.chat.move(gid, y, -1)).toBe(false)   // already first
    await c.chat.check(gid, x, true)
    expect(await a.chat.archiveDone(gid, l2)).toBe(1)
    expect(order(b)).toEqual(['Glue'])
    expect(G(c).li.find((i) => i.id === x).arc).toBe(true)
  })
})

describe('leave and refusals', () => {
  it('Cleo leaves: the others see it, nothing new reaches her; she cannot write; she can come back', async () => {
    const { dev: { a, b, c }, gid, wire } = await flat()
    expect(await c.chat.leave(gid, true)).toBe(true)
    expect(G(b).items.at(-1)).toMatchObject({ k: 'leave', by: 'Cleo' })
    wire.length = 0
    await b.chat.send(gid, 'after')
    expect(G(c).items.some((i) => i.text === 'after')).toBe(false)
    expect(wire.some(([, to]) => to === 'c')).toBe(false)   // nothing is even sent to her
    expect(await a.chat.onEnvelope({ id: 'p-c' }, { g: gid, m: 'zz', k: 'msg', by: 'Cleo', ts: 1, text: 'still here' })).toBe(false)   // nor taken from her
    expect(await c.chat.send(gid, 'hello?')).toBeNull()
    expect(await c.chat.leave(gid, false)).toBe(true)
    await b.chat.send(gid, 'welcome back')
    expect(G(c).items.some((i) => i.text === 'welcome back')).toBe(true)
  })
  it('ops from a stranger or for an unknown group are dropped', async () => {
    const { dev: { a }, gid } = await flat()
    expect(await a.chat.onEnvelope({ id: 'p-zz' }, { g: gid, m: 'z1', k: 'msg', by: 'Eve', ts: 1, text: 'spam' })).toBe(false)
    expect(await a.chat.onEnvelope({ id: 'p-b' }, { g: 'nope', m: 'z2', k: 'msg', by: 'Ben', ts: 1, text: 'x' })).toBe(false)
    expect(await a.chat.onEnvelope({ id: 'p-b' }, { g: gid, m: 'z3', k: 'msg', by: 'Ben', ts: 1, text: 'ok' })).toBe(true)
    expect(await a.chat.onEnvelope({ id: 'p-b' }, { g: gid, m: 'z3', k: 'msg', by: 'Ben', ts: 1, text: 'ok' })).toBe(false)
  })
  it('an unreachable member: my message waits and goes on retry; a list change goes on retry', async () => {
    const { dev: { a, b }, gid } = await flat()
    // Ben's only link is Ana: Ana's device is unreachable
    a.offline = true
    const item = await b.chat.send(gid, 'later')
    expect(item.state).toBe('pending')
    await b.chat.addItem(gid, 'Rice')
    expect(G(b).dirty).toBe(true)
    a.offline = false
    expect(await b.chat.retry(gid)).toBe(1)
    expect(G(a).items.some((i) => i.text === 'later')).toBe(true)
    expect(G(a).li.some((i) => i.text === 'Rice')).toBe(true)
    expect(G(b).dirty).toBeUndefined()
  })
})

describe('wire and own devices', () => {
  it('parse: a list op without its list, a msg without text, an over-long item are refused', () => {
    const env = (gg) => parseEnvelope({ v: 1, t: 'event', gg })
    expect(env({ g: 'g1', m: 'm1', k: 'list', by: 'Ana', ts: 1 })).toBeNull()
    expect(env({ g: 'g1', m: 'm1', k: 'msg', by: 'Ana', ts: 1 })).toBeNull()
    expect(env({ g: 'g1', m: 'm1', k: 'item', by: 'Ana', ts: 1, it: { id: 'i', l: 'l', text: 'x'.repeat(201), o: 1 } })).toBeNull()
    expect(env({ g: 'g1', m: 'm1', k: 'roster', by: 'Ana', ts: 1, text: 'Flat', names: ['Ben'] })?.gg.names).toEqual(['Ben'])
    expect(env({ g: 'g1', m: 'm1', k: 'msg', by: 'Ana', ts: 1, text: 'hi', extra: 1 })?.gg).toEqual({ g: 'g1', m: 'm1', k: 'msg', by: 'Ana', ts: 1, text: 'hi' })
  })
  it('the setting chatGroups merges by its own rule', () => {
    expect(SETTING_MERGERS.get('chatGroups')).toBe(mergeGroups)
  })
})
