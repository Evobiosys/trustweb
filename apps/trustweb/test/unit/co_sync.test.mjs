// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Co-notes over the notes relay (src/ext/co_notes/co_sync.ts): payload kind, recipients, receive rules, two phones through a fake relay.
import { audit, parseDoc, pollDocs, receive, recipients, sendDoc, wrapDoc } from '../../src/ext/co_notes/co_sync.ts'
import { editText, insertAfter, newDoc, setShare, toText, tree } from '../../src/ext/co_notes/co_doc.ts'
import { pollRelay, postNote } from '../../src/notes_relay.ts'
import { newNote } from '../../src/notes_outline.ts'
import { createIdentity } from '../../../demo/src/did.ts'

const NOW = 1_800_000_000_000
const ANNA = createIdentity('https://x.invalid/relay')
const BEN = createIdentity('https://x.invalid/relay')
const CARA = createIdentity('https://x.invalid/relay')
const a = { did: ANNA.did, name: 'Anna' }
const b = { did: BEN.did, name: 'Ben' }
const c = { did: CARA.did, name: 'Cara' }

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
const shared = () => {
  let d = newDoc({ id: 'co1', title: 'Trip', me: a, at: NOW })
  d = { ...d, people: [a, b] }
  return insertAfter(d, null, 'pack @[Cara](tw:p7)', a, NOW).doc
}
const known = (...dids) => (did) => dids.includes(did)

describe('payload kind', () => {
  it('a co payload parses as a doc; a plain note payload does not', () => {
    const d = shared()
    expect(parseDoc(wrapDoc(d))?.id).toBe('co1')
    expect(parseDoc(newNote({ title: 't', text: '- x', by: a, at: NOW }))).toBeNull()
    expect(parseDoc(null)).toBeNull()
    expect(parseDoc({ k: 'co', doc: 5 })).toBeNull()
  })
  it('old readers keep working: pollRelay ignores a co doc and leaves it, still reads a plain note', async () => {
    const srv = fakeServer()
    await sendDoc(deps(srv), shared(), ANNA, known(BEN.did))
    await postNote(deps(srv), newNote({ title: 't', text: '- x', by: a, at: NOW }), ANNA, BEN.did)
    const got = await pollRelay(deps(srv), BEN)
    expect(got).toHaveLength(1)
    expect(got[0].note.title).toBe('t')
    expect(srv.box).toHaveLength(1)
    expect(await pollDocs(deps(srv), BEN, known(ANNA.did))).toHaveLength(1)
    expect(srv.box).toHaveLength(0)
  })
})

describe('send', () => {
  it('goes sealed to each participant that is known, never to me or a stranger, with local chips degraded and "me" lines left out', async () => {
    const srv = fakeServer()
    let d = { ...shared(), people: [a, b, c, { did: 'did:stranger', name: 'Eve' }] }
    const secret = insertAfter(d, null, 'my secret', a, NOW)
    d = setShare(secret.doc, secret.id, 'me', a)
    expect(recipients(d, ANNA.did, known(BEN.did, CARA.did))).toEqual([BEN.did, CARA.did])
    expect(await sendDoc(deps(srv), d, ANNA, known(BEN.did, CARA.did))).toBe(2)
    expect(JSON.stringify(srv.box)).not.toContain('secret')
    const [got] = await pollDocs(deps(srv), BEN, known(ANNA.did))
    expect(tree(got.doc).map((r) => r.text)).toEqual(['pack @Cara'])
    expect(srv.box.every((m) => m.to !== 'did:stranger')).toBe(true)
  })
  it('a failing server gives 0, no throw', async () => {
    const down = async () => { throw new Error('offline') }
    expect(await sendDoc({ origin: 'x', fetch: down, now: () => NOW }, shared(), ANNA, known(BEN.did))).toBe(0)
  })
})

