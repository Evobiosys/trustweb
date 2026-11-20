// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b ask-page-filter MCP parity: ask_audience_get / ask_audience_set over the record's askAudience and askReach. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const file = path.join(mkdtempSync(path.join(tmpdir(), 'aa-mcp-')), 'rec.json')
const reset = (extra = {}) => writeFileSync(file, JSON.stringify({ v: 1, people: [{ id: 'a', name: 'Anna' }], ...extra }))
const tools = (write = true) => Object.fromEntries(recordTools({ file, write }).map((t) => [t.name, t]))
const saved = () => JSON.parse(readFileSync(file, 'utf8'))

describe('ask audience tools', () => {
  it('get is read-only, set needs the write switch', () => {
    reset()
    expect(Object.keys(tools(false)).filter((n) => n.startsWith('ask_audience'))).toEqual(['ask_audience_get'])
    expect(Object.keys(tools()).filter((n) => n.startsWith('ask_audience')).sort()).toEqual(['ask_audience_get', 'ask_audience_set'])
    expect(tools(false).ask_audience_get.run({})).toEqual({ add: [], exclude: [], degree: 1 })
  })
  it('set stores zone, add and exclude; the degree is the ask reach', () => {
    reset()
    const out = tools().ask_audience_set.run({ zone: 'close', add: ['person:a', 'tag:family'], exclude: ['tag:x'], degree: 3 })
    expect(out).toEqual({ zone: 'close', add: ['person:a', 'tag:family'], exclude: ['tag:x'], degree: 3 })
    expect(saved().askAudience).toEqual({ zone: 'close', add: ['person:a', 'tag:family'], exclude: ['tag:x'] })
    expect(saved().askReach).toBe(3)
    expect(tools().ask_audience_get.run({})).toEqual(out)
  })
  it('degree 1 clears the reach back to the default; a bad call changes nothing', () => {
    reset({ askReach: 3, askAudience: { zone: 'friend', add: [], exclude: [] } })
    const t = tools()
    expect(() => t.ask_audience_set.run({ degree: 'public' })).toThrow(/public/)
    expect(() => t.ask_audience_set.run({ zone: 'wide' })).toThrow(/zone/)
    expect(saved().askReach).toBe(3)
    t.ask_audience_set.run({ zone: 'friend', degree: 1 })
    expect('askReach' in saved()).toBe(false)
  })
})

/* wave45 ask-event-limit */
describe('ask audience tools: event chips', () => {
  it('set stores event:<id> chips and get returns them', () => {
    reset()
    const out = tools().ask_audience_set.run({ zone: 'closest', add: ['event:ev1'] })
    expect(out).toEqual({ zone: 'closest', add: ['event:ev1'], exclude: [], degree: 1 })
    expect(saved().askAudience.add).toEqual(['event:ev1'])
  })
})
