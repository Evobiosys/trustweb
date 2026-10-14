/** Network view data and layout (src/network_graph.ts, wave 7). */
import { LAYOUT_ITERATIONS, alphaAt, buildGraph, defaultsToNetwork, matchIds, shake, step } from '../../src/network_graph.ts'
import { Ring } from '../../src/model.ts'

const me = { id: 'me', displayName: 'Me' }
const person = (id, ring, context = '', lines = 0) => ({
  id, name: 'P' + id, context, ring, metAt: 0,
  lines: Array.from({ length: lines }, () => ({ status: 'current' })),
})
const settle = (g) => { for (let i = 0; i < LAYOUT_ITERATIONS; i++) step(g, alphaAt(i)) }

describe('network graph', () => {
  it('defaults to the network above 60 people only', () => {
    expect(defaultsToNetwork(60)).toBe(false)
    expect(defaultsToNetwork(61)).toBe(true)
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
    const mean = (ring) => { const v = g.nodes.filter((n) => n.ring === ring); return v.reduce((s, n) => s + Math.hypot(n.x, n.y), 0) / v.length }
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
})
