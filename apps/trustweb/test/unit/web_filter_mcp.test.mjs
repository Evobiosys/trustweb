// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 web-focus-filter MCP parity: web_filter_get / web_filter_set over the record's uiRings.show, event tags as event_<slug>. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { eventTagSlug } from '../../src/events.ts'

const file = path.join(mkdtempSync(path.join(tmpdir(), 'wf-mcp-')), 'rec.json')
const reset = (extra = {}) => writeFileSync(file, JSON.stringify({ v: 1, people: [], events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: '', createdAt: 0, attended: true }], ...extra }))
const tools = (write = true) => Object.fromEntries(recordTools({ file, write }).map((t) => [t.name, t]))
const saved = () => JSON.parse(readFileSync(file, 'utf8'))

describe('web filter tools', () => {
  it('web_filter_get is read-only; web_filter_set needs the write switch', () => {
    reset()
    expect(Object.keys(tools(false)).filter((n) => n.startsWith('web_filter'))).toEqual(['web_filter_get'])
    expect(Object.keys(tools()).filter((n) => n.startsWith('web_filter')).sort()).toEqual(['web_filter_get', 'web_filter_set'])
    expect(tools(false).web_filter_get.run({})).toEqual({ tags: [], hide: [], count: 0 })
  })
  it('set takes event_<slug>, tag:<id> and person:<id>; get gives them back the same way', () => {
    reset()
    const t = tools()
    expect(t.web_filter_set.run({ tags: ['event_Winter_IYG', 'tag:family', 'person:a'] })).toEqual({ tags: ['event_Winter_IYG', 'tag:family', 'person:a'], hide: [], count: 3 })
    expect(saved().uiRings.show).toEqual(['event:e1', 'tag:family', 'person:a'])
    expect(t.web_filter_get.run({}).tags).toEqual(['event_Winter_IYG', 'tag:family', 'person:a'])
  })
  it('the slug here is the app slug', () => expect(eventTagSlug('Winter IYG')).toBe('event_Winter_IYG'))
  it('an empty list clears the filter; unknown tags fail and change nothing', () => {
    reset({ uiRings: { show: ['event:e1'], hide: ['tag:x'], sidebarOpen: true } })
    const t = tools()
    expect(() => t.web_filter_set.run({ tags: ['event_nope'] })).toThrow(/unknown event tag/)
    expect(() => t.web_filter_set.run({ tags: ['whatever'] })).toThrow(/tag:<id>/)
    expect(() => t.web_filter_set.run({})).toThrow(/tags must be a list/)
    expect(saved().uiRings.show).toEqual(['event:e1'])
    expect(t.web_filter_set.run({ tags: [] })).toEqual({ tags: [], hide: [], count: 0 })
    expect(saved().uiRings).toEqual({ show: [], hide: [], sidebarOpen: true })
  })
})
