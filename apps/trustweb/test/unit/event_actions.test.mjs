// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 community-event: the assembler's change cards. */
import { createActions } from '../../src/actions.ts'
import { defineEventActions } from '../../src/event_actions.ts'
import { templatePrompt } from '../../src/event_plan.ts'

function setup() {
  const state = { events: [] }
  let n = 0
  let saves = 0
  const reg = createActions()
  defineEventActions(reg, { state: () => state, save: () => { saves++ }, newId: () => `id${++n}`, community: () => 'iyg' })
  return { state, reg, saves: () => saves }
}

describe('event assembler cards', () => {
  it('every card needs its own approval (never auto) and can be undone', () => {
    const { reg } = setup()
    for (const t of ['event-create', 'event-doc', 'event-role', 'event-resource']) expect(reg.specs().find((s) => s.type === t)?.auto).toBe(false)
  })
  it('create, doc, role, resource build the sheet; undo takes each back', () => {
    const { reg, state } = setup()
    const c = reg.check({ type: 'event-create', args: { name: 'Summer fest', from: '2027-06-01', where: 'Garden' }, why: 'the date and place' })
    expect(c.ok).toBe(true)
    const made = reg.run(c.action, 'assistant')
    expect(state.events[0]).toMatchObject({ id: 'id1', community: 'iyg', name: 'Summer fest', signup: [] })
    reg.do('event-doc', { event: 'summer fest', kind: 'description', text: 'A party' }, 'assistant')
    reg.do('event-role', { event: 'id1', name: 'Sound' }, 'assistant')
    const res = reg.do('event-resource', { event: 'id1', text: 'Loudspeaker' }, 'assistant')
    expect(state.events[0]).toMatchObject({ docs: { description: 'A party' }, roles: [{ name: 'Sound' }], resources: [{ id: 'id2', text: 'Loudspeaker' }] })
    res.undo()
    expect(state.events[0].resources).toEqual([])
    made.undo()
    expect(state.events).toEqual([])
  })
  it('bad cards are rejected, not run', () => {
    const { reg } = setup()
    expect(reg.check({ type: 'event-create', args: { name: 'x' } }).ok).toBe(false)
    expect(reg.check({ type: 'event-doc', args: { event: 'x', kind: 'signup', text: 'y' } }).ok).toBe(false)
    expect(() => reg.do('event-role', { event: 'nope', name: 'Sound' })).toThrow(/no event/)
  })
  it('the template prompt names the card types the registry defines', () => {
    const { reg } = setup()
    const p = templatePrompt('IYG circle')
    for (const t of ['event-create', 'event-doc', 'event-role', 'event-resource']) { expect(p).toContain(t); expect(reg.specs().some((s) => s.type === t)).toBe(true) }
  })
})
