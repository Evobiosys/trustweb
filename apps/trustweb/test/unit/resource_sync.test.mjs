// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave46 iyg-shared-resource: one resource in a community AND its events, synced. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { addBoth, partitionScope } from '../../src/resource_scope.ts'
import { addEventPrivate } from '../../src/resource_scope.ts'
import { applyIncoming, createResourceSync, fingerprint, payloadOf, recipientsOf, syncedMine } from '../../src/resource_sync.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { eventTagLabel, eventTagSlug } from '../../src/event_tag.ts'

const NOW = Date.parse('2026-11-24T10:00:00Z')
const et = { slug: eventTagSlug, label: eventTagLabel }
const ev1 = { id: 'e1', name: 'Winter OG', communityId: 'iyg' }
const ev2 = { id: 'e2', name: 'Summer OG', communityId: 'iyg' }
const person = (id, name, extra = {}) => ({ id, name, ring: 'friends', peerId: `peer-${id}`, lines: [], fields: { iyg: 'true' }, ...extra })
const rec = (over = {}) => ({
  me: { displayName: 'Hanna' },
  people: [person('pa', 'Anna'), person('pb', 'Ben'), person('pz', 'Zed', { fields: {} })],
  events: [{ ...ev1, attended: true, hosts: ['Hanna'], createdAt: 1 }, { ...ev2, attended: true, hosts: ['Hanna'], createdAt: 1 }],
  inventory: [], ...over,
})
const res = (over = {}) => ({ id: 'r1', text: 'Sled guide', communityId: 'iyg', eventIds: ['e1'], updatedAt: NOW, by: 'Hanna', ...over })
const holds = (tag) => tag === 'iyg'
const evOf = (s, id) => s.events.find((e) => e.id === id)

describe('addBoth (scope partition)', () => {
  it('one item carries the community, the event(s) and both tags, rings closed, marked synced', () => {
    const items = []
    const i = addBoth(items, [ev1, ev2], et, 'resources', ' Sled ', 'r1', NOW, { kind: 'typed' })
    expect(i).toMatchObject({ id: 'r1', text: 'Sled', audience: 'me', communityId: 'iyg', eventId: 'e1', eventIds: ['e1', 'e2'], synced: true, updatedAt: NOW })
    expect(i.tagAudience).toEqual(['iyg', eventTagSlug('Winter OG'), eventTagSlug('Summer OG')])
    expect(addBoth(items, [ev1], et, 'resources', '  ', 'r2', NOW, { kind: 'typed' })).toBeNull()
    expect(addBoth(items, [{ id: 'x', name: 'Free' }], et, 'resources', 'T', 'r3', NOW, { kind: 'typed' })).toBeNull()
  })
  it('shows in the community view and in every event view', () => {
    const items = []
    addBoth(items, [ev1, ev2], et, 'resources', 'Sled', 'r1', NOW, { kind: 'typed' })
    const ids = (sc) => partitionScope(items, sc).shared.map((x) => x.id)
    expect(ids({ kind: 'community', id: 'iyg', label: 'IYG' })).toEqual(['r1'])
    expect(ids({ kind: 'event', id: 'e1', label: 'x', tagIds: [] })).toEqual(['r1'])
    expect(ids({ kind: 'event', id: 'e2', label: 'x', tagIds: [] })).toEqual(['r1'])
    expect(ids({ kind: 'event', id: 'e9', label: 'x', tagIds: [] })).toEqual([])
  })
  it('a received retracted item is hidden in both views', () => {
    const items = [{ id: 'r1', text: 'T', audience: 'me', included: false, createdAt: 1, sharedBy: 'Hanna', communityId: 'iyg', eventId: 'e1', eventIds: ['e1'], retractedAt: 5 }]
    expect(partitionScope(items, { kind: 'community', id: 'iyg', label: 'IYG' }).fresh).toEqual([])
    expect(partitionScope(items, { kind: 'event', id: 'e1', label: 'x', tagIds: [] }).fresh).toEqual([])
  })
})

