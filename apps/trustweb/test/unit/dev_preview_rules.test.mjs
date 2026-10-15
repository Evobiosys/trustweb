/** Dev preview overlay: disabled boxes and toggle cascade. */
import { readyToGo as readyToGoSource } from '../../dev_preview_rules.mjs'
import { cascaded, ciLine, collapseStore, confirmText, descendants, devLabel, devUrl, needsHint, parseStep, prButton, prGate, prNeedsUpdate, testLine, prRunning, readyToGo, rowPlan, setMap, stepText, tapped, toggled, tree } from '../../src/dev_preview_rules.ts'

const f = (key, requires = [], checked = true) => ({ key, branch: 'wave7/' + key, title: 'T-' + key, requires, checked })
const set = [f('events'), f('event-link', ['events']), f('deep', ['event-link']), f('overlay')]
const on = (fs) => fs.filter((x) => x.checked).map((x) => x.key)

describe('dev preview rules', () => {
  it('a box is disabled only while a required feature is unchecked, with its title as hint', () => {
    expect(needsHint(set, 'event-link')).toBeNull()
    expect(needsHint(toggled(set, 'events', false), 'event-link')).toBe('needs T-events')
    expect(needsHint(set, 'nope')).toBeNull()
  })
  it('off unchecks dependents transitively and leaves the rest', () => {
    expect(on(toggled(set, 'events', false))).toEqual(['overlay'])
    expect(on(toggled(set, 'deep', false))).toEqual(['events', 'event-link', 'overlay'])
  })
  it('on checks the requires transitively', () => {
    const off = toggled(set, 'events', false)
    expect(on(toggled(off, 'deep', true))).toEqual(['events', 'event-link', 'deep', 'overlay'])
    expect(on(toggled(off, 'event-link', true))).toEqual(['events', 'event-link', 'overlay'])
  })
  it('does not mutate its input', () => {
    toggled(set, 'events', false)
    expect(on(set)).toHaveLength(4)
  })
})

describe('dev preview row tap and confirm', () => {
  it('one row lit at a time; the same row again switches it off', () => {
    let lit = null
    lit = tapped(lit, 'a'); expect(lit).toBe('a')
    lit = tapped(lit, 'b'); expect(lit).toBe('b')
    lit = tapped(lit, 'b'); expect(lit).toBeNull()
  })
  it('confirm wording follows the direction of the toggle', () => {
    expect(confirmText('Events', false)).toBe('Re-assemble preview without Events? The page reloads.')
    expect(confirmText('Events', true)).toBe('Re-assemble preview with Events? The page reloads.')
  })
})

describe('dev preview outliner tree and cascade preview', () => {
  const keys = (ns) => ns.map((n) => `${n.depth}:${n.feature.key}`)
  const flat = (ns) => ns.flatMap((n) => [n, ...flat(n.children)])
  it('nests by requires with depth, keeps list order', () => {
    expect(keys(flat(tree(set)))).toEqual(['0:events', '1:event-link', '2:deep', '0:overlay'])
  })
  it('a feature whose requires are missing sits at the root; the first present require is the parent', () => {
    const odd = [f('a'), f('b', ['gone']), f('c', ['gone', 'a'])]
    expect(keys(flat(tree(odd)))).toEqual(['0:a', '1:c', '0:b'])
  })
  it('cascaded lists what flips with a toggle, not the key itself', () => {
    expect(cascaded(set, 'events', false)).toEqual(['event-link', 'deep'])
    expect(cascaded(set, 'overlay', false)).toEqual([])
    expect(cascaded(toggled(set, 'events', false), 'deep', true)).toEqual(['events', 'event-link'])
  })

  it('readyToGo needs three 200s in a row from a server started after since', () => {
    const ok = { status: 200, serverStarted: 2000 }
    expect(readyToGo([ok, ok, ok], 1000)).toBe(true)
    expect(readyToGo([{ status: 0 }, ok, ok], 1000)).toBe(false)
    expect(readyToGo([ok, ok], 1000)).toBe(false)
    expect(readyToGo([ok, ok, ok], 2000)).toBe(false)
    expect(readyToGo([{ status: 200 }, ok, ok, ok], 1000)).toBe(true)
    expect(readyToGo([ok, ok, { status: 200, serverStarted: 500 }], 1000)).toBe(false)
  })

  it('setMap maps every key to its checked state, confirmText counts several changes', () => {
    expect(setMap(toggled(set, 'deep', false))).toEqual({ events: true, 'event-link': true, deep: false, overlay: true })
    expect(confirmText('X', false, 2)).toBe('Re-assemble preview with these 2 changes? The page reloads.')
  })

  it('descendants counts every feature below a node', () => {
    const [events, overlay] = tree(set)
    expect(descendants(events)).toBe(2)
    expect(descendants(overlay)).toBe(0)
  })
})

