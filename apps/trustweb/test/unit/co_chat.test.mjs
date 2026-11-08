// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 37 (co-notes-link): the group chat of a co-note over the sealed notes relay (src/ext/co_notes/co_chat.ts).
import { acceptMsg, addMsg, cleanMsg, newMsg, parseMsg, pollChat, sendMsg, wrapMsg } from '../../src/ext/co_notes/co_chat.ts'
import { newDoc } from '../../src/ext/co_notes/co_doc.ts'
import { createIdentity } from '../../../demo/src/did.ts'

const NOW = 1_800_000_000_000
const ANNA = createIdentity('https://x.invalid/relay')
const BEN = createIdentity('https://x.invalid/relay')
const CARA = createIdentity('https://x.invalid/relay')
const a = { did: ANNA.did, name: 'Anna' }
const b = { did: BEN.did, name: 'Ben' }
const c = { did: CARA.did, name: 'Cara' }
const doc = { ...newDoc({ id: 'co1', title: 'Trip', me: a, at: NOW }), people: [a, b, c] }
const known = (...dids) => (did) => dids.includes(did)

function fakeServer() {
  const box = []
  let n = 0
  const fetch = async (url, init = {}) => {
    const u = new URL(url, 'https://x.invalid')
    const json = (status, body) => ({ status, ok: status < 300, json: async () => body })
    if (init.method === 'POST') { const body = JSON.parse(init.body); const id = `id${n++}`; box.push({ id, ...body }); return json(201, { id }) }
    if (init.method === 'DELETE') { const i = box.findIndex((x) => x.id === u.searchParams.get('id')); if (i >= 0) box.splice(i, 1); return { status: 204, ok: true } }
    const id = u.searchParams.get('id')
    if (id) { const m = box.find((x) => x.id === id); return m ? json(200, m) : json(404, {}) }
    const mine = box.filter((x) => x.to === u.searchParams.get('for'))
    return mine.length ? json(200, { items: mine.map(({ id: i, from, size, expires }) => ({ id: i, from, size, expires })) }) : json(404, {})
  }
  return { fetch, box }
}
const deps = (srv) => ({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW })

describe('messages', () => {
  it('a message is clean text with an id, trimmed and capped; empty is nothing', () => {
    const m = newMsg('co1', a, '  hello  ', NOW)
    expect(m).toMatchObject({ note: 'co1', from: a, text: 'hello', at: NOW })
    expect(m.id).toBeTruthy()
    expect(newMsg('co1', a, '   ', NOW)).toBeNull()
    expect(newMsg('co1', a, 'x'.repeat(900), NOW).text).toHaveLength(500)
  })
  it('cleanMsg drops garbage and unknown fields', () => {
    const m = newMsg('co1', a, 'hi', NOW)
    expect(cleanMsg({ ...m, extra: 1 })).not.toHaveProperty('extra')
    expect(cleanMsg({ ...m, text: 5 })).toBeNull()
    expect(cleanMsg(null)).toBeNull()
    expect(cleanMsg({ ...m, from: { did: 5 } })).toBeNull()
  })
  it('addMsg sorts by time, drops duplicates and keeps the last 200', () => {
    const m1 = newMsg('co1', a, 'one', NOW)
    const m2 = newMsg('co1', b, 'two', NOW + 1)
    expect(addMsg(addMsg([m2], m1), m2).map((m) => m.text)).toEqual(['one', 'two'])
    let l = []
    for (let i = 0; i < 250; i++) l = addMsg(l, newMsg('co1', a, `m${i}`, NOW + i))
    expect(l).toHaveLength(200)
    expect(l.at(-1).text).toBe('m249')
  })
})

describe('payload and trust', () => {
  it('a chat payload parses as chat; a doc payload or a plain note does not', () => {
    const m = newMsg('co1', a, 'hi', NOW)
    expect(parseMsg(wrapMsg(m))?.text).toBe('hi')
    expect(parseMsg({ k: 'co', doc: {} })).toBeNull()
    expect(parseMsg({ title: 'x' })).toBeNull()
  })
  it('accepted only from a participant of that note, and only in their own name (I8)', () => {
    const m = newMsg('co1', b, 'hi', NOW)
    expect(acceptMsg(doc, BEN.did, m)).toBe(true)
    expect(acceptMsg(doc, CARA.did, m)).toBe(false) // Cara posting as Ben
    expect(acceptMsg(doc, 'did:stranger', { ...m, from: { did: 'did:stranger', name: 'Eve' } })).toBe(false)
    expect(acceptMsg(undefined, BEN.did, m)).toBe(false)
    expect(acceptMsg(doc, BEN.did, { ...m, note: 'other' })).toBe(false)
  })
})

describe('sealed through the relay to every other participant', () => {
  it('Anna posts, Ben and Cara each read it once; nothing readable on the server; Anna gets nothing back', async () => {
    const srv = fakeServer()
    const m = newMsg('co1', a, 'secret lunch plan', NOW)
    expect(await sendMsg(deps(srv), doc, m, ANNA, known(BEN.did, CARA.did))).toBe(2)
    expect(JSON.stringify(srv.box)).not.toContain('lunch')
    const ben = await pollChat(deps(srv), BEN, known(ANNA.did))
    expect(ben).toEqual([{ from: ANNA.did, msg: m }])
    expect(await pollChat(deps(srv), BEN, known(ANNA.did))).toEqual([])
    expect((await pollChat(deps(srv), CARA, known(ANNA.did)))).toHaveLength(1)
    expect(await pollChat(deps(srv), ANNA, known(BEN.did))).toEqual([])
  })
  it('a sender this phone does not know is not read', async () => {
    const srv = fakeServer()
    await sendMsg(deps(srv), doc, newMsg('co1', a, 'hi', NOW), ANNA, known(BEN.did))
    expect(await pollChat(deps(srv), BEN, known())).toEqual([])
    expect(srv.box).toHaveLength(1)
  })
})
