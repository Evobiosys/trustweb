// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 mcp-parity: the preview side of an MCP call (src/mcp_live.ts): when a card shows, what Apply / Undo do, what "applies directly" skips. */
import { createActions, oneOf, str } from '../../src/actions.ts'
import { plan, pollOnce, startMcpLive, summaryOf } from '../../src/mcp_live.ts'

const ev = (over) => ({ id: 'e' + Math.random(), at: '2026-11-12T10:00:00Z', kind: 'record', tool: 'set_ring', summary: 'set_ring {"person":"Ada"}', ...over })
function fixture({ direct = false } = {}) {
  const reg = createActions()
  const state = { look: 'default', removed: 0 }
  reg.define({ type: 'set-look', doc: '', shape: '', parse: (a) => ({ look: oneOf(a, 'look', ['default', 'sleek']) }), label: (a) => `look ${a.look}`, apply: (a) => { const p = state.look; state.look = a.look; return () => { state.look = p } } })
  reg.define({ type: 'remove-person', doc: '', shape: '', parse: (a) => ({ person: str(a, 'person', 80) }), label: (a) => `remove ${a.person}`, apply: () => { state.removed++ }, auto: false })
  const log = { adopt: 0, keepMine: 0, cards: [], hidden: 0, toasts: [] }
  const d = {
    fetch: async () => ({ ok: false }), actions: reg, direct: () => direct,
    adopt: async () => { log.adopt++ }, keepMine: async () => { log.keepMine++ },
    show: (title, body, buttons) => log.cards.push({ title, body, buttons }), hide: () => { log.hidden++ },
    toast: (m, o) => log.toasts.push({ m, o }), setTimer: () => 0,
  }
  const live = startMcpLive(d)
  const press = (attr) => log.cards.at(-1).buttons.find((b) => b.attr === attr).run()
  return { state, log, live, press, reg }
}

describe('plan', () => {
  const ok = (auto = true, undoable = true) => ({ ok: true, action: { auto, undoable } })
  it('a record change waits on a card, or is taken at once in direct mode', () => {
    expect(plan(ev(), false, null)).toEqual({ do: 'card' })
    expect(plan(ev(), true, null)).toEqual({ do: 'apply' })
  })
  it('an action runs at once in direct mode only when it needs no approval of its own and can be undone', () => {
    expect(plan(ev({ kind: 'action' }), true, ok())).toEqual({ do: 'apply' })
    expect(plan(ev({ kind: 'action' }), true, ok(false))).toEqual({ do: 'card' })
    expect(plan(ev({ kind: 'action' }), true, ok(true, false))).toEqual({ do: 'card' })
    expect(plan(ev({ kind: 'action' }), false, ok())).toEqual({ do: 'card' })
  })
  it('a bad action is an error card, direct or not', () => {
    expect(plan(ev({ kind: 'action' }), true, { ok: false, error: 'unknown action: x' })).toEqual({ do: 'error', error: 'unknown action: x' })
  })
})

describe('pollOnce', () => {
  const reply = (j, ok = true) => async () => ({ ok, json: async () => j })
  it('first call has no cursor; later ones carry it', async () => {
    const urls = []
    const f = async (u) => { urls.push(u); return { ok: true, json: async () => ({ events: [], next: 3 }) } }
    expect(await pollOnce(f, null)).toEqual({ events: [], next: 3 })
    await pollOnce(f, 3)
    expect(urls).toEqual(['/__tw/mcp-events', '/__tw/mcp-events?from=3'])
  })
  it('a missing route, a network error or a damaged answer is null', async () => {
    expect(await pollOnce(reply({}, false), null)).toBeNull()
    expect(await pollOnce(async () => { throw new Error('offline') }, null)).toBeNull()
    expect(await pollOnce(reply({ events: 'x' }), null)).toBeNull()
  })
})

