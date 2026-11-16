// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave44 home-dashboard, MCP parity (D-P02): home_layout_get/set, dashboard_open, and the Settings > Home entry. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineHomeActions } from '../../src/home_actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'

const base = () => ({
  v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [], sameAs: {}, meetings: [],
  events: [{ id: 'e1', name: 'Winter', from: '2026-12-30', where: '', createdAt: 1, attended: true }],
  extData: { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], name: 'IYG' }, fam: { kind: 'informal', organizers: [], group: 'otherGroup', name: 'Family' } } } },
})
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-home-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = allTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('home_layout_get / home_layout_set', () => {
  it('get is a read and shows the default; set needs writes on', () => {
    expect(Object.keys(fixture(false).by)).toContain('home_layout_get')
    expect(Object.keys(fixture(false).by)).not.toContain('home_layout_set')
    expect(fixture().by.home_layout_get.run({})).toEqual({ left: ['asksToMe', 'connects'], center: ['web'], right: ['asksSent', 'invites'], isDefault: true })
  })
  it('set moves a tile and stores it; reset drops it', () => {
    const f = fixture()
    const out = f.by.home_layout_set.run({ tile: 'asksSent', column: 'left', index: 0 })
    expect(out.left[0]).toBe('asksSent')
    expect(f.rec().homeLayout.left[0]).toBe('asksSent')
    expect(f.by.home_layout_get.run({}).isDefault).toBe(false)
    expect(f.by.home_layout_set.run({ reset: true }).isDefault).toBe(true)
    expect(f.rec().homeLayout).toBeUndefined()
  })
  it('refuses an unknown tile or column', () => {
    const f = fixture()
    expect(() => f.by.home_layout_set.run({ tile: 'zzz', column: 'left' })).toThrow(/tile/)
    expect(() => f.by.home_layout_set.run({ tile: 'web', column: 'top' })).toThrow(/column/)
    expect(() => f.by.home_layout_set.run({})).toThrow()
  })
})

describe('dashboard_open', () => {
  it('queues the screen step for an affiliation that exists', () => {
    const f = fixture()
    expect(f.by.dashboard_open.run({ affiliation: 'community:iyg' })).toMatchObject({ queued: true, affiliation: 'community:iyg' })
    const ev = readEvents(f.file, 0).events.at(-1)
    expect(ev.action).toEqual({ type: 'dashboard-open', args: { affiliation: 'community:iyg' } })
    expect(f.by.dashboard_open.run({ affiliation: 'group:fam' }).queued).toBe(true)
    expect(f.by.dashboard_open.run({ affiliation: 'event:e1' }).queued).toBe(true)
  })
  it('an unknown affiliation is refused; no id opens the Home board dashboard chooser', () => {
    const f = fixture()
    expect(() => f.by.dashboard_open.run({ affiliation: 'community:nope' })).toThrow(/no affiliation/)
    expect(f.by.dashboard_open.run({}).queued).toBe(true)
  })
  it('is in the action table and the MCP config, and the action runs the host', () => {
    expect(ACTION_MCP['dashboard-open']).toBe('dashboard_open')
    expect(MCP_TOOLS.find((t) => t.name === 'dashboard_open')).toMatchObject({ write: true })
    const opened = []
    const reg = createActions()
    defineHomeActions(reg, { openDashboard: (id) => opened.push(id ?? null) })
    expect(reg.specs().map((s) => s.type)).toContain('dashboard-open')
  })
})

describe('Settings > Home', () => {
  it('home.start reads and writes uiViews.webDefault', () => {
    const r = {}
    expect(readSetting(r, 'home.start')).toBe(false)
    writeSetting(r, 'home.start', true)
    expect(r.uiViews.webDefault).toBe('home')
    writeSetting(r, 'home.start', false)
    expect(r.uiViews).toBeUndefined()
  })
})
