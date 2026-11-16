// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-escalation MCP parity: ask_escalation_get / ask_escalation_set and resource_set_physical over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const file = path.join(mkdtempSync(path.join(tmpdir(), 'esc-mcp-')), 'rec.json')
const reset = (extra = {}) => writeFileSync(file, JSON.stringify({ v: 1, people: [], inventory: [{ id: 'r1', text: 'Ladder' }], ...extra }))
const tools = (write = true) => Object.fromEntries(recordTools({ file, write }).map((t) => [t.name, t]))
const saved = () => JSON.parse(readFileSync(file, 'utf8'))

describe('ask escalation tools', () => {
  it('get is read-only; set needs the write switch', () => {
    reset()
    expect(Object.keys(tools(false)).filter((n) => n.startsWith('ask_escalation'))).toEqual(['ask_escalation_get'])
    expect(Object.keys(tools()).filter((n) => n.startsWith('ask_escalation')).sort()).toEqual(['ask_escalation_get', 'ask_escalation_set'])
    expect(tools(false).ask_escalation_get.run({})).toEqual({ showAsked: true, queued: null, askedWho: [] })
  })
  it('show_asked false is stored, true removes it; who was asked comes from the held asks', () => {
    reset({ heldAsks: [{ qid: 'q1', fromName: 'Ann', askedNames: ['Ben', 'Cleo'] }, { qid: 'q2', fromName: 'Dan' }] })
    expect(tools().ask_escalation_set.run({ show_asked: false }).showAsked).toBe(false)
    expect(saved().askShowAsked).toBe(false)
    expect(tools().ask_escalation_set.run({ show_asked: true }).showAsked).toBe(true)
    expect(saved().askShowAsked).toBeUndefined()
    expect(tools().ask_escalation_get.run({}).askedWho).toEqual([{ qid: 'q1', from: 'Ann', asked: ['Ben', 'Cleo'] }])
  })
  it('escalate queues the second round (the app sends it on Send); discard clears; bad input changes nothing', () => {
    reset()
    expect(tools().ask_escalation_set.run({ escalate: { text: ' Who has a drill? ', zone: 'close' } }).queued).toEqual({ text: 'Who has a drill?', zone: 'close' })
    expect(saved().askEscalate).toEqual({ text: 'Who has a drill?', zone: 'close' })
    expect(() => tools().ask_escalation_set.run({ escalate: { text: 'x', zone: 'public' } })).toThrow()
    expect(() => tools().ask_escalation_set.run({ escalate: { text: '  ', zone: 'close' } })).toThrow()
    expect(saved().askEscalate.text).toBe('Who has a drill?')
    expect(tools().ask_escalation_set.run({ discard: true }).queued).toBeNull()
    expect(saved().askEscalate).toBeUndefined()
  })
})

describe('resource_set_physical', () => {
  it('needs a place: without one nothing changes; confirm_no_place continues; physical false clears', () => {
    reset()
    const t = tools().resource_set_physical
    expect(t.run({ id: 'r1', physical: true }).needsPlace).toBe(true)
    expect(saved().inventory[0].physical).toBeUndefined()
    expect(t.run({ id: 'r1', physical: true, place: ' Garage, Linz ' })).toMatchObject({ physical: true, place: 'Garage, Linz' })
    expect(saved().inventory[0]).toMatchObject({ physical: true, place: 'Garage, Linz' })
    expect(t.run({ id: 'r1', physical: false }).physical).toBe(false)
    expect(saved().inventory[0].place).toBeUndefined()
    expect(t.run({ id: 'r1', physical: true, confirm_no_place: true }).needsPlace).toBeUndefined()
    expect(saved().inventory[0].physical).toBe(true)
  })
})