describe('dev preview collapse store and PR status', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } } }
  it('starts expanded, remembers per storage, and the re-export is the plain-ESM function', () => {
    const a = mem(), b = mem()
    expect(collapseStore(a).get()).toBe(false)
    collapseStore(a).set(true)
    expect(collapseStore(a).get()).toBe(true)
    expect(collapseStore(b).get()).toBe(false)
    collapseStore(a).set(false)
    expect(collapseStore(a).get()).toBe(false)
    expect(readyToGo).toBe(readyToGoSource)
  })
  it('unavailable storage is not remembered and never throws', () => {
    const dead = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(collapseStore(dead).get()).toBe(false)
    expect(() => collapseStore(dead).set(true)).not.toThrow()
  })
  it('a PR flow runs while the step is none of none, ready, failed', () => {
    expect(['none', 'ready', 'failed'].map(prRunning)).toEqual([false, false, false])
    expect(prRunning('ci')).toBe(true)
  })

  it('a row tap points when the target shows, else shows the steps, else has nothing to offer', () => {
    expect(rowPlan(true, ['a'])).toBe('point')
    expect(rowPlan(true, undefined)).toBe('point')
    expect(rowPlan(false, ['Web view', 'calendar glyph'])).toBe('steps')
    expect(rowPlan(false, [])).toBe('none')
    expect(rowPlan(false, undefined)).toBe('none')
  })
  it('a step is text, optionally with " @ selector"', () => {
    expect(parseStep('Web view')).toEqual({ text: 'Web view', selector: null })
    expect(parseStep('calendar glyph top right @ .events-btn')).toEqual({ text: 'calendar glyph top right', selector: '.events-btn' })
    expect(parseStep('Web @ .tab[data-go="web"]')).toEqual({ text: 'Web', selector: '.tab[data-go="web"]' })
    expect(parseStep('odd @ ')).toEqual({ text: 'odd', selector: null })
  })
  it('PR progress never shows a raw step name', () => {
    expect(stepText('none', undefined, 's')).toBe('starting...')
    expect(stepText('start', 'starting', 's')).toBe('tagging and pushing')
    expect(stepText('pushed', 'pushed as task/s', '261015_1227')).toBe('pushed task/261015_1227')
    expect(stepText('pr', 'PR #8 opened', 's', 8)).toBe('PR #8 opened, CI running')
    expect(stepText('ci', 'CI running (PR #8)', 's', 8)).toBe('CI running (PR #8)')
    expect(stepText('ready', 'slot ready', 's', 8)).toBe('dev ready')
    expect(stepText('failed', 'CI failed on PR #8', 's')).toBe('CI failed on PR #8')
  })
  it('CI estimate in minutes with a countdown from the flow start', () => {
    const t0 = '2026-10-15T10:00:00Z', at = (s) => Date.parse(t0) + s * 1000
    expect(ciLine(200, t0, at(0))).toBe('CI usually takes about 3 min · about 3:20 left')
    expect(ciLine(200, t0, at(140))).toBe('CI usually takes about 3 min · about 1:00 left')
    expect(ciLine(200, t0, at(300))).toBe('CI usually takes about 3 min · should be done any moment')
    expect(ciLine(20, t0, at(0))).toContain('about 1 min')
  })
  it('dev opens at the same place as the preview, labelled by its host', () => {
    expect(devUrl('https://dev2.trustweb.one/', { pathname: '/', search: '', hash: '#/web' })).toBe('https://dev2.trustweb.one/#/web')
    expect(devUrl('https://dev2.trustweb.one/', { pathname: '/x', search: '?a=1', hash: '' })).toBe('https://dev2.trustweb.one/x?a=1')
    expect(devLabel('https://dev2.trustweb.one/')).toBe('dev2')
  })
  it('the x hides the panel for this tab only', () => {
    const m = new Map()
    const store = collapseStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) })
    expect(store.hidden()).toBe(false)
    store.hide()
    expect(store.hidden()).toBe(true)
    expect(store.get()).toBe(false)
  })
})

