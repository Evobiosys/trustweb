import { describe, expect, it } from 'vitest'
import { applyChanges, peoplePayload } from '../../src/notes_client'

const line = (id: string, text: string) => ({ id, text, tag: 'note', audience: 'me', status: 'current', notedAt: 1, checkedAt: 1 }) as never
const people = () => [
  { id: 'tana-a', name: 'Anna', context: '', ring: 'friend', metAt: 1, lines: [line('a0', 'Plays chess')], fields: {} },
  { id: 'local-b', name: 'Ben', context: '', ring: 'unsorted', metAt: 1, lines: [] },
] as never[]

describe('notes client', () => {
  it('payload folds the Curator\'s own ring and name edits into each person', () => {
    const out = peoplePayload(people(), { 'tana-a': { 'tw-ring': 'close' } })
    expect(out[0].ring).toBe('close')
    expect(out[1].ring).toBe('unsorted')
  })
  it('the Curator\'s notes and what-happened entries ride along as crm- bullets', () => {
    const out = peoplePayload(people(), undefined, [
      { id: 'i1', personId: 'tana-a', at: 7, kind: 'note', text: 'test' },
      { id: 'i2', personId: 'tana-a', at: 8, kind: 'met', text: '', place: 'Café Prückel' },
      { id: 'i3', personId: 'nobody', at: 9, kind: 'note', text: 'x' },
    ] as never[])
    expect(out[0].lines.map((l) => [l.id, l.text, l.notedAt])).toEqual([['a0', 'Plays chess', 1], ['crm-i1', 'test', 7], ['crm-i2', 'Met (Café Prückel)', 8]])
    expect(out[1].lines).toEqual([])
  })
  it('applies added bullets (new text only) with local provenance and the bullet\'s date; never a ring', () => {
    const calls: unknown[] = []
    const r = applyChanges([
      { id: 'tana-a', path: 'journals/2026_07_11.md', newLines: [{ text: 'Plays chess', date: '' }, { text: 'Lent me the printer', date: '2026-10-02' }, { text: ' ', date: '' }] },
      { id: 'local-b', path: 'pages/Ben.md', newLines: [{ text: 'Likes tea', date: '' }] },
      { id: 'gone', path: 'x.md', newLines: [{ text: 'x', date: '' }] },
    ], people(), { addLine: (id, l) => calls.push(['line', id, l.text, l.notedAt, l.source]), now: () => 5000, newId: () => 'n1' })
    expect(r).toEqual({ lines: 2 })
    expect(calls).toEqual([
      ['line', 'tana-a', 'Lent me the printer', Date.parse('2026-10-02T12:00:00Z'), { kind: 'local', path: 'journals/2026_07_11.md' }],
      ['line', 'local-b', 'Likes tea', 5000, { kind: 'local', path: 'pages/Ben.md' }],
    ])
  })
})
