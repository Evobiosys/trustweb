import { describe, expect, it } from 'vitest'
import { isGoogleCsvHeader, parseGoogleCsv } from '../../src/import/google_csv'
import { ContactSource } from '../../src/import/types'

import current from '../fixtures/contacts/google_current.csv?raw'
import legacy from '../fixtures/contacts/google_legacy.csv?raw'
import notGoogle from '../fixtures/contacts/not_google.csv?raw'

const fixture = (f: string): string => ({ 'google_current.csv': current, 'google_legacy.csv': legacy, 'not_google.csv': notGoogle })[f] ?? ''

describe('parseGoogleCsv current export', () => {
  const r = parseGoogleCsv(fixture('google_current.csv'), 'google_current.csv')
  const [anna, bernd, sepp, cafe, phone, clara] = r.contacts

  it('strips the BOM and counts rows: 6 contacts, blank row dropped, none skipped', () => {
    expect(r.contacts).toHaveLength(6)
    expect(r.skipped).toBe(0)
    expect(anna.source).toBe(ContactSource.GoogleCsv)
    expect(anna.file).toBe('google_current.csv')
    expect(anna.sourceRef).toBe('#1')
    expect(clara.sourceRef).toBe('#6')
  })
  it('joins first, middle, last and keeps org, title, birthday', () => {
    expect(anna).toMatchObject({ name: 'Anna Maria Gruber', given: 'Anna', family: 'Gruber', org: 'Alpenbau GmbH', title: 'Bauleiterin', birthday: '1985-03-12' })
  })
  it('keeps quotes, escapes and a newline inside a quoted Notes cell', () => {
    expect(anna.note).toBe('Met at the Linz fair.\nSaid "call in spring".')
  })
  it('splits multi-value cells; emails lower-cased and de-duplicated across columns', () => {
    expect(anna.emails).toEqual(['anna.gruber@example.at', 'anna@example.com'])
    expect(anna.phones).toEqual(['+43 660 5550101', '+43 660 5550102'])
  })
  it('splits labels and drops system labels', () => {
    expect(anna.labels).toEqual(['Family', 'Work'])
    expect(bernd.labels).toEqual([])
  })
  it('keeps --MM-DD, drops a malformed birthday', () => {
    expect(bernd.birthday).toBe('--07-21')
    expect(sepp.birthday).toBeUndefined()
  })
  it('name falls back to nickname, organization, first phone', () => {
    expect(sepp.name).toBe('Sepp')
    expect(cafe.name).toBe('Kaffeehaus Mozart')
    expect(phone.name).toBe('+43 660 5550104')
  })
  it('pads ragged rows', () => {
    expect(clara).toMatchObject({ name: 'Clara Wimmer', phones: [], emails: [] })
  })
  it('falls back to the first email and counts nameless rows as skipped', () => {
    const t = 'First Name,Last Name,E-mail 1 - Value,Phone 1 - Value\n,,x@Example.at,\n,,,\n ,,,\n,,,\n'
    const p = parseGoogleCsv(t, 'a.csv')
    expect(p.contacts.map((c) => c.name)).toEqual(['x@Example.at'.toLowerCase()])
    expect(p.skipped).toBe(0)
    expect(parseGoogleCsv('First Name,Notes\n,only a note\n', 'a.csv')).toEqual({ contacts: [], skipped: 1 })
  })
  it('handles CRLF', () => {
    const p = parseGoogleCsv('First Name,Last Name\r\nA,B\r\nC,D\r\n', 'a.csv')
    expect(p.contacts.map((c) => c.name)).toEqual(['A B', 'C D'])
  })
})

describe('parseGoogleCsv legacy export', () => {
  const r = parseGoogleCsv(fixture('google_legacy.csv'), 'google_legacy.csv')
  it('reads the legacy columns', () => {
    expect(r.contacts).toHaveLength(2)
    expect(r.contacts[0]).toMatchObject({
      name: 'Dora Steiner', given: 'Dora', family: 'Steiner', org: 'Steiner Tischlerei', title: 'Inhaberin',
      birthday: '1979-11-02', note: 'Neighbour', labels: ['Neighbours'], emails: ['dora@example.at'], phones: ['+43 660 5550110'],
    })
  })
  it('uses Name else Nickname when no parts', () => {
    expect(r.contacts[1]).toMatchObject({ name: 'Emil Berger', emails: ['emil.berger@example.com', 'e.berger@example.at'] })
    const p = parseGoogleCsv('Name,Given Name,Nickname\n,,Emmi\n', 'a.csv')
    expect(p.contacts[0].name).toBe('Emmi')
  })
})

describe('format detection and robustness', () => {
  it('rejects a non-Google CSV', () => {
    expect(parseGoogleCsv(fixture('not_google.csv'), 'x.csv')).toEqual({ contacts: [], skipped: 0 })
    expect(isGoogleCsvHeader('date,amount,description')).toBe(false)
    expect(isGoogleCsvHeader('')).toBe(false)
  })
  it('recognises both header generations', () => {
    expect(isGoogleCsvHeader(fixture('google_current.csv').split('\r\n')[0])).toBe(true)
    expect(isGoogleCsvHeader(fixture('google_legacy.csv').split('\r\n')[0])).toBe(true)
  })
  it('parses 5,000 rows under 1 s', () => {
    let t = 'First Name,Last Name,E-mail 1 - Value,Phone 1 - Value,Notes\n'
    for (let i = 0; i < 5000; i++) t += `P${i},Q${i},p${i}@example.at,+43 660 ${5550000 + i},"n ""${i}""\nx"\n`
    const t0 = performance.now()
    const r = parseGoogleCsv(t, 'big.csv')
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(r.contacts).toHaveLength(5000)
  })
  it('never throws on random text', () => {
    const alphabet = 'ab,",\n\r :::*-1\ufeff'
    for (let n = 0; n < 300; n++) {
      let s = n % 3 === 0 ? 'First Name,E-mail 1 - Value\n' : ''
      for (let i = 0; i < 200; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
      expect(() => { parseGoogleCsv(s, 'r.csv'); isGoogleCsvHeader(s) }).not.toThrow()
    }
  })
})
