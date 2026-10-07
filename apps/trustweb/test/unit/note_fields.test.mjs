/**
 * The wave-5 optional record fields (src/note_fields.ts): General notes, plain notes, item context. Dedupe, order, cap,
 * and a load that never throws and never alters a valid record.
 */
import { CONTEXT_MAX, CONTEXT_TEXT_MAX, GENERAL_NOTES_MAX, appendContext, cleanGeneralNotes, contextOf, normaliseNoteFields, noteKey } from '../../src/note_fields.ts'

const item = (over = {}) => ({ id: 'i1', text: 'Loudspeakers', audience: 'fof', included: true, createdAt: 1, ...over })
const state = (over = {}) => ({ v: 1, me: { id: 'me', displayName: 'J' }, peers: [], people: [], inventory: [item()], log: [], notificationsOn: false, ...over })

describe('cleanGeneralNotes', () => {
  it('trims, caps, and reads a non-string or blank as none', () => {
    expect(cleanGeneralNotes('  hello  ')).toBe('hello')
    expect(cleanGeneralNotes('x'.repeat(GENERAL_NOTES_MAX + 50))).toHaveLength(GENERAL_NOTES_MAX)
    for (const bad of [undefined, null, 5, {}, [], '   ']) expect(cleanGeneralNotes(bad)).toBe('')
  })
})

describe('appendContext', () => {
  it('adds notes oldest first, with when and the recording they came from', () => {
    const i = item()
    expect(appendContext(i, 'Lent them to Anna in June', 10, 'm1')).toBe(true)
    expect(appendContext(i, 'Two of them, 200 W', 20)).toBe(true)
    expect(i.context).toEqual([{ text: 'Lent them to Anna in June', at: 10, meetingId: 'm1' }, { text: 'Two of them, 200 W', at: 20 }])
  })
  it('skips an empty note, a repeat (case and spacing do not matter) and the item\'s own text', () => {
    const i = item()
    appendContext(i, 'Two of them', 1)
    expect(appendContext(i, '   ', 2)).toBe(false)
    expect(appendContext(i, '  TWO   of them ', 3)).toBe(false)
    expect(appendContext(i, 'loudspeakers', 4)).toBe(false)
    expect(contextOf(i)).toHaveLength(1)
  })
  it('caps each note and keeps only the newest CONTEXT_MAX', () => {
    const i = item()
    appendContext(i, 'y'.repeat(CONTEXT_TEXT_MAX + 30), 1)
    expect(i.context[0].text).toHaveLength(CONTEXT_TEXT_MAX)
    const j = item()
    for (let n = 0; n < CONTEXT_MAX + 5; n++) appendContext(j, `note ${n}`, n)
    expect(j.context).toHaveLength(CONTEXT_MAX)
    expect(j.context[0].text).toBe('note 5')
    expect(j.context.at(-1).text).toBe(`note ${CONTEXT_MAX + 4}`)
  })
  it('an item without context is unchanged until something is added', () => {
    const i = item()
    appendContext(i, '', 1)
    expect('context' in i).toBe(false)
    expect(contextOf(i)).toEqual([])
  })
})

describe('normaliseNoteFields', () => {
  it('leaves a valid record exactly as it is and changes nothing (idempotent)', () => {
    const s = state({
      inventory: [item({ context: [{ text: 'a', at: 1 }, { text: 'b', at: 2, meetingId: 'm1' }] })],
      meetings: [{ id: 'm1', about: 'x', kind: 'who', where: '', startedAt: 1, endedAt: 2, durationMs: 1, meeting: false, lines: [], transcript: [], generalNotes: 'typed', plain: true }],
    })
    const before = JSON.stringify(s)
    expect(normaliseNoteFields(s)).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })
  it('a record with none of the fields is unchanged', () => {
    const s = state({ meetings: [{ id: 'm', about: 'x', kind: 'what', where: '', startedAt: 1, endedAt: 2, durationMs: 1, meeting: false, lines: [], transcript: [] }] })
    const before = JSON.stringify(s)
    expect(normaliseNoteFields(s)).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })
  it('drops wrong types, cleans a context list (bad entries out, duplicates out, newest kept), caps General notes', () => {
    const s = state({
      inventory: [item({ context: [{ text: 'a', at: 1 }, { text: 'A ', at: 2 }, 'junk', { text: '', at: 3 }, { text: 'c', at: 'x' }, null, { text: 'd', at: 4, meetingId: 7 }] })],
      meetings: [
        { id: 'm1', generalNotes: 42, plain: 'yes', lines: [], transcript: [] },
        { id: 'm2', generalNotes: 'z'.repeat(GENERAL_NOTES_MAX + 10), lines: [], transcript: [] },
        { id: 'm3', generalNotes: '   ', lines: [], transcript: [] },
        'junk', null,
      ],
    })
    expect(normaliseNoteFields(s)).toBe(true)
    expect(s.inventory[0].context).toEqual([{ text: 'a', at: 1 }])
    expect('generalNotes' in s.meetings[0]).toBe(false)
    expect('plain' in s.meetings[0]).toBe(false)
    expect(s.meetings[1].generalNotes).toHaveLength(GENERAL_NOTES_MAX)
    expect('generalNotes' in s.meetings[2]).toBe(false)
    expect(normaliseNoteFields(s)).toBe(false)
  })
  it('a context that is not an array is dropped; a list of only bad entries is dropped', () => {
    const s = state({ inventory: [item({ context: 'oops' }), item({ id: 'i2', context: [1, 2] })] })
    expect(normaliseNoteFields(s)).toBe(true)
    expect(s.inventory.every((i) => !('context' in i))).toBe(true)
  })
  it('never throws on an odd record', () => {
    for (const odd of [{ v: 1 }, { v: 1, meetings: 'x', inventory: 5 }, { v: 1, meetings: [1, 'a', null], inventory: [null, 3] }]) expect(() => normaliseNoteFields(odd)).not.toThrow()
  })
  it('noteKey compares by lower case and collapsed spacing', () => {
    expect(noteKey('  Hello   WORLD ')).toBe('hello world')
  })
})