describe('what is synced', () => {
  it('only my both-scoped items; an event-private item (wave45) never', () => {
    const items = []
    addBoth(items, [ev1], et, 'resources', 'Both', 'r1', NOW, { kind: 'typed' })
    addEventPrivate(items, ev1, et, 'resources', 'Private', 'r2', NOW, { kind: 'typed' })
    expect(items.map(syncedMine)).toEqual([true, false])
    expect(syncedMine({ ...items[0], sharedBy: 'Hanna' })).toBe(false)
  })
  it('the fingerprint moves with an edit, not with a read mark', () => {
    const i = { id: 'r1', text: 'A', audience: 'me', included: true, createdAt: 1, synced: true, communityId: 'iyg', eventIds: ['e1'] }
    const a = fingerprint(i)
    expect(fingerprint({ ...i, openedAt: 4 })).toBe(a)
    expect(fingerprint({ ...i, text: 'B' })).not.toBe(a)
    expect(fingerprint({ ...i, included: false })).not.toBe(a)
    expect(fingerprint({ ...i, link: 'https://x.org' })).not.toBe(a)
    expect(fingerprint({ ...i, blocks: [{ id: 'b', text: 't', children: [] }] })).not.toBe(a)
  })
  it('payloadOf carries the item as the wire holds it; retracted when switched off', () => {
    const i = { id: 'r1', text: 'A', audience: 'me', included: true, createdAt: 3, synced: true, communityId: 'iyg', eventId: 'e1', eventIds: ['e1', 'e2'], kind: 'link', link: 'https://x.org' }
    expect(payloadOf(i, 'Hanna')).toEqual({ id: 'r1', text: 'A', communityId: 'iyg', eventIds: ['e1', 'e2'], updatedAt: 3, by: 'Hanna', kind: 'link', link: 'https://x.org' })
    expect(payloadOf({ ...i, included: false, updatedAt: 9 }, 'Hanna')).toMatchObject({ retracted: true, updatedAt: 9 })
  })
})

describe('wire', () => {
  const env = (r) => ({ v: 1, t: 'event', res: r })
  it('round-trips and bounds', () => {
    const r = res({ kind: 'link', link: 'https://x.org/a', blocks: [{ id: 'b', text: 't', children: [] }] })
    expect(decodeFromQr(encodeForQr(env(r)))).toEqual(env(r))
    expect(decodeFromQr(encodeForQr(env({ ...r, retracted: true }))).res).toEqual({ id: 'r1', retracted: true, updatedAt: NOW, communityId: 'iyg' }) // iyg-reviewfix F5
    for (const bad of [res({ text: '' }), res({ text: 'x'.repeat(121) }), res({ eventIds: [] }), res({ eventIds: ['a b'] }), res({ by: '' }), res({ updatedAt: 'x' }), res({ kind: 'nope' }), res({ link: 'javascript:alert(1)' }), res({ blocks: 'x' }), res({ id: '../x' })])
      expect(decodeFromQr(encodeForQr(env(bad)))).toBeNull()
  })
  it('an old client (no res reader) rejects it as an event envelope with neither want nor link', () => {
    const s = JSON.stringify(env(res()))
    expect(JSON.parse(s).want).toBeUndefined()
    expect(JSON.parse(s).link).toBeUndefined()
  })
})

describe('recipients', () => {
  it('connected community holders and event people, never outsiders', () => {
    const s = rec({ people: [person('pa', 'Anna'), person('pc', 'Cleo', { fields: {}, events: ['e1'] }), person('pz', 'Zed', { fields: {} }), person('pd', 'Dan', { peerId: undefined }), person('pv', 'Via', { via: { by: 'x' } })] })
    expect(recipientsOf(s, { communityId: 'iyg', eventIds: ['e1'] }).map((p) => p.id).sort()).toEqual(['pa', 'pc'])
  })
})

