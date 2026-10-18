/** Network view data and layout (src/network_graph.ts, wave 7). */
import { DEFAULT_FORCES, knowsLinks, personLinks, LAYOUT_ITERATIONS, alphaAt, buildGraph, networkChosen, matchIds, shake, step, tierOf, applyPins, pinsOf } from '../../src/network_graph.ts'
import { Ring } from '../../src/model.ts'

const me = { id: 'me', displayName: 'Me' }
const person = (id, ring, context = '', lines = 0) => ({
  id, name: 'P' + id, context, ring, metAt: 0,
  lines: Array.from({ length: lines }, () => ({ status: 'current' })),
})
const settle = (g) => { for (let i = 0; i < LAYOUT_ITERATIONS; i++) step(g, alphaAt(i)) }

describe('network graph', () => {
  it('opens on the rings unless this device chose the network', () => {
    expect(networkChosen(null)).toBe(false)
    expect(networkChosen('rings')).toBe(false)
    expect(networkChosen('junk')).toBe(false)
    expect(networkChosen('network')).toBe(true)
  })

  it('has me pinned at the centre, a star edge per person, dashed for intending', () => {
    const g = buildGraph(me, [person('a', Ring.Close), person('b', Ring.Intending)])
    expect(g.nodes[0].pinned).toBe(true)
    expect(g.edges.map((e) => [e.a, e.b, e.dashed])).toEqual([[0, 1, false], [0, 2, true]])
    expect(g.edges[0].rest).toBeLessThan(g.edges[1].rest)
  })

  it('links people who share a where-met text, case-blind; empty text links nobody', () => {
    const g = buildGraph(me, [person('a', Ring.Friend, 'Hof Linz'), person('b', Ring.Friend, ' hof linz'), person('c', Ring.Friend, ''), person('d', Ring.Friend, '')])
    expect(g.edges.filter((e) => e.a !== 0).map((e) => [e.a, e.b])).toEqual([[1, 2]])
  })

  it('sizes nodes by current note lines', () => {
    const g = buildGraph(me, [person('a', Ring.Friend, '', 0), person('b', Ring.Friend, '', 9)])
    expect(g.nodes[2].r).toBeGreaterThan(g.nodes[1].r)
  })

  it('settles: finite, centre fixed, closer rings nearer on average, deterministic', () => {
    const people = Array.from({ length: 120 }, (_, i) => person('p' + i, [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending][i % 4]))
    const g = buildGraph(me, people)
    settle(g)
    expect(g.nodes.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true)
    expect(g.nodes[0]).toMatchObject({ x: 0, y: 0 })
    const mean = (ring) => { const v = g.nodes.filter((n) => n.tier === ring); return v.reduce((s, n) => s + Math.hypot(n.x, n.y), 0) / v.length }
    expect(mean(Ring.Close)).toBeLessThan(mean(Ring.Intending))
    const g2 = buildGraph(me, people)
    settle(g2)
    expect(g2.nodes[5].x).toBe(g.nodes[5].x)
  })

  it('shake moves free nodes and leaves me; search matches name or context', () => {
    const g = buildGraph(me, [person('a', Ring.Friend, 'Linz')])
    const before = g.nodes[1].x
    shake(g, 1)
    expect(g.nodes[1].x).not.toBe(before)
    expect(g.nodes[0].x).toBe(0)
    expect([...matchIds(g, 'LIN')]).toEqual(['a'])
    expect(matchIds(g, ' ').size).toBe(0)
  })

  describe('rings v3', () => {
    const dist = (p) => { const g = buildGraph(me, [p]); return g.edges[0].rest }
    it('orders close < friend < acquaintance < intending < unsorted, accepting close_friend and old family', () => {
      const d = ['close_friend', 'friend', 'acquaintance', 'intending', 'unsorted'].map((r) => dist(person('a', r)))
      expect([...d].sort((a, b) => a - b)).toEqual(d)
      expect(new Set(d).size).toBe(5)
      expect(buildGraph(me, [person('a', 'close_friend')]).nodes[1].tier).toBe(Ring.Close)
      const old = { ...person('a', 'family'), closeness: 'friend' }
      expect(buildGraph(me, [old]).nodes[1]).toMatchObject({ tier: Ring.Friend, family: true })
    })
    it('family is a tag: purple flag, distance from the ring', () => {
      const n = buildGraph(me, [{ ...person('a', Ring.Acquaintance), tags: ['family'] }]).nodes[1]
      expect(n).toMatchObject({ tier: Ring.Acquaintance, family: true })
      expect(dist({ ...person('a', Ring.Acquaintance), tags: ['family'] })).toBe(dist(person('a', Ring.Acquaintance)))
    })
    it('higher desire sits nearer within the intending band', () => {
      const w = (desire) => dist({ ...person('a', Ring.Intending), desire })
      expect(w(10)).toBeLessThan(w(0))
      expect(w(10)).toBeGreaterThan(dist(person('a', Ring.Acquaintance)))
      expect(w(0)).toBeLessThan(dist(person('a', 'unsorted')))
      expect(buildGraph(me, [{ ...person('a', Ring.Intending), desire: 7 }]).nodes[1].desire).toBe(7)
    })
  })

  describe('person links from fields', () => {
    const ref = (id) => [{ label: id, tanaId: id }]
    const withF = (id, fields, texts = []) => ({ ...person('tana-' + id, Ring.Friend), fields, lines: texts.map((text) => ({ status: 'current', text })) })
    it('met through / works for link directly; community and small workspaces link thin; text values link nobody', () => {
      const ps = [
        withF('A', { X3aA3ndYjClT: ref('B') }), withF('B', {}), withF('C', { zHVsAk7dqNyT: ref('B') }),
        withF('D', { yHXufuk2A7rt: ref('K') }), withF('E', { yHXufuk2A7rt: ref('K') }),
        withF('F', { X3aA3ndYjClT: 'Minerva' }, ['workspace: w']), withF('G', {}, ['workspace: w']),
      ]
      expect(personLinks(ps)).toEqual([[0, 1, false], [2, 1, false], [3, 4, true], [5, 6, true]])
    })
    it('skips a workspace shared by 40 or more', () => {
      const many = (n) => Array.from({ length: n }, (_, i) => withF('p' + i, {}, ['workspace: big']))
      expect(personLinks(many(39)).length).toBe(38)
      expect(personLinks(many(40)).length).toBe(0)
    })
    it('enlarges linked nodes and marks name-only entries faint', () => {
      const ps = [withF('A', { X3aA3ndYjClT: ref('B') }), { ...withF('B', {}), lines: [{ status: 'current', text: 'x' }] }, { ...withF('C', {}), lines: [] }]
      const g = buildGraph(me, ps)
      expect(g.nodes[1].linked).toBe(true)
      expect(g.nodes[3].faint).toBe(true)
      expect(g.nodes[2].faint).toBe(false)
    })
  })
})

