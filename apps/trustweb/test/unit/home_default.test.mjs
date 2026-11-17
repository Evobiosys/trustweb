// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave44c home-default: Home is the first screen for everyone (absent webDefault = home, rings only when chosen), the Existing requests tile, the rings thumbnail data. Synthetic data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setWebDefault, webDefaultOf, webTabLabel } from '../../src/web_default_view.ts'
import { defaultLayout, parseLayout } from '../../src/home_layout.ts'
import { findRequest, requestGroups, tileData } from '../../src/home_data.ts'
import { ringsThumb } from '../../src/home_thumb.ts'
import { migrate, SCHEMA_VERSION } from '../../src/schema_version.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineHomeActions } from '../../src/home_actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'

const s = {
  awayAsks: [{ id: 'q1', at: 5, peerId: 'x', from: 'Ana', text: 'a ladder?' }],
  heldAsks: [{ qid: 'q2', peerId: 'y', text: 'a lift?', fromName: 'Ben', through: [] }],
  wantsToConnect: [{ peerId: 'z', name: 'Cy', at: 9 }],
  sentAsks: [{ id: 's1', text: 'a drill?', at: 3, to: [] }],
  invitesSent: 2,
}

describe('Home first for everyone', () => {
  it('a record without a pin opens the rings (answers-44c: personal Web = web); Home when chosen', () => {
    expect(webDefaultOf({})).toBe('rings')
    expect(webDefaultOf({ uiViews: {} })).toBe('rings')
    expect(webDefaultOf({ uiViews: { webDefault: 'home' } })).toBe('home')
    expect(webDefaultOf({ uiViews: { webDefault: 'rings' } })).toBe('rings')
    expect(webDefaultOf({ uiViews: { webDefault: 'network' } })).toBe('network')
  })
  it('choosing the rings is stored, not dropped', () => {
    expect(setWebDefault(undefined, 'rings')).toEqual({ webDefault: 'rings' })
    expect(setWebDefault({ webDefault: 'network' }, 'home')).toEqual({ webDefault: 'home' })
  })
  it('the Web tab keeps "Web" with Home as default', () => {
    expect(webTabLabel({}, { rings: 'Web', home: 'Home' })).toBe('Web')
    expect(webTabLabel({ uiViews: { webDefault: 'home' } }, { rings: 'Web', home: 'Home' })).toBe('Web')
  })
  it('a migrated v3 record without a pin opens the rings (answers-44c); one that pinned another view keeps it', () => {
    const a = { schemaVersion: 3, people: [] }
    migrate(a)
    expect(a.schemaVersion).toBe(SCHEMA_VERSION)
    expect(webDefaultOf(a)).toBe('rings')
    const b = { schemaVersion: 3, people: [], uiViews: { webDefault: 'network' } }
    migrate(b)
    expect(webDefaultOf(b)).toBe('network')
  })
  it('Settings > Home: off by default (answers-44c), on = home first, off again = rings', () => {
    const r = {}
    expect(readSetting(r, 'home.start')).toBe(false)
    writeSetting(r, 'home.start', true)
    expect(r.uiViews.webDefault).toBe('home')
    expect(readSetting(r, 'home.start')).toBe(true)
    writeSetting(r, 'home.start', false)
    expect(readSetting(r, 'home.start')).toBe(false)
    expect(r.uiViews).toBeUndefined()
    const p = { uiViews: { webDefault: 'network' } }
    writeSetting(p, 'home.start', true)
    expect(p.uiViews.webDefault).toBe('home')
  })
})

describe('Existing requests tile', () => {
  it('sits at the bottom of the left column; a stored layout without it gets it there', () => {
    expect(defaultLayout().left).toEqual(['asksToMe', 'connects', 'requests'])
    expect(parseLayout({ left: ['connects'], center: ['web'], right: ['asksSent', 'invites', 'asksToMe'] }).left).toEqual(['connects', 'requests'])
  })
  it('lists every open request grouped: to me, connects, mine, invitations', () => {
    const g = requestGroups(s)
    expect(g.toMe.map((r) => r.id)).toEqual(['q1', 'q2'])
    expect(g.connects.map((r) => r.id)).toEqual(['z'])
    expect(g.sent.map((r) => r.id)).toEqual(['s1'])
    expect(g.invites).toBe(2)
    expect(tileData(s, 'requests').count).toBe(6)
    expect(JSON.stringify(g)).not.toMatch(/through|"to"/)
  })
  it('finds a request by id and says what kind it is', () => {
    expect(findRequest(s, 'q1')).toMatchObject({ kind: 'away', id: 'q1' })
    expect(findRequest(s, 'q2')).toMatchObject({ kind: 'held', id: 'q2' })
    expect(findRequest(s, 'z')).toMatchObject({ kind: 'connect', id: 'z' })
    expect(findRequest(s, 's1')).toMatchObject({ kind: 'sent', id: 's1' })
    expect(findRequest(s, 'nope')).toBeNull()
  })
})

describe('rings thumbnail', () => {
  it('counts the people per ring, unsorted last, without names', () => {
    const t = ringsThumb([{ ring: 'closest' }, { ring: 'friend' }, { ring: 'friend' }, { ring: 'none' }, { name: 'Ana Muster' }])
    expect(t.map((r) => r.ring)).toEqual(['closest', 'close', 'friend', 'acquaintance', 'intending', 'unsorted'])
    expect(t.find((r) => r.ring === 'friend').count).toBe(2)
    expect(t.find((r) => r.ring === 'unsorted').count).toBe(2)
    expect(JSON.stringify(t)).not.toMatch(/Ana/)
  })
})

describe('MCP parity: requests_list, home_open_request', () => {
  const fixture = () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-hd-')), 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'T' }, people: [], ...s }))
    const by = Object.fromEntries(allTools({ file, write: true, now: () => new Date('2026-11-17T10:00:00Z') }).map((t) => [t.name, t]))
    return { file, by }
  }
  it('requests_list returns the groups', () => {
    const out = fixture().by.requests_list.run({})
    expect(out.toMe).toHaveLength(2)
    expect(out.invites).toBe(2)
  })
  it('home_open_request queues the action for a known id and refuses an unknown one', () => {
    const f = fixture()
    expect(f.by.home_open_request.run({ id: 'q2' })).toMatchObject({ queued: true, kind: 'held' })
    const ev = readEvents(f.file, 0).events.at(-1)
    expect(ev.action).toEqual({ type: 'home-open-request', args: { id: 'q2' } })
    expect(() => f.by.home_open_request.run({ id: 'nope' })).toThrow(/no open request/)
  })
  it('is in the action table and the MCP config', () => {
    expect(ACTION_MCP['home-open-request']).toBe('home_open_request')
    expect(MCP_TOOLS.find((t) => t.name === 'requests_list')).toMatchObject({ write: false })
    expect(MCP_TOOLS.find((t) => t.name === 'home_open_request')).toMatchObject({ write: true })
    const reg = createActions()
    const opened = []
    defineHomeActions(reg, { openDashboard: () => {}, openRequest: (id) => opened.push(id) })
    expect(reg.specs().map((x) => x.type)).toContain('home-open-request')
  })
  it('web_default_view_get says rings for a fresh record (answers-44c); home is stored', () => {
    const f = fixture()
    expect(f.by.web_default_view_get.run({})).toEqual({ view: 'rings' })
    f.by.web_default_view_set.run({ view: 'home' })
    expect(JSON.parse(readFileSync(f.file, 'utf8')).uiViews).toEqual({ webDefault: 'home' })
    expect(f.by.web_default_view_get.run({})).toEqual({ view: 'home' })
  })
})
