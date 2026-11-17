// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * review-44c (Opus adversarial review of wave 44c): the confirmed findings, each red before its fix.
 *   R1 sync-seamless A5: a pairing link sends nothing before Confirm (no device name or asking DID to whoever made the link).
 *   R2 answers-44c A4: tombstones are untrusted input (validated per kind) and carry no device-local fields (event fromLink/srv, resource picture id).
 *   R3 event-autosave: drafts live inside the record (one localStorage key): their sum stays under DRAFT_STORE_MAX_BYTES, so a draft never stops the record saving.
 *   R4 seen-through: the host's "Introduce to the people here" is reachable through the MCP (D-P02).
 *   R5 sync-seamless/header-cluster: one update button logic (the held banner runs Update now, not a bare reload); a new phone opening a pair link joins.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSyncLink } from '../../src/sync_link.ts'
import { bundleOf, parseBundle, refreshStamps } from '../../src/sync_core.ts'
import { trashItems } from '../../src/trash.ts'
import { DRAFT_STORE_MAX_BYTES, putDraft } from '../../src/drafts.ts'
import { createActions } from '../../src/actions.ts'
import { defineSeenActions } from '../../src/seen_through_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
globalThis.location ??= { origin: 'http://127.0.0.1:1' }

function hub() {
  const sinks = new Map()
  const wires = []
  const channel = () => {
    let did = ''
    let cb = null
    return {
      connect: async (id) => { did = id.did; sinks.set(did, cb) },
      onRawWire: (f) => { cb = f },
      sendRaw: async (to, payload) => { wires.push({ to, from: did, payload }); await new Promise((r) => setTimeout(r, 0)); sinks.get(to)?.(did, payload) },
      close: () => {}, onEnvelope: () => {}, onStatus: () => {}, send: async () => {},
    }
  }
  return { channel, wires }
}
const mk = () => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [] })
async function device(h, name) {
  const box = { requests: [] }
  const api = createSyncLink({
    persona: name, state: () => mk(), save: () => {}, deviceName: () => name, snapshot: async () => {}, channel: h.channel(), storage: mem(),
    onPairRequest: (r) => box.requests.push(r), onIncoming: () => {}, onLog: () => {}, onChange: () => {}, handshakeMs: 300,
  })
  await api.start()
  return { api, box }
}
const until = async (f) => { for (let i = 0; i < 150; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 20)) } throw new Error('timeout') }

describe('R1 pairing link: nothing leaves before Confirm', () => {
  it('join(code, {defer}) sends no wire until the person confirms; then the offering device gets the request', async () => {
    const h = hub()
    const shower = await device(h, 'Laptop')
    const opener = await device(h, 'Phone')
    const code = await shower.api.offerCode()
    const r = await opener.api.join(code, { defer: true })
    await new Promise((res) => setTimeout(res, 50))
    expect(h.wires).toHaveLength(0)
    expect(shower.box.requests).toHaveLength(0)
    r.confirm()
    await until(() => shower.box.requests.length === 1)
    expect(shower.box.requests[0].fp).toBe(r.fp)
    expect(opener.api.pairings()).toHaveLength(1)
  })
  it('a cancelled link sends nothing at all', async () => {
    const h = hub()
    const shower = await device(h, 'Laptop')
    const opener = await device(h, 'Phone')
    const r = await opener.api.join(await shower.api.offerCode(), { defer: true })
    r.cancel()
    await new Promise((res) => setTimeout(res, 50))
    expect(h.wires).toHaveLength(0)
  })
})

const rec = () => ({
  v: 1, me: { displayName: 'J' }, people: [], peers: [], log: [], meetings: [], tasks: [], invitations: [],
  events: [{ id: 'e1', name: 'Picnic', from: '2026-12-01', where: 'Park', createdAt: 1, attended: false, fromLink: true, srv: 'abc' }],
  inventory: [{ id: 'r1', text: 'Ladder', tags: [], audience: 'trusted', imageId: 'img-1' }],
})
const wire = (b) => JSON.parse(JSON.stringify(b))

