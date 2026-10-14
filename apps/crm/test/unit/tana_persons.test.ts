import { describe, expect, it } from 'vitest'
import { isAppState } from '../../src/model'
import { convert } from '../../scripts/tana_persons_to_record.mjs'

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
  const { record, stats } = convert(index, nodes)
  const [anna, ben, cara] = record.people

  it('emits an AppState the CRM accepts', () => {
    expect(isAppState(record)).toBe(true)
    expect(stats).toEqual({ persons: 3, lines: 5, withoutFields: 1 })
  })
  it('turns fields and children into note lines, drops links, empties and truncation markers', () => {
    expect(anna.lines.map((l) => l.text).slice(0, 2)).toEqual(['Email: anna@example.org', 'Met via: Dora Demo'])
    expect(ben.lines[2].text.length).toBe(200)
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
