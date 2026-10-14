import { describe, expect, it } from 'vitest'
import { Ring } from '../../../trustweb/src/model'
import { SortOrder, byStage, contactRows, groupByRing, inCustomOrder, matches, moveInOrder, pipeline } from '../../src/contacts'
import { Stage } from '../../src/model'
import type { CrmView } from '../../src/model'
import { sampleApp, sampleCrm } from '../../src/sample'

const NOW = Date.UTC(2026, 9, 6, 12)
const view = (): CrmView => ({ app: sampleApp(NOW), crm: sampleCrm(NOW) })

describe('contacts', () => {
  it('matches name, context and current line text, accent-insensitively', () => {
    const tomas = view().app.people.find((p) => p.id === 'p-tomas')!
    expect(matches(tomas, 'tomas')).toBe(true)
    expect(matches(tomas, 'GRAZ')).toBe(true)
    expect(matches(tomas, 'seed-sharing')).toBe(true)
    expect(matches(tomas, 'projector')).toBe(false)
    expect(matches(tomas, '   ')).toBe(true)
  })

  it('sorts by last activity, then by name', () => {
    const rows = contactRows(view(), '', SortOrder.Recent)
    expect(rows[0].person.id).toBe('p-noor')
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].lastAt).toBeGreaterThanOrEqual(rows[i].lastAt)
    const names = contactRows(view(), '', SortOrder.Name).map((r) => r.person.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('groups by ring in ring order and drops empty rings', () => {
    const groups = groupByRing(contactRows(view(), 'hofbauer', SortOrder.Name))
    expect(groups.map((g) => g.ring)).toEqual([Ring.Close])
    const all = groupByRing(contactRows(view(), '', SortOrder.Name))
    expect(all.map((g) => g.ring)).toEqual([Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending])
  })

  it('counts only current lines', () => {
    const v = view()
    v.app.people[0].lines[0] = { ...v.app.people[0].lines[0], status: 'gone' as never }
    const row = contactRows(v, '', SortOrder.Name).find((r) => r.person.id === v.app.people[0].id)!
    expect(row.openLines).toBe(1)
  })

  it('builds the pipeline from opportunity, looking and offer lines with a default stage', () => {
    const cards = pipeline(view())
    expect(cards.map((c) => c.line.id).sort()).toEqual(['l-aisha-1', 'l-lena-2', 'l-marta-1', 'l-marta-2', 'l-tomas-1'])
    expect(byStage(cards, Stage.Talking).map((c) => c.line.id)).toEqual(['l-tomas-1'])
    expect(byStage(cards, Stage.Idea).map((c) => c.line.id).sort()).toEqual(['l-lena-2', 'l-marta-1', 'l-marta-2'])
    expect(byStage(cards, Stage.Dropped)).toEqual([])
  })
})

describe('custom order', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('moves an id before another, or to the end', () => {
    expect(moveInOrder(ids, 'c', 'a')).toEqual(['c', 'a', 'b', 'd'])
    expect(moveInOrder(ids, 'a', null)).toEqual(['b', 'c', 'd', 'a'])
  })
  it('sorts by the stored order; ids it lacks follow in their current order', () => {
    expect(inCustomOrder(ids, (x) => x, ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
    expect(inCustomOrder(ids, (x) => x, undefined)).toEqual(ids)
  })
})
