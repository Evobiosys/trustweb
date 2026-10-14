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
    expect(ben.lines[0]).toMatchObject({ tanaId: 'y' })
    expect(ben.lines[1]).not.toHaveProperty('tanaId')
  })
  it('keeps node id, created date, ring, and the Google tag', () => {
    expect(anna.id).toBe('tana-a1')
    expect(anna.metAt).toBe(Date.parse('2025-02-20T18:05:49.444Z'))
    expect(anna.lines.at(-1)).toMatchObject({ tag: 'custom', customTag: 'Google Calendar Contacts' })
    expect(anna.ring).toBe('unsorted')
    expect(ben.ring).toBe('close')
    expect(cara.lines.map((l) => l.text)).toEqual(['ring: derived'])
  })
})

describe('tana converter: derived rings', () => {
  const idx = ['Fam', 'Pal', 'Star', 'lena@x.org', 'Plain', 'Own'].map((name, i) => ({ id: `r${i}`, name, breadcrumb: [], created: '2025-02-20T18:05:49.444Z' }))
  const ns: Record<string, string> = {
    r0: '- Fam\n  - **family**: [X]\n  - **famous**: [X]\n', r1: '- Pal\n  - **personal connection**: [X]\n',
    r2: '- Star\n  - **famous**: [X]\n', r3: '- lena@x.org\n', r4: '- Plain\n', r5: '- Own\n  - **Ring**: Friend\n  - **famous**: [X]\n',
  }
  const { record } = convert(idx, ns, [...PERSON_FIELDS])
  it('derives family / friend / unsorted and notes it', () => {
    expect(record.people.map((p) => p.ring)).toEqual(['family', 'friend', 'unsorted', 'unsorted', 'unsorted', 'friend'])
    expect(record.people[0].lines.at(-1)?.text).toBe('ring: derived')
  })
  it('a manual ring wins and carries no derived note', () => {
    expect(record.people[5].lines.some((l) => l.text === 'ring: derived')).toBe(false)
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
