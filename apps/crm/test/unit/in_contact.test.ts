import { describe, expect, it } from 'vitest'
import { inContact } from '../../src/person_view'

const line = (text: string, tag = 'note') => ({ id: text, text, tag, audience: 'me', status: 'current', notedAt: 0, checkedAt: 0 })
const base = { id: 'p', lines: [line('ring: derived'), line('Google Calendar Contacts', 'custom')] } as never

describe('inContact', () => {
  it('false for a person with only markers', () => {
    expect(inContact(base, {}, [{ personId: 'other' }])).toBe(false)
  })
  it('true for met through, first-met date, an interaction or a note line', () => {
    expect(inContact(base, { X3aA3ndYjClT: [{ label: 'Dora' }] }, [])).toBe(true)
    expect(inContact({ ...(base as object), firstMet: true } as never, {}, [])).toBe(true)
    expect(inContact(base, {}, [{ personId: 'p' }])).toBe(true)
    expect(inContact({ id: 'p', lines: [line('Plays chess')] } as never, {}, [])).toBe(true)
  })
})