describe('merge on receive', () => {
  const anna = person('pa', 'Anna')
  const hanna = person('ph', 'Hanna')
  it('stores a new item read-only: sharedBy, sharedFrom, both scopes', () => {
    const s = rec()
    expect(applyIncoming(s, hanna, res({ kind: 'link', link: 'https://x.org' }), NOW, holds)).toBe('new')
    expect(s.inventory[0]).toMatchObject({ id: 'r1', text: 'Sled guide', sharedBy: 'Hanna', sharedFrom: 'ph', communityId: 'iyg', eventId: 'e1', eventIds: ['e1'], updatedAt: NOW, kind: 'link', link: 'https://x.org', audience: 'me' })
    expect(s.inventory[0].tagAudience).toBeUndefined()
    expect(s.inventory[0].synced).toBeUndefined()
    expect(partitionScope(s.inventory, { kind: 'community', id: 'iyg', label: 'x' }).fresh).toHaveLength(1)
    expect(partitionScope(s.inventory, { kind: 'event', id: 'e1', label: 'x', tagIds: [] }).fresh).toHaveLength(1)
  })
  it('last writer wins; a tie keeps what I hold; an older one is ignored', () => {
    const s = rec()
    applyIncoming(s, hanna, res(), NOW, holds)
    expect(applyIncoming(s, hanna, res({ text: 'Newer', updatedAt: NOW + 5 }), NOW, holds)).toBe('updated')
    expect(applyIncoming(s, hanna, res({ text: 'Tie', updatedAt: NOW + 5 }), NOW, holds)).toBe('ignored')
    expect(applyIncoming(s, hanna, res({ text: 'Old', updatedAt: NOW }), NOW, holds)).toBe('ignored')
    expect(s.inventory).toHaveLength(1)
    expect(s.inventory[0].text).toBe('Newer')
  })
  it('a third member cannot rewrite it; the author and the first deliverer can', () => {
    const s = rec({ events: [{ ...ev1, attended: true, hosts: ['Hanna', 'Anna'], createdAt: 1 }] })
    applyIncoming(s, anna, res({ by: 'Hanna' }), NOW, holds) // Anna (a host's relay) delivered first
    expect(applyIncoming(s, person('pb', 'Ben'), res({ text: 'Hijack', updatedAt: NOW + 9 }), NOW, holds)).toBe('ignored')
    expect(applyIncoming(s, anna, res({ text: 'By deliverer', updatedAt: NOW + 10 }), NOW, holds)).toBe('updated')
    expect(applyIncoming(s, hanna, res({ text: 'By author', updatedAt: NOW + 11 }), NOW, holds)).toBe('updated')
    expect(s.inventory[0].text).toBe('By author')
  })
  it('never overwrites my own item with the same id', () => {
    const s = rec({ inventory: [{ id: 'r1', text: 'Mine', audience: 'me', included: true, createdAt: 1 }] })
    expect(applyIncoming(s, hanna, res({ updatedAt: NOW + 5 }), NOW, holds)).toBe('ignored')
    expect(s.inventory[0].text).toBe('Mine')
  })
  it('retract hides it (retractedAt, never deleted); a later update brings it back', () => {
    const s = rec()
    applyIncoming(s, hanna, res(), NOW, holds)
    expect(applyIncoming(s, hanna, res({ updatedAt: NOW + 5, retracted: true }), NOW, holds)).toBe('updated')
    expect(s.inventory[0]).toMatchObject({ included: false, retractedAt: NOW + 5 })
    expect(applyIncoming(s, hanna, res({ updatedAt: NOW + 6 }), NOW, holds)).toBe('updated')
    expect(s.inventory[0].retractedAt).toBeUndefined()
    expect(s.inventory[0].included).toBe(true)
  })
  it('refuses a community or event I do not hold, and a sender outside both', () => {
    expect(applyIncoming(rec(), hanna, res({ communityId: 'other', eventIds: ['e9'] }), NOW, holds)).toBe('ignored')
    expect(applyIncoming(rec(), person('pz', 'Zed', { fields: {} }), res(), NOW, holds)).toBe('ignored')
    expect(applyIncoming(rec(), person('pv', 'Via', { via: { by: 'x' } }), res(), NOW, holds)).toBe('ignored')
    expect(applyIncoming(rec(), { ...hanna, deleted_at: 1 }, res(), NOW, holds)).toBe('ignored')
  })
  it('takes the event link when I attend it though I do not hold the community tag', () => {
    const s = rec()
    expect(applyIncoming(s, hanna, res(), NOW, () => false)).toBe('new')
  })
  it('cleans text, link and outline; clamps a clock far ahead', () => {
    const s = rec()
    const blocks = [{ id: 'b1', text: 'one', children: [{ id: 'b2', text: 'two', children: [] }] }, { id: '../bad', text: 'x', children: [] }, 'junk']
    applyIncoming(s, hanna, res({ blocks, updatedAt: NOW + 999 * 3600_000 }), NOW, holds)
    expect(s.inventory[0].blocks).toEqual([{ id: 'b1', text: 'one', children: [{ id: 'b2', text: 'two', children: [] }] }])
    expect(s.inventory[0].updatedAt).toBeLessThanOrEqual(NOW + 5 * 60_000)
  })
  it('a forwarded author name counts only from a host of the event; else the sender is the author', () => {
    const s = rec({ events: [{ ...ev1, attended: true, hosts: ['Anna'], createdAt: 1 }] })
    applyIncoming(s, anna, res({ by: 'Hanna' }), NOW, holds)
    expect(s.inventory[0].sharedBy).toBe('Hanna')
    const t = rec()
    applyIncoming(t, person('pb', 'Ben'), res({ by: 'Hanna' }), NOW, holds)
    expect(t.inventory[0].sharedBy).toBe('Ben')
  })
  it('property (no fast-check dependency): same-origin updates give the same item in any order, and twice is the same as once', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let round = 0; round < 60; round++) {
      const n = 1 + Math.floor(rnd() * 8)
      const updates = Array.from({ length: n }, (_, k) => ({ text: `t${k}-${Math.floor(rnd() * 99)}`, at: k + 1 }))
      const run = (list) => { const s = rec(); for (const u of list) applyIncoming(s, hanna, res({ text: u.text, updatedAt: NOW + u.at }), NOW + 100, holds); return s.inventory[0]?.text }
      const shuffled = [...updates].sort(() => rnd() - 0.5)
      expect(run(shuffled)).toBe(run(updates))
      expect(run([...updates, ...updates])).toBe(run(updates))
      expect(run(updates)).toBe(updates[n - 1].text)
    }
  })
})

