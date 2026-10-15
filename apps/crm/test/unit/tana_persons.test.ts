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
    expect(stats).toEqual({ persons: 3, lines: 2, withoutFields: 1, environments: 0, hidden: 0, blank: 0 })
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
  it('derives friend / unsorted and notes it; family is a tag, no ring', () => {
    expect(record.people.map((p) => p.ring)).toEqual(['unsorted', 'friend', 'unsorted', 'unsorted', 'unsorted', 'friend'])
    expect(record.people[0].fields['LNlpliq4GdNI']).toBe(true)
    expect(record.people[0].lines.at(-1)?.text).toBe('ring: derived')
  })
  it('a desire of 1 or more with no closer ring is intending; the old checkbox is ignored', () => {
    const i = [{ id: 'a', name: 'A', breadcrumb: [], created: '2025-02-20T18:05:49.444Z' }, { id: 'b', name: 'B', breadcrumb: [], created: '2025-02-20T18:05:49.444Z' },
      { id: 'c', name: 'C', breadcrumb: [], created: '2025-02-20T18:05:49.444Z' }, { id: 'd', name: 'D', breadcrumb: [], created: '2025-02-20T18:05:49.444Z' }]
    const n = {
      a: '- A\n  - **intending to connect (0-10)**: 4\n  - **intending since**: 2026-10-14\n', b: '- B\n  - **intending to connect (0-10)**: 4\n  - **personal connection**: [X]\n',
      c: '- C\n  - **intending to connect**: [X]\n', d: '- D\n',
    }
    const r = convert(i, n, [...PERSON_FIELDS], [], undefined, {}, new Set(), { d: { n: 7, since: '2026-10-13' } }).record.people
    expect(r.map((p) => p.ring)).toEqual(['intending', 'friend', 'unsorted', 'intending'])
    expect(r[0].fields).toMatchObject({ UAfC4PcYo2po: '4', '6A0Y1jShWqIg': '2026-10-14' })
    expect(r[2].fields).not.toHaveProperty('FcZJGS5EH2on')
    expect(r[3].fields).toMatchObject({ UAfC4PcYo2po: '7', '6A0Y1jShWqIg': '2026-10-13' })
  })
  it('a suggestion becomes the ring of a person with no manual ring (family tag, desire, marker line); a manual ring wins', () => {
    const sg = {
      'tana-r4': { ring: 'close_friend', family: true, intending: 0, reason: 'x' }, 'tana-r1': { ring: 'unsorted', family: false, intending: 3, reason: 'y' },
      'tana-r3': { ring: 'unsorted', family: false, intending: 0, reason: 'z' }, 'tana-r5': { ring: 'close_friend', family: false, intending: 0, reason: 'w' },
    }
    const r = convert(idx, ns, [...PERSON_FIELDS], [], undefined, {}, new Set(), {}, sg, '2026-10-14').record.people
    expect(r.map((p) => p.ring)).toEqual(['unsorted', 'intending', 'unsorted', 'unsorted', 'close', 'friend'])
    expect(r[4].fields['LNlpliq4GdNI']).toBe(true)
    expect(r[4]).toMatchObject({ ringSuggested: true })
    expect(r[4].lines.some((l) => l.text.startsWith('ring:'))).toBe(false)
    expect(r[1].fields).toMatchObject({ UAfC4PcYo2po: '3', '6A0Y1jShWqIg': '2026-10-14' })
    expect(r[3].lines.at(-1)?.text).toBe('ring: derived')
    expect(r[5]).not.toHaveProperty('ringSuggested')
  })
  it('the Tana ring field is the ring (dashed while "ring approved" is off, confirmed when on); the field beats a local ring: line, which beats a suggestion; an approved ring is never overridden', () => {
    const schema = [...PERSON_FIELDS, { id: 'rVfw62lb7BYD', tanaAttributeId: 'rVfw62lb7BYD', label: 'ring in TrustWeb', type: 'options' as const, description: '' },
      { id: '_7wgarGd90ZR', tanaAttributeId: '_7wgarGd90ZR', label: 'ring approved', type: 'checkbox' as const, description: '' }]
    const i = ['U', 'A', 'M', 'L'].map((name, k) => ({ id: `t${k}`, name, breadcrumb: [], created: '2025-02-20T18:05:49.444Z' }))
    const n = {
      t0: '- U\n  - **ring**: friend\n  - **ring approved**: [ ]\n', t1: '- A\n  - **ring**: close friend\n  - **ring approved**: [X]\n',
      t2: '- M\n  - ring: acquaintance\n  - **ring**: close friend\n', t3: '- L\n  - ring: friend\n  - **ring**: unsorted\n  - **ring approved**: [X]\n  - **intending to connect (0-10)**: 7\n',
    }
    const sg = { 'tana-t0': { ring: 'close_friend', family: true, intending: 0, reason: 'x' } }
    const r = convert(i, n, schema, [], undefined, {}, new Set(), {}, sg, '2026-10-14').record.people
    expect(r.map((p) => p.ring)).toEqual(['friend', 'close', 'close', 'unsorted'])
    expect(r[3]).not.toHaveProperty('ringSuggested')
    expect(r[0]).toMatchObject({ ringSuggested: true })
    expect(r[0].lines).toEqual([])
    expect(r[0].fields).not.toHaveProperty('LNlpliq4GdNI')
    expect(r[1].lines.some((l) => l.text.startsWith('ring:'))).toBe(false)
    expect(Object.keys(r[1].fields)).toEqual([])
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

describe('tana first met', () => {
  it('reads the day from the breadcrumb forms and takes the earliest, context = last crumb under the day', async () => {
    const { dayOf, earliest } = await import('../../scripts/tana_first_met.mjs')
    expect(dayOf(['2025', 'Week 41', 'Tue, Oct 7 2025', 'Bhutan'], '2026-01-01')).toBe(Date.UTC(2025, 9, 7))
    expect(dayOf(['2025', 'Week 23', 'Tue, Jun 2', 'Gathering'], '2026-01-01')).toBe(Date.UTC(2025, 5, 2))
    expect(dayOf(['x', '📅Daily Notes', 'Wed, Mar 5, 2025 '], '2026-01-01')).toBe(Date.UTC(2025, 2, 5))
    expect(dayOf(['Library'], '2025-01-01')).toBeNull()
    expect(earliest([
      { breadcrumb: ['2026', 'Week 19', 'Wed, May 6', 'Kat post Tiger'], created: '2026-05-06' },
      { breadcrumb: ['2025', 'Week 41', 'Tue, Oct 7 2025', 'Bhutan', 'people already going there'], created: '2025-10-07' },
    ])).toEqual({ metAt: Date.UTC(2025, 9, 7), context: 'people already going there' })
  })
  it('the converter takes metAt and context from first-met, context only without "met through"', () => {
    const idx = [{ id: 'm1', name: 'Mia', breadcrumb: [], created: '2025-02-20T18:05:49.444Z' }, { id: 'm2', name: 'Moe', breadcrumb: [], created: '2025-02-20T18:05:49.444Z' }]
    const ns = { m1: '- Mia\n', m2: '- Moe\n  - **met through**: Dora\n' }
    const fm = { m1: { metAt: 5, context: 'Gathering' }, m2: { metAt: 6, context: 'Gathering' } }
    const { record } = convert(idx, ns, [...PERSON_FIELDS], [], undefined, fm)
    expect(record.people.map((p) => [p.metAt, p.context])).toEqual([[5, 'Gathering'], [6, '']])
  })
})

describe('hidden and blank persons', () => {
  const idx = [...index, { id: 'd4', name: 'Dora Hide', created: '2025-05-01T10:00:00.000Z' }, { id: 'e5', name: '  ', created: '2025-05-02T10:00:00.000Z' }, { id: 'f6', name: 'Fred Listed', created: '2025-05-03T10:00:00.000Z' }]
  const ns = { ...nodes, d4: '- Dora Hide #person\n  - **hide in trustweb**: [X]\n', e5: '-  #person\n', f6: '- Fred Listed #person\n' }
  it('leaves out a ticked checkbox, a listed id and an empty name, and counts them', () => {
    const { record, stats } = convert(idx, ns, [...PERSON_FIELDS], [], undefined, {}, new Set(['f6']))
    expect(record.people.map((p: { name: string }) => p.name)).toEqual(['Anna Beispiel', 'Ben Muster', 'Cara Probe'])
    expect(stats).toMatchObject({ persons: 3, hidden: 2, blank: 1 })
  })
})

describe('generator keeps TrustWeb-only entries', () => {
  it('re-emits tw-non-responsive on regeneration', async () => {
    const { render } = await import('../../scripts/tana_schema_to_fields.mjs')
    expect(render([], 'person')).toContain('"id": "tw-non-responsive"')
  })
})
