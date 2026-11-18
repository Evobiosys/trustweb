// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c answers-44c item 5 (A4 tombstones, Jakob 20:22 "Yes"): deleting an event, resource, task, meeting or invitation travels to every device like
 * a person (30-day tombstone in AppState.trash, restorable from Settings > Recently deleted). Pure trash.ts, sync_core with three records, sync_link with two devices.
 */
import { TRASH_DAYS, TRASH_KINDS, isTrashEntry, purgeTrash, recentlyTrashed, restoreTrashed, trashItems, trashKey } from '../../src/trash.ts'
import { SYNC_EXCLUDED, bundleOf, deltaOf, mergeBundle, parseBundle, refreshStamps, stampsAfterMerge, syncIdOf } from '../../src/sync_core.ts'
import { createSyncLink } from '../../src/sync_link.ts'

const DAY = 86_400_000
const T0 = Date.parse('2026-11-17T10:00:00Z')
const items = () => ({
  events: [{ id: 'e1', name: 'Picnic', from: '2026-12-01', where: 'Park', createdAt: 1, attended: false }],
  inventory: [{ id: 'r1', text: 'Ladder', tags: [], audience: 'trusted' }],
  tasks: [{ id: 't1', title: 'Bring cake', stamp: 1 }],
  meetings: [{ id: 'm1', about: 'Planning', at: 1, transcript: [] }],
  invitations: [{ kind: 'invitation', id: 'v1', status: 'sent', event: 'Picnic' }],
})
const rec = () => ({ v: 1, me: { displayName: 'J' }, people: [], peers: [], log: [], ...structuredClone(items()) })
const LIST = { event: 'events', resource: 'inventory', task: 'tasks', meeting: 'meetings', invitation: 'invitations' }
const ID = { event: 'e1', resource: 'r1', task: 't1', meeting: 'm1', invitation: 'v1' }

describe('trash.ts', () => {
  it('names the five kinds and keeps them 30 days', () => {
    expect([...TRASH_KINDS]).toEqual(['event', 'resource', 'task', 'meeting', 'invitation'])
    expect(TRASH_DAYS).toBe(30)
    expect(trashKey({ kind: 'event', id: 'e1' })).toBe('x:event:e1')
  })
  it.each(TRASH_KINDS)('%s: delete moves it into the trash, restore puts it back', (kind) => {
    const s = rec()
    const gone = trashItems(s, kind, [ID[kind]], T0)
    expect(gone).toHaveLength(1)
    expect(s[LIST[kind]]).toHaveLength(0)
    expect(s.trash).toEqual([{ kind, id: ID[kind], item: items()[LIST[kind]][0], deleted_at: new Date(T0).toISOString() }])
    expect(isTrashEntry(s.trash[0])).toBe(true)
    expect(recentlyTrashed(s, T0 + DAY).map((t) => t.id)).toEqual([ID[kind]])
    expect(restoreTrashed(s, kind, ID[kind])).toBe(true)
    expect(s[LIST[kind]]).toEqual(items()[LIST[kind]])
    expect(s.trash).toBeUndefined()
    expect(restoreTrashed(s, kind, ID[kind])).toBe(false)
  })
  it('lists newest first, purges after 30 days', () => {
    const s = rec()
    trashItems(s, 'event', ['e1'], T0)
    trashItems(s, 'task', ['t1'], T0 + DAY)
    expect(recentlyTrashed(s, T0 + 2 * DAY).map((t) => t.id)).toEqual(['t1', 'e1'])
    expect(purgeTrash(s, T0 + 30 * DAY + 1)).toBe(1)
    expect(s.trash.map((t) => t.id)).toEqual(['t1'])
    expect(recentlyTrashed(s, T0 + 40 * DAY)).toEqual([])
  })
  it('refuses malformed entries', () => {
    for (const bad of [null, {}, { kind: 'person', id: 'x', item: { id: 'x' }, deleted_at: 'x' }, { kind: 'event', id: 'e1', item: { id: 'e2' }, deleted_at: new Date(T0).toISOString() }, { kind: 'event', id: 'e1', item: { id: 'e1' }, deleted_at: 'not a date' }]) expect(isTrashEntry(bad)).toBe(false)
  })
  it('the trash is not a setting: it travels as its own entities', () => {
    expect(SYNC_EXCLUDED.has('trash')).toBe(true)
  })
})

