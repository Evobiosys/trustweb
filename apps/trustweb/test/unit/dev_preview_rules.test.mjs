/** Dev preview overlay: disabled boxes and toggle cascade. */
import { readyToGo as readyToGoSource } from '../../dev_preview_rules.mjs'
import { cascaded, collapseStore, confirmText, descendants, needsHint, prRunning, readyToGo, setMap, tapped, toggled, tree } from '../../src/dev_preview_rules.ts'

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
})