describe('engine', () => {
  function world(over = {}) {
    const s = rec(over)
    const sent = []
    const peers = ['pa', 'pb', 'pz', 'pn'].map((id) => ({ id: `peer-${id}` }))
    let now = NOW
    const sync = createResourceSync({ state: () => s, save: () => {}, now: () => now, peers: () => peers, send: async (p, e) => { sent.push([p.id, e]) }, holdsCommunity: holds, changed: () => {} })
    return { s, sent, sync, tick: (ms) => { now += ms } }
  }
  const mine = () => ({ id: 'r1', text: 'Sled', audience: 'me', included: true, createdAt: NOW, synced: true, communityId: 'iyg', eventId: 'e1', eventIds: ['e1'], tagAudience: ['iyg'] })
  it('sweep sends a new item to the community and the event people only, then nothing until an edit', async () => {
    const w = world({ inventory: [mine()] })
    expect(await w.sync.sweep()).toBe(2)
    expect(w.sent.map((x) => x[0]).sort()).toEqual(['peer-pa', 'peer-pb'])
    expect(w.sent[0][1].res).toMatchObject({ id: 'r1', text: 'Sled', by: 'Hanna', communityId: 'iyg', eventIds: ['e1'] })
    expect(await w.sync.sweep()).toBe(0)
    w.tick(1000)
    w.s.inventory[0].text = 'Sled v2'
    expect(await w.sync.sweep()).toBe(2)
    expect(w.s.inventory[0].updatedAt).toBe(NOW + 1000)
    expect(w.sent.at(-1)[1].res).toMatchObject({ text: 'Sled v2', updatedAt: NOW + 1000 })
  })
  it('switching it off retracts; removing it from the list retracts too', async () => {
    const w = world({ inventory: [mine()] })
    await w.sync.sweep()
    w.tick(10)
    w.s.inventory[0].included = false
    await w.sync.sweep()
    expect(w.sent.at(-1)[1].res.retracted).toBe(true)
    w.tick(10)
    w.s.inventory.length = 0
    await w.sync.sweep()
    expect(w.sent.at(-1)[1].res).toMatchObject({ id: 'r1', retracted: true })
  })
  it('an event-private item is never sent', async () => {
    const items = []
    addEventPrivate(items, ev1, et, 'resources', 'Private', 'r2', NOW, { kind: 'typed' })
    const w = world({ inventory: items })
    expect(await w.sync.sweep()).toBe(0)
    expect(w.sent).toEqual([])
  })
  it('a host forwards a new item once to its other people (not the sender, not the author), never twice', async () => {
    const w = world({ people: [person('ph', 'Hanna'), person('pa', 'Anna'), person('pb', 'Ben'), person('pz', 'Zed', { fields: {} })], me: { displayName: 'Hosty' }, events: [{ ...ev1, attended: true, hosts: ['Hosty'], createdAt: 1 }] })
    expect(await w.sync.onEnvelope({ id: 'peer-ph' }, res())).toBe(true)
    expect(w.sent.map((x) => x[0]).sort()).toEqual(['peer-pa', 'peer-pb'])
    expect(w.sent[0][1].res.by).toBe('Hanna')
    expect(await w.sync.onEnvelope({ id: 'peer-ph' }, res())).toBe(false)
    expect(w.sent).toHaveLength(2)
  })
  it('a guest keeps it and forwards nothing', async () => {
    const w = world({ events: [{ ...ev1, attended: true, hosts: ['Hanna'], createdAt: 1 }], me: { displayName: 'Gus' }, people: [person('ph', 'Hanna'), person('pa', 'Anna')] })
    expect(await w.sync.onEnvelope({ id: 'peer-ph' }, res())).toBe(true)
    expect(w.sent).toEqual([])
    expect(w.s.inventory).toHaveLength(1)
  })
  it('catch-up sends a newly connected member what changed since the last send, at most once per gap', async () => {
    const w = world({ inventory: [mine()], people: [person('pa', 'Anna'), person('pb', 'Ben'), person('pn', 'Newo')] })
    expect(await w.sync.catchUp({ id: 'peer-pn' })).toBe(1)
    expect(await w.sync.catchUp({ id: 'peer-pn' })).toBe(0)
    w.tick(61_000)
    expect(await w.sync.catchUp({ id: 'peer-pn' })).toBe(0)
    w.tick(10)
    w.s.inventory[0].text = 'Edited'
    await w.sync.sweep()
    w.tick(61_000)
    expect(await w.sync.catchUp({ id: 'peer-pn' })).toBe(0)
  })
  it('catch-up sends nothing to an outsider', async () => {
    const w = world({ inventory: [mine()] })
    expect(await w.sync.catchUp({ id: 'peer-pz' })).toBe(0)
  })
})

describe('MCP resource_add audience both:<id>', () => {
  function fixture(events) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-w46-sr-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], inventory: [], events }))
    writeFileSync(path.join(dir, 'colourtags.json'), '[]')
    return { by: Object.fromEntries(allTools({ file, write: true, now: () => new Date(NOW) }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('adds ONE synced item in the event and its community', () => {
    const f = fixture([{ id: 'e1', name: 'Winter OG', communityId: 'iyg', from: '2026-12-30', createdAt: 1, attended: true }])
    f.by.resource_add.run({ title: 'Sled', audience: 'both:e1' })
    expect(f.rec().inventory[0]).toMatchObject({ text: 'Sled', audience: 'me', communityId: 'iyg', eventId: 'e1', eventIds: ['e1'], synced: true, tagAudience: ['iyg', eventTagSlug('Winter OG')] })
  })
  it('refuses an event without a community', () => {
    const f = fixture([{ id: 'e1', name: 'Solo', from: '2026-12-30', createdAt: 1, attended: true }])
    expect(() => f.by.resource_add.run({ title: 'Sled', audience: 'both:e1' })).toThrow(/community/)
    expect(f.rec().inventory).toEqual([])
  })
})
