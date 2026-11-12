// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 ai-edit-chat: the approval state machine of the assistant's action cards (src/ext/assistant/approval.ts). */
import { createApproval } from '../../src/ext/assistant/approval.ts'

const act = (label, o = {}) => ({ type: 't', args: {}, label, auto: true, undoable: true, ...o })

function setup(auto = false) {
  const applied = []
  const runner = {
    run: (a) => {
      if (a.label === 'boom') throw new Error('it broke')
      applied.push(a.label)
      return { label: a.label, undo: () => { applied.splice(applied.indexOf(a.label), 1) } }
    },
  }
  const opts = { auto }
  const ap = createApproval(runner, { auto: () => opts.auto })
  return { ap, applied, opts }
}

describe('approval', () => {
  it('new cards wait for Approve or Skip when Apply as I watch is off', () => {
    const { ap, applied } = setup(false)
    const [a, b] = ap.add([act('one'), act('two')])
    expect(ap.cards().map((c) => c.state)).toEqual(['proposed', 'proposed'])
    expect(ap.approve(a.id)).toBe(true)
    expect(ap.skip(b.id)).toBe(true)
    expect(ap.cards().map((c) => c.state)).toEqual(['applied', 'skipped'])
    expect(applied).toEqual(['one'])
  })

  it('Apply as I watch applies at once, except steps that must be approved', () => {
    const { ap, applied } = setup(true)
    ap.add([act('one'), act('tap', { auto: false, undoable: false })])
    expect(ap.cards().map((c) => c.state)).toEqual(['applied', 'proposed'])
    expect(applied).toEqual(['one'])
  })

  it('undo reverts an applied card; it cannot be undone twice or before it applied', () => {
    const { ap, applied } = setup(false)
    const [a] = ap.add([act('one')])
    expect(ap.undo(a.id)).toBe(false)
    ap.approve(a.id)
    expect(ap.undo(a.id)).toBe(true)
    expect(ap.cards()[0].state).toBe('undone')
    expect(applied).toEqual([])
    expect(ap.undo(a.id)).toBe(false)
    expect(ap.approve(a.id)).toBe(false)
  })

  it('a step that cannot be undone stays applied', () => {
    const { ap } = setup(false)
    const [a] = ap.add([act('tap', { auto: false, undoable: false })])
    ap.approve(a.id)
    expect(ap.undo(a.id)).toBe(false)
    expect(ap.cards()[0].state).toBe('applied')
  })

  it('a failing step is marked failed with its message', () => {
    const { ap } = setup(false)
    const [a] = ap.add([act('boom')])
    ap.approve(a.id)
    expect(ap.cards()[0]).toMatchObject({ state: 'failed', error: 'it broke' })
  })

  it('skipped stays skipped; approving it again does nothing', () => {
    const { ap, applied } = setup(false)
    const [a] = ap.add([act('one')])
    ap.skip(a.id)
    expect(ap.approve(a.id)).toBe(false)
    expect(applied).toEqual([])
  })

  it('approveAll applies every waiting card in order', () => {
    const { ap, applied } = setup(false)
    ap.add([act('one'), act('two'), act('three')])
    ap.skip(ap.cards()[1].id)
    expect(ap.approveAll()).toBe(2)
    expect(applied).toEqual(['one', 'three'])
  })

  it('summary groups the cards for the Done? review', () => {
    const { ap } = setup(false)
    const [a, b, c, d] = ap.add([act('one'), act('two'), act('boom'), act('four')])
    ap.approve(a.id); ap.skip(b.id); ap.approve(c.id)
    const s = ap.summary()
    expect(s.applied.map((x) => x.action.label)).toEqual(['one'])
    expect(s.skipped.map((x) => x.action.label)).toEqual(['two'])
    expect(s.failed.map((x) => x.action.label)).toEqual(['boom'])
    expect(s.proposed.map((x) => x.action.label)).toEqual(['four'])
    expect(s.undone).toEqual([])
    expect(d.state).toBe('proposed')
  })

  it('tells listeners about every change', () => {
    const { ap } = setup(false)
    let n = 0
    ap.onChange(() => n++)
    const [a] = ap.add([act('one')])
    ap.approve(a.id)
    ap.undo(a.id)
    expect(n).toBe(3)
  })
})