describe('forces', () => {
  const people = Array.from({ length: 40 }, (_, i) => person('p' + i, [Ring.Close, Ring.Friend, Ring.Acquaintance][i % 3]))
  const meanR = (f) => {
    const g = buildGraph(me, people)
    for (let i = 0; i < LAYOUT_ITERATIONS; i++) step(g, alphaAt(i), f)
    return g.nodes.slice(1).reduce((s, n) => s + Math.hypot(n.x, n.y), 0) / people.length
  }
  it('default forces equal the argument-less step', () => {
    const a = buildGraph(me, people); const b = buildGraph(me, people)
    for (let i = 0; i < 50; i++) { step(a, alphaAt(i)); step(b, alphaAt(i), DEFAULT_FORCES) }
    expect(a.nodes[7].x).toBe(b.nodes[7].x)
  })
  it('longer links and stronger charge spread the picture; stronger gravity pulls it in', () => {
    const base = meanR(DEFAULT_FORCES)
    expect(meanR({ ...DEFAULT_FORCES, link: 2 })).toBeGreaterThan(base)
    expect(meanR({ ...DEFAULT_FORCES, charge: 2000 })).toBeGreaterThan(base)
    expect(meanR({ ...DEFAULT_FORCES, gravity: 0.02 })).toBeLessThan(base)
  })
  it('collision keeps nodes apart', () => {
    const g = buildGraph(me, people)
    for (let i = 0; i < LAYOUT_ITERATIONS; i++) step(g, alphaAt(i), { ...DEFAULT_FORCES, collide: 30 })
    expect(g.nodes.every((v) => Number.isFinite(v.x))).toBe(true)
  })

  it('reads tiers: new values, old none as unsorted, famous/deceased/calendar ids outside', () => {
    const p = (ring, extra = {}) => ({ ...person('x', ring), ...extra })
    expect(tierOf(p('family'))).toBe(Ring.Close)
    expect(tierOf(p('unsorted'))).toBe('unsorted')
    expect(tierOf(p('none'))).toBe('unsorted')
    expect(tierOf(p('none', { fields: { __XNQ42Dtiwx: true } }))).toBe('outside')
    expect(tierOf(p('none', { name: 'a@b.c' }))).toBe('outside')
    expect(tierOf(p(Ring.Intending))).toBe(Ring.Intending)
  })

  it('lays family at its closeness, unsorted farthest', () => {
    const g = buildGraph(me, [{ ...person('f', 'family'), closeness: Ring.Friend }, person('u', 'none'), person('c', Ring.Close)])
    expect(g.edges.map((e) => e.rest)).toEqual([100, 260, 60])
  })

  it('keeps pinned nodes where they are through settle and shake, and lists them', () => {
    const g = buildGraph(me, [person('a', Ring.Friend), person('b', Ring.Close), person('c', Ring.Close)])
    applyPins(g, { a: { x: 300, y: -40, a: true }, me: { x: 9, y: 9, a: true } })
    settle(g); shake(g, 1)
    expect(g.nodes[1]).toMatchObject({ x: 300, y: -40, pinned: true })
    expect(g.nodes[0]).toMatchObject({ x: 0, y: 0 })
    expect(pinsOf(g)).toEqual({ a: { x: 300, y: -40, a: true } })
  })
})

describe('network knows edges', () => {
  const k = (id, knows) => ({ ...person(id, Ring.Friend), knows })
  it('mutual when both list each other, one-way otherwise; me is mutual with whoever lists it', () => {
    const links = knowsLinks('me', [k('a', ['b', 'me']), k('b', ['a']), k('c', ['a'])])
    expect(links).toEqual([[1, 2, true], [1, 0, true], [3, 1, false]])
  })

  it('ignores missing ids, self-links and repeats', () => {
    expect(knowsLinks('me', [k('a', ['zz', 'a']), k('b', undefined)])).toEqual([])
    expect(knowsLinks('me', [k('a', ['b', 'b']), k('b', ['a'])])).toEqual([[1, 2, true]])
  })

  it('buildGraph draws them: solid for mutual, dashed one-way, tagged', () => {
    const g = buildGraph(me, [k('a', ['b']), k('b', ['a']), k('c', ['a'])])
    expect(g.edges.filter((e) => e.knows).map((e) => [e.a, e.b, e.dashed, e.knows])).toEqual([[1, 2, false, 'mutual'], [3, 1, true, 'oneway']])
  })
})
