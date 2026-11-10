// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 ai-edit-chat: the action registry (src/actions.ts): typed, undoable commands with a human label. */
import { createActions, str, oneOf, bool } from '../../src/actions.ts'

function counter() {
  const a = createActions()
  const box = { n: 0 }
  a.define({
    type: 'add', doc: 'Adds n.', shape: '{"n": number}',
    parse: (x) => { if (typeof x.n !== 'number') throw new Error('n must be a number'); return { n: x.n } },
    label: (x) => `Add ${x.n}`,
    apply: (x) => { box.n += x.n; return () => { box.n -= x.n } },
  })
  a.define({
    type: 'tap', doc: 'Taps.', shape: '{}', parse: () => ({}), label: () => 'Tap', apply: () => undefined, auto: false, undoable: false,
  })
  return { a, box }
}

describe('action registry', () => {
  it('check accepts a known action and labels it', () => {
    const { a } = counter()
    const r = a.check({ type: 'add', args: { n: 2 }, why: 'because' })
    expect(r.ok).toBe(true)
    expect(r.action).toEqual({ type: 'add', args: { n: 2 }, label: 'Add 2', auto: true, undoable: true, why: 'because' })
  })

  it('check rejects unknown types, bad args and non-objects', () => {
    const { a } = counter()
    expect(a.check({ type: 'rm-rf', args: {} })).toMatchObject({ ok: false, error: 'unknown action: rm-rf' })
    expect(a.check({ type: 'add', args: { n: 'x' } })).toMatchObject({ ok: false, error: 'add: n must be a number' })
    expect(a.check('add')).toMatchObject({ ok: false })
    expect(a.check(null)).toMatchObject({ ok: false })
    expect(a.check({ type: 'add' })).toMatchObject({ ok: false, error: 'add: n must be a number' })
    expect(a.check({ type: '__proto__', args: {} })).toMatchObject({ ok: false })
  })

  it('run applies, undo reverts; a step that cannot be undone says so', () => {
    const { a, box } = counter()
    const done = a.run(a.check({ type: 'add', args: { n: 3 } }).action)
    expect(box.n).toBe(3)
    expect(done.label).toBe('Add 3')
    done.undo()
    expect(box.n).toBe(0)
    const tap = a.check({ type: 'tap', args: {} }).action
    expect(tap.auto).toBe(false)
    expect(tap.undoable).toBe(false)
  })

  it('undo runs once only', () => {
    const { a, box } = counter()
    const done = a.run(a.check({ type: 'add', args: { n: 1 } }).action)
    done.undo(); done.undo()
    expect(box.n).toBe(0)
  })

  it('do = check + run; it throws on an invalid action', () => {
    const { a, box } = counter()
    a.do('add', { n: 5 })
    expect(box.n).toBe(5)
    expect(() => a.do('nope', {})).toThrow('unknown action: nope')
  })

  it('every run is told to listeners and kept in recent() with who did it', () => {
    const { a } = counter()
    const seen = []
    const off = a.onRun((act, by) => seen.push(`${by}:${act.label}`))
    a.do('add', { n: 1 })
    a.do('add', { n: 2 }, 'assistant')
    off()
    a.do('add', { n: 3 })
    expect(seen).toEqual(['user:Add 1', 'assistant:Add 2'])
    expect(a.recent().map((r) => `${r.by}:${r.label}`)).toEqual(['user:Add 1', 'assistant:Add 2', 'user:Add 3'])
  })

  it('recent keeps the last 20', () => {
    const { a } = counter()
    for (let i = 0; i < 25; i++) a.do('add', { n: i })
    expect(a.recent()).toHaveLength(20)
    expect(a.recent()[0].label).toBe('Add 5')
  })

  it('a type is defined once; specs() lists them for the model', () => {
    const { a } = counter()
    expect(() => a.define({ type: 'add', doc: '', shape: '', parse: () => ({}), label: () => '', apply: () => undefined })).toThrow()
    expect(a.specs().map((s) => s.type)).toEqual(['add', 'tap'])
  })

  it('arg helpers', () => {
    expect(str({ a: ' x ' }, 'a')).toBe('x')
    expect(() => str({ a: '' }, 'a')).toThrow('a is required')
    expect(() => str({ a: 'xxxx' }, 'a', 3)).toThrow('a is too long')
    expect(str({}, 'a', 10, true)).toBeUndefined()
    expect(oneOf({ r: 'close' }, 'r', ['close', 'friend'])).toBe('close')
    expect(() => oneOf({ r: 'x' }, 'r', ['close'])).toThrow('r must be one of close')
    expect(bool({ on: false }, 'on')).toBe(false)
    expect(() => bool({ on: 'yes' }, 'on')).toThrow('on must be true or false')
  })
})