describe('dev preview PR update', () => {
  it('prNeedsUpdate: only with a PR that has no sha or another sha', () => {
    expect(prNeedsUpdate(null, 'abc')).toBe(false)
    expect(prNeedsUpdate({}, 'abc')).toBe(true)
    expect(prNeedsUpdate({ sha: 'abc' }, 'def')).toBe(true)
    expect(prNeedsUpdate({ sha: 'abc' }, undefined)).toBe(true)
    expect(prNeedsUpdate({ sha: 'abc' }, 'abc')).toBe(false)
  })
  it('prButton: create, update or nothing', () => {
    expect(prButton(null, 9, 'abc')).toBe('Create PR with 9 checked')
    expect(prButton({ number: 8, sha: 'x' }, 9, 'abc')).toBe('Update PR #8 with 9 checked')
    expect(prButton({ number: 8 }, 9, 'abc')).toBe('Update PR #8 with 9 checked')
    expect(prButton({ number: 8, sha: 'abc' }, 9, 'abc')).toBe('')
  })
  it('confirmText names the PR only when there is one', () => {
    expect(confirmText('Events', false, 1, 8)).toBe('Re-assemble preview without Events? The page reloads. PR #8 keeps its current set until you update it.')
    expect(confirmText('X', true, 2, null)).toBe('Re-assemble preview with these 2 changes? The page reloads.')
  })
})

describe('merged features', () => {
  it('visible() drops features whose branch is on main already', async () => {
    const { visible } = await import('../../src/dev_preview_rules.ts')
    const list = [{ key: 'a', branch: 'x/a', title: 'A', requires: [], checked: true, merged: true }, { key: 'b', branch: 'x/b', title: 'B', requires: ['a'], checked: true }]
    expect(visible(list).map((f) => f.key)).toEqual(['b'])
  })
})

describe('dev preview PR gate', () => {
  const a = { sha: 'abc1234' }
  const t = (o) => ({ sha: 'abc1234', at: '2026-10-15T19:00:00Z', ok: null, running: false, ...o })
  it('four states, same sha only', () => {
    expect(prGate({ assembled: a })).toBe('untested')
    expect(prGate({ assembled: a, tested: t({ running: true }) })).toBe('running')
    expect(prGate({ assembled: a, tested: t({ ok: false }) })).toBe('failed')
    expect(prGate({ assembled: a, tested: t({ ok: true }) })).toBe('passed')
  })
  it('a run on another sha is untested', () => {
    for (const o of [{ ok: true }, { ok: false }, { running: true }]) expect(prGate({ assembled: a, tested: t({ ...o, sha: 'old0000' }) })).toBe('untested')
    expect(prGate({ assembled: null, tested: t({ ok: true }) })).toBe('untested')
  })
  it('lines', () => {
    expect(testLine('untested')).toBe('Tests not run for this selection')
    expect(testLine('running')).toBe('Running the checks (about 40 s)...')
    expect(testLine('failed')).toBe('Checks failed: see below')
    expect(testLine('passed', t({}))).toBe('Checks passed for abc1234')
  })
})
