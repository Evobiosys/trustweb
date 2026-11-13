// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 bottom-bar MCP parity: bar_list / bar_set / bar_hide / bar_show over the record's uiBar, the same functions as the Settings list. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const file = path.join(mkdtempSync(path.join(tmpdir(), 'bar-mcp-')), 'rec.json')
const reset = (extra = {}) => writeFileSync(file, JSON.stringify({ v: 1, people: [], ...extra }))
const tools = (write = true) => Object.fromEntries(recordTools({ file, write }).map((t) => [t.name, t]))
const saved = () => JSON.parse(readFileSync(file, 'utf8'))

describe('bar tools', () => {
  it('bar_list works read-only; the writes need the write switch', () => {
    reset()
    expect(Object.keys(tools(false)).filter((n) => n.startsWith('bar_'))).toEqual(['bar_list'])
    expect(tools(false).bar_list.run({})).toEqual({ shown: ['web', 'chat', 'feed', 'events', 'inventory'], primary: 'feed', hidden: [] }) // wave 42 D2
  })
  it('bar_hide takes Record out, bar_show brings it back (the same store the Settings list uses)', () => {
    reset({ uiBar: { order: ['web', 'chat', 'record', 'events', 'inventory'] } })
    const t = tools()
    expect(t.bar_hide.run({ id: 'record' }).shown).toEqual(['web', 'chat', 'events', 'inventory'])
    expect(saved().uiBar.hidden).toContain('record')
    expect(t.bar_show.run({ id: 'record' }).shown).toContain('record')
    expect(saved().uiBar.hidden).not.toContain('record')
  })
  it('hiding what is hidden changes nothing; the last view stays; unknown ids fail', () => {
    reset({ uiBar: { order: ['web', 'record'] } })
    const t = tools()
    t.bar_hide.run({ id: 'web' })
    expect(() => t.bar_hide.run({ id: 'record' })).toThrow(/at least one/)
    expect(t.bar_hide.run({ id: 'web' }).shown).toEqual(['record'])
    expect(() => t.bar_hide.run({ id: 'zzz' })).toThrow(/unknown view/)
    expect(() => t.bar_hide.run({})).toThrow(/id is required/)
  })
  it('bar_set shows the listed views in that order and takes the rest out', () => {
    reset()
    const t = tools()
    expect(t.bar_set.run({ order: ['chat', 'web', 'zzz', 'chat'] })).toMatchObject({ shown: ['chat', 'web'] })
    expect(saved().uiBar.hidden).toContain('record')
    expect(() => t.bar_set.run({ order: ['zzz'] })).toThrow(/at least one known view/)
  })
  it('the record keeps its other fields', () => {
    reset({ people: [{ id: 'p1', name: 'X', ring: 'none' }] })
    tools().bar_hide.run({ id: 'chat' })
    expect(saved().people).toHaveLength(1)
  })
})
