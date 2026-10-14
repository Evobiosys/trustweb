import { describe, expect, it } from 'vitest'
import { isAppState } from '../../src/model'
import { convert } from '../../scripts/tana_persons_to_record.mjs'
import { PERSON_FIELDS } from '../../src/person_fields'

const index = [
  { id: 'a1', name: 'Anna Beispiel', breadcrumb: ['Library', 'Google Calendar Contacts'], created: '2025-02-20T18:05:49.444Z' },
  { id: 'b2', name: 'Ben Muster', breadcrumb: ['Library'], created: '2025-03-01T10:00:00.000Z' },
  { id: 'c3', name: 'Cara Probe', breadcrumb: ['Library'], created: '2025-04-01T10:00:00.000Z' },
]
const nodes = {
  a1: '- Anna Beispiel #person <!-- node-id: a1 -->\n  - **Email**: anna@example.org <!-- node-id: x -->\n  - **Company**:  \n    - *[... 2 children truncated]*\n  - **Met via**: [Dora Demo #person](tana:zz9)\n',
  b2: `- Ben Muster #person <!-- node-id: b2 -->\n  - **Ring**: Close\n  - Plays chess <!-- node-id: y -->\n  - ${'x'.repeat(300)}\n`,
  c3: '- Cara Probe #person <!-- node-id: c3 -->\n',
}

describe('tana persons converter', () => {
  const { record, stats } = convert(index, nodes, [...PERSON_FIELDS])
  const [anna, ben, cara] = record.people

  it('emits an AppState the CRM accepts', () => {
    expect(isAppState(record)).toBe(true)
    expect(stats).toEqual({ persons: 3, lines: 2, withoutFields: 1, environments: 0 })
  })
  it('turns fields into structured values, plain bullets into note lines, drops empties and truncation markers', () => {
    expect(anna.fields).toEqual({ Bxw7k4FWptqp: 'anna@example.org', 'adhoc:Met via': 'Dora Demo' })
    expect(ben.lines.map((l) => l.text)[0]).toBe('Plays chess')
    expect(ben.lines[1].text.length).toBe(200)
  })
  it('keeps node id, created date, ring, and the Google tag', () => {
    expect(anna.id).toBe('tana-a1')
    expect(anna.metAt).toBe(Date.parse('2025-02-20T18:05:49.444Z'))
    expect(anna.lines.at(-1)).toMatchObject({ tag: 'custom', customTag: 'Google Calendar Contacts' })
    expect(anna.ring).toBe('acquaintance')
    expect(ben.ring).toBe('close')
    expect(cara.lines).toEqual([])
  })
})

describe('tana converter: workspaces, duplicates, environments', () => {
  const ws = [{ id: 'w1', name: 'Home' }, { id: 'w2', name: 'Club &lt;&gt; <span data-inlineref-node="x"></span>Friends' }]
  const idx = [
    { id: 'a1', name: 'Anna Beispiel', breadcrumb: [], created: '2025-02-20T18:05:49.444Z', workspaceId: 'w1' },
    { id: 'a1', name: 'Anna Beispiel', breadcrumb: [], created: '2025-02-20T18:05:49.444Z', workspaceId: 'w2' },
    { id: 'b2', name: 'Ben Muster', breadcrumb: [], created: '2025-03-01T10:00:00.000Z', workspaceId: 'w2' },
  ]
  const env = { index: [{ id: 'e1', name: 'matrix', breadcrumb: [], created: '2026-03-13T09:09:15.175Z', workspaceId: 'w1' }], nodes: {}, schema: [] }
  const { record, stats } = convert(idx, nodes, [...PERSON_FIELDS], ws, env)

  it('collapses duplicate node ids and tags persons outside the first workspace', () => {
    expect(record.people.map((p) => p.id)).toEqual(['tana-a1', 'tana-b2'])
    expect(record.people[0].lines.some((l) => l.text.startsWith('workspace:'))).toBe(false)
    expect(record.people[1].lines.at(-1)?.text).toBe('workspace: Club <> Friends')
    expect(record.me.displayName).toBe('Tana persons (2)')
  })
  it('writes environments without a ring', () => {
    expect(stats.environments).toBe(1)
    expect(record.environments?.[0]).toMatchObject({ id: 'tana-e1', name: 'matrix' })
    expect(record.environments?.[0]).not.toHaveProperty('ring')
  })
})