describe('summaryOf', () => {
  it('one change reads as tool: args; several as a count and the first three', () => {
    expect(summaryOf([ev()])).toBe('set_ring: {"person":"Ada"}')
    const many = [1, 2, 3, 4].map((n) => ev({ summary: `add_tag {"n":${n}}` }))
    expect(summaryOf(many)).toMatch(/^4: add_tag: \{"n":1\}; .*; \.\.\.$/)
  })
})

describe('the cards', () => {
  it('a record change: one card (several arriving together are one); Apply takes the file, Undo puts this page back', () => {
    const f = fixture()
    f.live.handle([ev(), ev({ tool: 'add_tag', summary: 'add_tag {}' })])
    expect(f.log.cards).toHaveLength(1)
    expect(f.log.cards[0].title).toMatch(/changed your web/)
    expect(f.log.cards[0].body).toMatch(/^2:/)
    f.press('data-mcp-apply')
    expect(f.log.adopt).toBe(1)
    const g = fixture()
    g.live.handle([ev()])
    g.press('data-mcp-undo')
    expect(g.log.keepMine).toBe(1)
  })
  it('an action: Apply runs it through the registry and offers Undo; Dismiss runs nothing', () => {
    const f = fixture()
    f.live.handle([ev({ kind: 'action', tool: 'app_action', action: { type: 'set-look', args: { look: 'sleek' }, why: 'try' } })])
    expect(f.log.cards[0].body).toBe('look sleek (try)')
    expect(f.state.look).toBe('default')
    f.press('data-mcp-apply')
    expect(f.state.look).toBe('sleek')
    f.log.toasts[0].o.onClick()
    expect(f.state.look).toBe('default')
    const g = fixture()
    g.live.handle([ev({ kind: 'action', action: { type: 'set-look', args: { look: 'sleek' } } })])
    g.press('data-mcp-dismiss')
    expect(g.state.look).toBe('default')
    expect(g.log.hidden).toBe(1)
  })
  it('an invalid action shows its error and only Dismiss', () => {
    const f = fixture()
    f.live.handle([ev({ kind: 'action', action: { type: 'set-look', args: { look: 'neon' } } })])
    expect(f.log.cards[0].title).toMatch(/cannot be done/)
    expect(f.log.cards[0].buttons.map((b) => b.attr)).toEqual(['data-mcp-dismiss'])
  })
  it('cards come one after another: the next shows when the first is answered', () => {
    const f = fixture()
    f.live.handle([ev({ kind: 'action', action: { type: 'set-look', args: { look: 'sleek' } } }), ev({ kind: 'action', action: { type: 'set-look', args: { look: 'default' } } })])
    expect(f.log.cards).toHaveLength(1)
    f.press('data-mcp-dismiss')
    expect(f.log.cards).toHaveLength(2)
  })
})

describe('MCP applies directly', () => {
  it('takes a record change at once and runs an undoable action without a card; remove-person still asks', () => {
    const f = fixture({ direct: true })
    f.live.handle([ev({ kind: 'action', action: { type: 'set-look', args: { look: 'sleek' } } })])
    expect(f.state.look).toBe('sleek')
    expect(f.log.cards).toHaveLength(0)
    expect(f.log.toasts[0].m).toMatch(/An agent did: look sleek/)
    f.live.handle([ev({ kind: 'action', action: { type: 'remove-person', args: { person: 'Ada' } } })])
    expect(f.state.removed).toBe(0)
    expect(f.log.cards).toHaveLength(1)
    f.live.handle([ev()])
    expect(f.log.adopt).toBe(1)
  })
})

describe('start', () => {
  it('a missing route stops it quietly (stock preview): no timer, no card', async () => {
    let timers = 0
    startMcpLive({ fetch: async () => ({ ok: false }), actions: createActions(), direct: () => false, adopt: async () => {}, keepMine: async () => {}, show: () => {}, hide: () => {}, toast: () => {}, setTimer: () => { timers++ } })
    await new Promise((r) => setTimeout(r, 10))
    expect(timers).toBe(0)
  })
})
