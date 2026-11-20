// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 google-contacts-sync, MCP parity: google_sync_status (read) and google_sync_set (Keep in sync on/off). The sync run itself needs the
 * Google token, which lives only in the browser tab (never in the record), so MCP reads the state and sets the switch. Synthetic data only.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { VIEW_TOOLS } from '../../../mcp/src/view_coverage.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const P = (id, key) => ({ id, name: id, context: '', ring: 'friend', metAt: 0, lines: [], ...(key ? { sources: [{ source: 'google-api', file: 'Google contacts', importedAt: 1, key }] } : {}) })
function fixture(write, googleSync) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-gsync-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [P('a', 'google-api:people/c1'), P('b')], ...(googleSync ? { googleSync } : {}) }))
  const by = Object.fromEntries(allTools({ file, write }).map((t) => [t.name, t]))
  return { by, rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}
const seen = { 'people/c1': { sourceRef: 'people/c1', name: 'x', emails: [], phones: [], labels: [] }, 'people/c2': { sourceRef: 'people/c2', name: 'y', emails: [], phones: [], labels: [] }, 'people/c3': { sourceRef: 'people/c3', name: '', emails: [], phones: [], labels: [], deleted: true } }

describe('google_sync_status', () => {
  it('never synced: off, nothing linked', () => {
    expect(fixture(false).by.google_sync_status.run({})).toEqual({ available: false, keepInSync: false, linked: 1, known: 0, lastRun: null })
  })
  it('reports the switch, the owner\'s choice, linked people and the last run, never contact data or the sync token', () => {
    const last = { at: 5, updated: 1, kept: 2, fresh: 1, gone: 0 }
    const out = fixture(false, { on: true, syncToken: 'SECRETISH', seen, base: {}, last }).by.google_sync_status.run({})
    expect(out).toEqual({ available: false, keepInSync: true, linked: 1, known: 2, lastRun: last })
    expect(JSON.stringify(out)).not.toContain('SECRETISH')
  })
})

describe('google_sync_set', () => {
  it('only with write access', () => {
    expect(fixture(false).by.google_sync_set).toBeUndefined()
    expect(MCP_TOOLS).toContainEqual({ name: 'google_sync_set', write: true })
    expect(MCP_TOOLS).toContainEqual({ name: 'google_sync_status', write: false })
  })
  it('switches Keep in sync and keeps the rest of the state', () => {
    const f = fixture(true, { syncToken: 'S1', seen, base: {} })
    expect(f.by.google_sync_set.run({ on: true })).toEqual({ keepInSync: true })
    expect(f.rec().googleSync).toMatchObject({ on: true, syncToken: 'S1' })
    f.by.google_sync_set.run({ on: false })
    expect(f.rec().googleSync.on).toBe(false)
    expect(() => f.by.google_sync_set.run({ on: 'yes' })).toThrow(/on/)
  })
  it('creates the state when it was never synced', () => {
    const f = fixture(true)
    f.by.google_sync_set.run({ on: true })
    expect(f.rec().googleSync).toEqual({ on: true, seen: {}, base: {} })
  })
})

it('the Google sync view is reachable over MCP', () => {
  expect(VIEW_TOOLS['google_sync_view.ts']).toEqual(['google_sync_status', 'google_sync_set'])
})