/** One device: its record and its stamps; `send` = what sync_link does with a bundle (refresh, bundle/delta, the wire, merge, stamps). */
const dev = (name) => ({ name, id: syncIdOf(`did:peer:2.${name}xxxxxxxxxxxxxxxxxxxx`), s: rec(), st: {} })
const refresh = (d, t) => { d.st = refreshStamps(d.s, d.st, t, d.id) }
function send(a, b, t, since = 0) {
  refresh(a, t)
  const raw = since ? deltaOf(a.s, a.st, since, a.id, [b.id]) : bundleOf(a.s, a.st)
  if (!raw) return null
  const bundle = parseBundle(JSON.parse(JSON.stringify(raw)))
  expect(bundle).not.toBeNull()
  refresh(b, t)
  const before = b.st
  const res = mergeBundle(b.s, b.st, bundle, 0)
  b.st = stampsAfterMerge(b.s, before, bundle, t, b.id, a.name)
  return res
}

describe('sync_core: tombstones travel', () => {
  it.each(TRASH_KINDS)('%s: a delete on A reaches B and, through B, C; a restore on C comes back to A', (kind) => {
    const [a, b, c] = [dev('A'), dev('B'), dev('C')]
    send(a, b, T0); send(b, c, T0 + 1)
    trashItems(a.s, kind, [ID[kind]], T0 + 10)
    send(a, b, T0 + 20, T0 + 5)
    expect(b.s[LIST[kind]].map((x) => x.id)).toEqual([])
    expect(b.s.trash.map((x) => x.id)).toEqual([ID[kind]])
    send(b, c, T0 + 30, T0 + 5) // forwarded (A4 + A3 hop)
    expect(c.s[LIST[kind]].map((x) => x.id)).toEqual([])
    expect(recentlyTrashed(c.s, T0 + DAY).map((x) => x.id)).toEqual([ID[kind]])
    restoreTrashed(c.s, kind, ID[kind])
    send(c, b, T0 + 40, T0 + 35); send(b, a, T0 + 50, T0 + 35)
    expect(a.s[LIST[kind]].map((x) => x.id)).toEqual([ID[kind]])
    expect(a.s.trash ?? []).toEqual([])
    expect(b.s.trash ?? []).toEqual([])
  })
  it('a stale full bundle from a device that never heard of the delete does not bring the item back', () => {
    const [a, b] = [dev('A'), dev('B')]
    send(a, b, T0)
    trashItems(a.s, 'event', ['e1'], T0 + 10)
    send(b, a, T0 + 20) // B still has e1 with its old stamp
    expect(a.s.events).toEqual([])
    expect(a.s.trash.map((x) => x.id)).toEqual(['e1'])
    send(a, b, T0 + 30)
    expect(b.s.events).toEqual([])
  })
  it('an edit made after the delete wins over the older delete', () => {
    const [a, b] = [dev('A'), dev('B')]
    send(a, b, T0)
    trashItems(a.s, 'resource', ['r1'], T0 + 10)
    refresh(a, T0 + 10)
    b.s.inventory[0].text = 'Ladder (long)'
    send(b, a, T0 + 30) // B's edit stamped at T0+30 > A's delete at T0+10
    expect(a.s.inventory.map((x) => x.text)).toEqual(['Ladder (long)'])
    expect(a.s.trash ?? []).toEqual([])
  })
  it('an older build without tombstones still parses the bundle (the field is optional)', () => {
    const a = dev('A')
    trashItems(a.s, 'task', ['t1'], T0)
    refresh(a, T0)
    const b = bundleOf(a.s, a.st)
    expect(b.trash).toHaveLength(1)
    expect(parseBundle({ ...JSON.parse(JSON.stringify(b)), trash: [{ kind: 'zzz' }] })).toBeNull()
  })
})