describe('R2 tombstones: validated per kind, no device-local fields', () => {
  it('a trashed event travels without fromLink/srv, a trashed resource without its picture id', () => {
    const s = rec()
    trashItems(s, 'event', ['e1'], 1000)
    trashItems(s, 'resource', ['r1'], 1000)
    const b = bundleOf(s, refreshStamps(s, {}, 1000, 'd:me'))
    const ev = b.trash.find((t) => t.kind === 'event').item
    const res = b.trash.find((t) => t.kind === 'resource').item
    expect(ev.fromLink).toBeUndefined()
    expect(ev.srv).toBeUndefined()
    expect(res.imageId).toBeUndefined()
    // the local tombstone keeps everything (Restore here brings the picture back)
    expect(s.trash.find((t) => t.kind === 'resource').item.imageId).toBe('img-1')
  })
  it('a bundle whose tombstone item is not a valid event / task / invitation is nothing (like a bad live list)', () => {
    const s = rec()
    trashItems(s, 'event', ['e1'], 1000)
    const b = wire(bundleOf(s, refreshStamps(s, {}, 1000, 'd:me')))
    expect(parseBundle(b)).not.toBeNull()
    const bad = (kind, item) => ({ ...b, trash: [{ kind, id: item.id, item, deleted_at: new Date(1000).toISOString() }] })
    expect(parseBundle(bad('event', { id: 'x1' }))).toBeNull()
    expect(parseBundle(bad('task', { id: 'x2', title: 3 }))).toBeNull()
    expect(parseBundle(bad('invitation', { id: 'x3' }))).toBeNull()
    expect(parseBundle(bad('resource', { id: 'x4', text: 'ok' }))).not.toBeNull()
  })
  it('an arriving tombstone loses device-local fields at the boundary', () => {
    const s = rec()
    trashItems(s, 'event', ['e1'], 1000)
    const b = wire(bundleOf(s, refreshStamps(s, {}, 1000, 'd:me')))
    b.trash[0].item.srv = 'zzz'
    expect(parseBundle(b).trash[0].item.srv).toBeUndefined()
  })
})

describe('R3 drafts: the record keeps saving', () => {
  it('a draft that would push all drafts over DRAFT_STORE_MAX_BYTES is not kept; the earlier draft stays', () => {
    expect(DRAFT_STORE_MAX_BYTES).toBeLessThan(5 * 1024 * 1024)
    const s = {}
    const half = 'x'.repeat(Math.floor(DRAFT_STORE_MAX_BYTES / 2))
    expect(putDraft(s, 'chat', 'a', half, 1)).toBe('saved')
    expect(putDraft(s, 'chat', 'b', half + half, 2)).toBe('too-big')
    expect(Object.keys(s.drafts)).toEqual(['chat:a'])
    // replacing the same draft counts only the new size
    expect(putDraft(s, 'chat', 'a', half.slice(10), 3)).toBe('saved')
  })
})

describe('R4 seen-through: Introduce to the people here through the MCP', () => {
  it('the seen-introduce action, its MCP tool and the queued action', async () => {
    const reg = createActions()
    const calls = []
    defineSeenActions(reg, { introduce: (event, person) => { calls.push([event, person]) } })
    const c = reg.check({ type: 'seen-introduce', args: { event: 'e1', person: 'p1' } })
    expect(c.ok).toBe(true)
    await reg.run(c.action)
    expect(calls).toEqual([['e1', 'p1']])
    expect(ACTION_MCP['seen-introduce']).toBe('event_introduce_person')
    expect(MCP_TOOLS.find((t) => t.name === 'event_introduce_person')?.write).toBe(true)
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'review-44c-')), 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { displayName: 'J' }, people: [{ id: 'p1', name: 'Omar Probe', context: '', ring: 'friend', metAt: 1, lines: [] }], events: [{ id: 'e1', name: 'Picnic', from: '2026-12-01', where: 'Park', createdAt: 1, attended: true }], inventory: [], meetings: [], log: [] }))
    const tool = allTools({ file, write: true }).find((t) => t.name === 'event_introduce_person')
    expect(await tool.run({ event: 'e1', person: 'p1' })).toEqual({ queued: true })
    expect(readEvents(file, 0).events.at(-1).action).toEqual({ type: 'seen-introduce', args: { event: 'e1', person: 'p1' } })
    await expect(async () => tool.run({ event: 'nope', person: 'p1' })).rejects.toThrow()
    expect(allTools({ file, write: false }).some((t) => t.name === 'event_introduce_person')).toBe(false)
  })
})

describe('R5 one update logic; a new phone joins from a pair link', () => {
  const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  it('the held-items banner runs Update now (service worker, release check), not a bare reload', () => {
    expect(src).not.toContain('reload: () => void reloadNow(), // wave44c sync-seamless')
    expect(src).toMatch(/reload: \(\) => void runUpdateNow\(S\.review44c\.heldLatest\)/)
  })
  it('a phone without a record yet still reads the pair link at boot', () => {
    expect(src).toMatch(/else if \(!state && deviceSyncEligible\(\)\) \{ devices\.start\(\); openPairLink\(bootHash, devices\) \}/)
  })
})
