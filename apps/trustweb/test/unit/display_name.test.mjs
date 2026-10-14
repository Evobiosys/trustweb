/** Wave 7: a name that is an email address never shows as the address (packages/person-fields). */
import { displayName } from '../../../../packages/person-fields/src/display_name.ts'

describe('displayName', () => {
  it('leaves ordinary names alone', () => {
    expect(displayName('Anna Meier')).toEqual({ text: 'Anna Meier', glyph: '', title: '' })
  })
  it('shows the local part of a human-looking address, the address in the title', () => {
    expect(displayName('anna.meier@example.org')).toEqual({ text: 'anna.meier', glyph: '', title: 'anna.meier@example.org' })
  })
  it('shows Calendar with the envelope for calendar ids and machine-like locals', () => {
    const id = 'c_4f2a9b7e1d@group.calendar.google.com'
    expect(displayName(id)).toEqual({ text: 'Calendar', glyph: '✉', title: id })
    expect(displayName('a1b2@x.org').text).toBe('Calendar')
    expect(displayName('a@x.org').text).toBe('Calendar')
  })
})