// ---- sync_link: two devices over a fake relay
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
globalThis.location ??= { origin: 'http://127.0.0.1:1' }
function hub() {
  const sinks = new Map()
  const channel = () => {
    let did = ''
    let cb = null
    return {
      connect: async (id) => { did = id.did; sinks.set(did, cb) },
      onRawWire: (f) => { cb = f },
      sendRaw: async (to, payload) => { await new Promise((r) => setTimeout(r, 0)); sinks.get(to)?.(did, payload) },
      close: () => {}, onEnvelope: () => {}, onStatus: () => {}, send: async () => {},
    }
  }
  return { channel }
}
async function device(h, name, state) {
  const box = { requests: [], incoming: [] }
  const api = createSyncLink({
    persona: name, state: () => state, save: () => {}, deviceName: () => name, snapshot: async () => {}, channel: h.channel(), storage: mem(),
    onPairRequest: (r) => box.requests.push(r), onIncoming: (i) => box.incoming.push(i), onLog: () => {}, onChange: () => {}, handshakeMs: 300,
  })
  await api.start()
  return { api, box, state }
}
const until = async (f) => { for (let i = 0; i < 150; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 20)) } throw new Error('timeout') }

describe('sync_link: a delete reaches the other device', () => {
  it('Sync now carries the tombstone; the other device moves the event to its Recently deleted', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', rec())
    const phone = await device(h, 'Phone', { ...rec(), events: [], inventory: [], tasks: [], meetings: [], invitations: [] })
    const mine = await phone.api.join(await mac.api.offerCode())
    await until(() => mac.box.requests.length === 1)
    mine.confirm(); mac.box.requests[0].confirm()
    await mac.api.syncNow(mac.api.pairings()[0].did)
    await until(() => phone.box.incoming.length === 1)
    await phone.box.incoming[0].accept(false)
    expect(phone.state.events.map((e) => e.id)).toEqual(['e1'])
    await until(() => mac.box.incoming.length === 1) // the phone's merged record comes back
    await mac.box.incoming[0].accept(false)
    await new Promise((r) => setTimeout(r, 5))
    trashItems(mac.state, 'event', ['e1'], Date.now())
    await mac.api.syncNow(mac.api.pairings()[0].did)
    await until(() => phone.box.incoming.length === 2)
    await phone.box.incoming[1].accept(false)
    expect(phone.state.events).toEqual([])
    expect(phone.state.trash.map((x) => `${x.kind}:${x.id}`)).toEqual(['event:e1'])
  })
})

// ---- MCP parity (D-P02): list and restore
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { trashLabel } from '../../src/trash_view.ts'

describe('MCP trash_list / trash_restore', () => {
  it('lists the trash newest first and restores one item; read-only servers cannot restore', () => {
    const s = rec()
    trashItems(s, 'event', ['e1'], Date.now() - DAY)
    trashItems(s, 'resource', ['r1'], Date.now())
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-a44c-trash-')), 'record.json')
    writeFileSync(file, JSON.stringify(s))
    const by = (write) => Object.fromEntries(allTools({ file, write, now: () => new Date() }).map((t) => [t.name, t]))
    expect(by(true).trash_list.run({}).items.map((x) => `${x.kind}:${x.id}:${x.daysLeft}`)).toEqual(['resource:r1:30', 'event:e1:29'])
    expect(by(false).trash_restore).toBeUndefined()
    expect(by(true).trash_restore.run({ kind: 'event', id: 'e1' })).toEqual({ restored: true })
    const r = JSON.parse(readFileSync(file, 'utf8'))
    expect(r.events.map((e) => e.id)).toEqual(['e1'])
    expect(r.trash.map((t) => t.id)).toEqual(['r1'])
    expect(() => by(true).trash_restore.run({ kind: 'event', id: 'nope' })).toThrow(/not in the trash/)
    expect(MCP_TOOLS.filter((t) => t.name.startsWith('trash_'))).toEqual([{ name: 'trash_list', write: false }, { name: 'trash_restore', write: true }])
  })
  it('names an entry by kind and title', () => {
    const s = rec()
    trashItems(s, 'resource', ['r1'], T0)
    expect(trashLabel(s.trash[0])).toBe('Resource: Ladder')
  })
})
