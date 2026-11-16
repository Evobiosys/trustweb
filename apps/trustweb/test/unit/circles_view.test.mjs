// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-circles-view: circles = tags drawn as rings; grouping, size, ring slots, and what a drag in or out does to the tags. */
import { CIRCLE_MAX, CIRCLE_MIN, NEW_CIRCLE, RING_MAX, circleSize, circlesOf, dropEffect, hiddenCount, ringSlots } from '../../src/circles_model.ts'
import { applyDrop } from '../../src/circles_apply.ts'
import { hasColourTag, memberIds } from '../../src/colour_tags.ts'

const tags = [{ id: 'fam', colour: '#7b1fa2', label: 'Family' }, { id: 'work', colour: '#e65100' }, { id: 'empty', colour: '#1565c0', label: 'Empty' }]
const people = [
  { id: 'a', ring: 'friend', fields: { fam: 'true', work: 'true' } },
  { id: 'b', ring: 'friend', fields: { work: 'true' } },
  { id: 'c', ring: 'friend', fields: {} },
]
const members = (id) => memberIds(people, tags, id)

describe('circles: grouping and size', () => {
  it('one circle per tag in tag order; a person sits in every circle whose tag they hold; empty tags stay as empty circles', () => {
    const c = circlesOf(tags, members)
    expect(c.map((x) => [x.id, x.name, x.members])).toEqual([['fam', 'Family', ['a']], ['work', 'work', ['a', 'b']], ['empty', 'Empty', []]])
    expect(c.filter((x) => x.members.includes('a')).map((x) => x.id)).toEqual(['fam', 'work'])
  })
  it('a group tag shows its children members', () => {
    const g = [...tags, { id: 'all', colour: '#000000', label: 'All', kind: 'group', parents: [] }, { id: 'kid', colour: '#111111', parents: ['all'] }]
    const ppl = [...people, { id: 'd', ring: 'friend', fields: { kid: 'true' } }]
    expect(circlesOf(g, (id) => memberIds(ppl, g, id)).find((x) => x.id === 'all').members).toEqual(['d'])
  })
  it('size grows with members and is capped', () => {
    expect(circleSize(0)).toBe(CIRCLE_MIN)
    expect(circleSize(3)).toBeGreaterThan(circleSize(1))
    expect(circleSize(500)).toBe(CIRCLE_MAX)
  })
  it('ring slots: clockwise from 12 o\'clock, at most RING_MAX, the rest counted', () => {
    const s = ringSlots(4)
    expect(s).toHaveLength(4)
    expect(s[0].x).toBeCloseTo(0.5); expect(s[0].y).toBeCloseTo(0)
    expect(s[1].x).toBeCloseTo(1); expect(s[1].y).toBeCloseTo(0.5)
    expect(ringSlots(25)).toHaveLength(RING_MAX)
    expect(hiddenCount(25)).toBe(25 - RING_MAX)
    expect(hiddenCount(3)).toBe(0)
    expect(ringSlots(0)).toEqual([])
  })
})

describe('circles: drag decisions', () => {
  const held = (...ids) => new Set(ids)
  it('pool into a circle adds its tag', () => { expect(dropEffect(null, 'fam', held())).toEqual({ add: 'fam' }) })
  it('into a circle the person is in already does nothing', () => { expect(dropEffect(null, 'fam', held('fam'))).toEqual({}) })
  it('from one circle into another adds, the person then sits in both', () => { expect(dropEffect('fam', 'work', held('fam'))).toEqual({ add: 'work' }) })
  it('out of a circle onto the pool or empty space removes that circle\'s tag', () => { expect(dropEffect('fam', null, held('fam', 'work'))).toEqual({ remove: 'fam' }) })
  it('from the pool onto the pool does nothing; onto the same circle does nothing', () => {
    expect(dropEffect(null, null, held())).toEqual({})
    expect(dropEffect('fam', 'fam', held('fam'))).toEqual({})
  })
  it('the empty tile creates a circle', () => { expect(dropEffect(null, NEW_CIRCLE, held())).toEqual({ create: true }) })
})

describe('circles: a drop changes the tags', () => {
  const person = () => ({ fields: { work: 'true' } })
  it('add and remove set and unset the tag; the other tags stay', () => {
    const p = person()
    expect(applyDrop(p, { add: 'fam' }, tags, '')).toMatchObject({ added: 'fam' })
    expect(hasColourTag({ ring: 'friend', fields: p.fields }, 'fam')).toBe(true)
    expect(applyDrop(p, { remove: 'work' }, tags, '')).toMatchObject({ removed: 'work' })
    expect(p.fields).toEqual({ fam: true })
  })
  it('create defines a new tag from the name (unique id) and gives it to the person', () => {
    const p = person()
    const out = applyDrop(p, { create: true }, tags, 'Climbing friends')
    expect(out.added).toBe('climbing-friends')
    expect(out.tags.map((t) => t.id)).toEqual(['fam', 'work', 'empty', 'climbing-friends'])
    expect(p.fields['climbing-friends']).toBeTruthy()
    expect(applyDrop(person(), { create: true }, out.tags, 'Climbing friends').added).toBe('climbing-friends-2')
  })
  it('no effect changes nothing and returns the same tag list', () => {
    const p = person()
    expect(applyDrop(p, {}, tags, '').tags).toBe(tags)
    expect(p.fields).toEqual({ work: 'true' })
  })
})

describe('circles: MCP parity', () => {
  it('circles_layout lists one circle per tag with holders and size; the web_default_view setter accepts circles', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const { recordTools } = await import('../../../mcp/src/record_tools.ts')
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'circles-mcp-')), 'rec.json')
    writeFileSync(file, JSON.stringify({ v: 1, people: [
      { id: 'a', name: 'Ana', ring: 'friend', fields: { work: 'true', fam: 'true' } },
      { id: 'b', name: 'Ben', ring: 'friend', fields: { work: 'true' } },
      { id: 'x', name: 'Gone', ring: 'none', fields: { work: 'true' } },
      { id: 'y', name: 'Del', ring: 'friend', deleted_at: '2026-01-01', fields: { fam: 'true' } },
    ] }))
    const t = Object.fromEntries(recordTools({ file, write: true }).map((x) => [x.name, x]))
    const out = t.circles_layout.run({})
    expect(out.map((c) => [c.tag, c.people, c.size])).toEqual([['fam', 1, circleSize(1)], ['work', 2, circleSize(2)]])
    expect(out[1].members.map((m) => m.id)).toEqual(['a', 'b'])
    expect(t.web_default_view_set.run({ view: 'circles' })).toEqual({ view: 'circles' })
    expect(Object.keys(Object.fromEntries(recordTools({ file, write: false }).map((x) => [x.name, 1])))).toContain('circles_layout')
  })
})
