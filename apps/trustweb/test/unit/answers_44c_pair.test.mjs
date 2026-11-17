// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c answers-44c item 4 (Jakob 20:22 "both should work"): besides today's flow (the trusted device shows the QR, the new one joins),
 * the Signal-like flow: the NEW device shows its code, the trusted device scans it. Same sealed pairing; both directions on two stock devices.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSyncLink } from '../../src/sync_link.ts'
import { createActions } from '../../src/actions.ts'
import { defineSyncActions } from '../../src/sync_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { S } from '../../src/strings.ts'

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
const person = (id, name) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [] })
const mk = (people) => ({ v: 1, me: { name: 'J' }, people, peers: [], inventory: [], log: [], meetings: [] })
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

/** shower offers its code, scanner joins with it; both confirm; the trusted device's record then reaches the new one. */
async function pairAndSend(showerIsNew) {
  const h = hub()
  const trusted = await device(h, 'Laptop', mk([person('a', 'Ada Probe')]))
  const fresh = await device(h, 'Phone', mk([]))
  const [shower, scanner] = showerIsNew ? [fresh, trusted] : [trusted, fresh]
  const code = await shower.api.offerCode()
  const mine = await scanner.api.join(code)
  await until(() => shower.box.requests.length === 1)
  expect(shower.box.requests[0].fp).toBe(mine.fp)
  mine.confirm(); shower.box.requests[0].confirm()
  expect(trusted.api.pairings()).toHaveLength(1)
  expect(fresh.api.pairings()).toHaveLength(1)
  await trusted.api.syncNow(trusted.api.pairings()[0].did)
  await until(() => fresh.box.incoming.length === 1)
  await fresh.box.incoming[0].accept(false)
  expect(fresh.state.people.map((p) => p.id)).toEqual(['a'])
  expect(h.wires.map((w) => w.payload).join('')).not.toContain('Ada Probe')
}

describe('answers-44c pairing: both directions', () => {
  it("today's flow: the trusted device shows, the new device joins", async () => { await pairAndSend(false) })
  it('Signal-like flow: the new device shows its code, the trusted device scans it', async () => { await pairAndSend(true) })
})

describe('answers-44c pairing: actions and MCP parity', () => {
  it('sync-pair-show-new shows the new device code sheet; sync-pair-scan opens the scanner on the trusted device', async () => {
    const reg = createActions()
    const calls = []
    defineSyncActions(reg, { syncAll: async () => 0, showLink: () => calls.push('link'), showNewCode: () => calls.push('new'), scanNew: () => calls.push('scan') })
    for (const type of ['sync-pair-show-new', 'sync-pair-scan']) {
      const c = reg.check({ type, args: {} })
      expect(c.ok, type).toBe(true)
      await reg.run(c.action)
    }
    expect(calls).toEqual(['new', 'scan'])
    expect(ACTION_MCP['sync-pair-show-new']).toBe('sync_pair_show_new')
    expect(ACTION_MCP['sync-pair-scan']).toBe('sync_pair_scan')
  })
  it('the MCP tools queue those actions; read-only servers lack them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-a44c-pair-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, people: [] }))
    const by = (write) => Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-17T01:00:00Z') }).map((t) => [t.name, t]))
    const w = by(true)
    expect(w.sync_pair_show_new.run({})).toEqual({ queued: true })
    expect(w.sync_pair_scan.run({})).toEqual({ queued: true })
    const ev = readEvents(file, 0).events
    expect(ev.map((e) => e.action.type)).toEqual(['sync-pair-show-new', 'sync-pair-scan'])
    expect(by(false).sync_pair_scan).toBeUndefined()
    for (const n of ['sync_pair_show_new', 'sync_pair_scan']) expect(MCP_TOOLS.find((t) => t.name === n)).toEqual({ name: n, write: true })
  })
  it('the strings say which device does what', () => {
    expect(S.a44cPair.showNew).toMatch(/code/i)
    expect(S.a44cPair.newLead).toMatch(/Scan a new device/)
    expect(S.a44cPair.scanNew).toBe('Scan a new device')
  })
})