describe('receive', () => {
  it('ignores an unknown sender, adds a new doc from a known one, merges from a participant', () => {
    const d = shared()
    expect(receive([], 'did:stranger', d, known(BEN.did))).toBeNull()
    expect(receive([], BEN.did, d, known(BEN.did))?.docs).toHaveLength(1)
    const mine = { ...d, mode: 'text' }
    const theirs = editText(d, tree(d)[0].id, 'pack more', b)
    const out = receive([mine], BEN.did, theirs, () => false)
    expect(out?.docs[0].mode).toBe('text')
    expect(tree(out.docs[0])[0].text).toBe('pack more')
    expect(out.line).toContain('Trip')
  })
  it('a doc from a known person who is not a participant of my copy is still ignored when they are unknown, and an unchanged doc reports nothing', () => {
    const d = shared()
    expect(receive([d], CARA.did, d, () => false)).toBeNull()
    expect(receive([d], BEN.did, d, known(BEN.did))).toBeNull()
  })
})

describe('two phones', () => {
  it('Anna and Ben edit concurrently, exchange through the relay and end with the same text', async () => {
    const srv = fakeServer()
    let anna = shared()
    let ben = receive([], ANNA.did, anna, known(ANNA.did)).docs[0]
    anna = insertAfter(anna, tree(anna)[0].id, 'tickets', a, NOW).doc
    ben = insertAfter(ben, tree(ben)[0].id, 'snacks', b, NOW).doc
    await sendDoc(deps(srv), anna, ANNA, known(BEN.did))
    await sendDoc(deps(srv), ben, BEN, known(ANNA.did))
    for (const x of await pollDocs(deps(srv), BEN, known(ANNA.did))) ben = receive([ben], x.from, x.doc, known(ANNA.did)).docs[0]
    for (const x of await pollDocs(deps(srv), ANNA, known(BEN.did))) anna = receive([anna], x.from, x.doc, known(BEN.did)).docs[0]
    expect(toText(anna)).toBe(toText(ben))
    expect(toText(anna)).toContain('tickets')
    expect(toText(anna)).toContain('snacks')
  })
})

describe('audit', () => {
  it('keeps the last 100 lines, newest last', () => {
    let log
    for (let i = 0; i < 120; i++) log = audit(log, `line ${i}`, NOW + i)
    expect(log).toHaveLength(100)
    expect(log[99]).toContain('line 119')
    expect(log[0]).toContain('line 20')
  })
})

describe('own devices', () => {
  it('coNotes ride in the sync bundle and merge document by document, not whole-field', async () => {
    const { bundleOf, mergeBundle, refreshStamps } = await import('../../src/sync_core.ts')
    await import('../../src/ext/co_notes/index.ts')
    const state = (over) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
    const base = shared()
    const mac = state({ coNotes: [editText(base, tree(base)[0].id, 'mac edit', a)] })
    const phone = state({ coNotes: [insertAfter(base, tree(base)[0].id, 'phone line', b, NOW).doc, { ...newDoc({ id: 'co2', title: 'Other', me: b, at: NOW }) }] })
    const res = mergeBundle(mac, refreshStamps(mac, {}, 1, 'T'), bundleOf(phone, refreshStamps(phone, {}, 1, 'T')), 0)
    expect(res.added + res.updated).toBeGreaterThan(0)
    expect(mac.coNotes.map((d) => d.id).sort()).toEqual(['co1', 'co2'])
    const texts = tree(mac.coNotes.find((d) => d.id === 'co1')).map((r) => r.text)
    expect(texts).toContain('mac edit')
    expect(texts).toContain('phone line')
  })
  it('a hostile coNotes value from another device is cleaned, never thrown on', async () => {
    const { mergeBundle, refreshStamps, bundleOf } = await import('../../src/sync_core.ts')
    await import('../../src/ext/co_notes/index.ts')
    const state = (over) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
    const mac = state({ coNotes: [shared()] })
    const phone = state({ coNotes: [shared()] })
    const bundle = bundleOf(phone, refreshStamps(phone, {}, 1, 'T'))
    bundle.settings.coNotes = [null, 5, { id: 'x', blocks: 'bad' }, ...bundle.settings.coNotes]
    expect(() => mergeBundle(mac, refreshStamps(mac, {}, 1, 'T'), bundle, 0)).not.toThrow()
    expect(mac.coNotes.map((d) => d.id)).toEqual(['co1'])
  })
})
