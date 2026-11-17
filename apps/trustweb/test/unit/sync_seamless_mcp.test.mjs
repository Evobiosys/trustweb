// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c sync-seamless (D-P02, MCP parity): sync_status shows unacknowledged sends and held items; sync_pair_link opens Link a device; the actions exist. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineSyncActions } from '../../src/sync_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

function fixture(rec, write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-sync-seamless-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], ...rec }))
  return { file, by: Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-17T01:00:00Z') }).map((t) => [t.name, t])) }
}

describe('sync-seamless over MCP', () => {
  it('sync_status adds the sends not yet acknowledged and the items held for an update (0 when the app wrote none)', () => {
    expect(fixture({ syncStatus: { devices: 2, lastAt: 0 } }).by.sync_status.run({})).toEqual({ devices: 2, lastAt: null, auto: true, unacked: 0, held: 0 })
    expect(fixture({ syncStatus: { devices: 2, lastAt: 0, unacked: 1, held: 3 } }).by.sync_status.run({})).toMatchObject({ unacked: 1, held: 3 })
  })

  it('sync_pair_link queues the app action for the open preview; read-only servers lack it', () => {
    const f = fixture({})
    expect(f.by.sync_pair_link.run({})).toEqual({ queued: true })
    const ev = readEvents(f.file, 0).events
    expect(ev[0]).toMatchObject({ kind: 'action', tool: 'sync_pair_link', action: { type: 'sync-pair-link', args: {} } })
    expect(fixture({}, false).by.sync_pair_link).toBeUndefined()
    expect(ACTION_MCP['sync-pair-link']).toBe('sync_pair_link')
    expect(MCP_TOOLS.find((t) => t.name === 'sync_pair_link')).toEqual({ name: 'sync_pair_link', write: true })
  })

  it('the app action sync-pair-link shows the link sheet', async () => {
    const reg = createActions()
    let shown = 0
    defineSyncActions(reg, { syncAll: async () => 0, showLink: () => { shown++ } })
    const c = reg.check({ type: 'sync-pair-link', args: {} })
    expect(c.ok).toBe(true)
    await reg.run(c.action)
    expect(shown).toBe(1)
  })
})
