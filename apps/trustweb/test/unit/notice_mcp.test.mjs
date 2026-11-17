// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c chat-notices MCP parity (P02): notices_list (debug), web_default_view_get / web_default_view_set over uiViews.webDefault. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const file = path.join(mkdtempSync(path.join(tmpdir(), 'nt-mcp-')), 'rec.json')
const reset = (extra = {}) => writeFileSync(file, JSON.stringify({ v: 1, people: [], ...extra }))
const tools = (write = true) => Object.fromEntries(recordTools({ file, write }).map((t) => [t.name, t]))
const saved = () => JSON.parse(readFileSync(file, 'utf8'))

describe('notice and default-view tools', () => {
  it('read-only mode has notices_list and web_default_view_get; the setter needs writes', () => {
    reset()
    const names = (w) => Object.keys(tools(w)).filter((n) => n === 'notices_list' || n.startsWith('web_default_view')).sort()
    expect(names(false)).toEqual(['notices_list', 'web_default_view_get'])
    expect(names(true)).toEqual(['notices_list', 'web_default_view_get', 'web_default_view_set'])
  })
  it('notices_list names the layer: cap, kinds top to bottom, and the notices that wait in the record', () => {
    reset({ wantsToConnect: [{ peerId: 'x', name: 'Ana', at: 1 }] })
    expect(tools(false).notices_list.run({})).toEqual({ cap: 3, kinds: ['cards', 'wants', 'update', 'notice', 'message', 'toast'], waiting: { wants: 1 } })
  })
  it('the default view is home until pinned (wave44c); set stores it, rings is stored too, unknown views fail', () => {
    reset()
    const t = tools()
    expect(t.web_default_view_get.run({})).toEqual({ view: 'home' })
    expect(t.web_default_view_set.run({ view: 'network' })).toEqual({ view: 'network' })
    expect(saved().uiViews).toEqual({ webDefault: 'network' })
    expect(t.web_default_view_set.run({ view: 'rings' })).toEqual({ view: 'rings' })
    expect(saved().uiViews).toEqual({ webDefault: 'rings' })
    expect(() => t.web_default_view_set.run({ view: 'zzz' })).toThrow(/view must be one of/)
  })
})
