// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c sync-devices (POLICY P02, MCP parity): sync_status reads the record's copy, sync_now queues the app's action, Auto sync is a setting; the app action exists. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineSyncActions } from '../../src/sync_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'

function fixture(rec, write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-sync-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], ...rec }))
  return { file, by: Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-16T01:00:00Z') }).map((t) => [t.name, t])) }
}

describe('sync over MCP', () => {
  it('sync_status: devices, last sync and Auto sync from the record (no status yet: none)', () => {
    expect(fixture({}).by.sync_status.run({})).toEqual({ error: null, devices: 0, lastAt: null, auto: true, unacked: 0, held: 0 })
    const at = Date.parse('2026-11-16T00:30:00Z')
    expect(fixture({ syncStatus: { devices: 2, lastAt: at }, syncAutoOff: true }).by.sync_status.run({})).toEqual({ error: null, devices: 2, lastAt: '2026-11-16T00:30:00.000Z', auto: false, unacked: 0, held: 0 })
  })

  it('sync_now queues the app action for the open preview and changes no record; read-only servers lack it', () => {
    const f = fixture({ syncStatus: { devices: 1, lastAt: 0 } })
    expect(f.by.sync_now.run({})).toEqual({ queued: true, devices: 1 })
    const ev = readEvents(f.file, 0).events
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'action', tool: 'sync_now', action: { type: 'sync-now', args: {} } })
    expect(fixture({}, false).by.sync_now).toBeUndefined()
    expect(ACTION_MCP['sync-now']).toBe('sync_now')
  })

  it('Auto sync is the setting general.syncAuto (on by default, only "off" stored)', () => {
    const r = {}
    expect(readSetting(r, 'general.syncAuto')).toBe(true)
    writeSetting(r, 'general.syncAuto', false)
    expect(r.syncAutoOff).toBe(true)
    writeSetting(r, 'general.syncAuto', true)
    expect('syncAutoOff' in r).toBe(false)
  })

  it('the app action sync-now runs Sync now with every linked device', async () => {
    const reg = createActions()
    let runs = 0
    defineSyncActions(reg, { syncAll: async () => { runs++; return 1 } })
    const c = reg.check({ type: 'sync-now', args: {} })
    expect(c.ok).toBe(true)
    await reg.run(c.action)
    expect(runs).toBe(1)
  })
})
