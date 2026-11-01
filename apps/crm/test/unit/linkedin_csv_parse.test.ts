// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { isLinkedInCsv, parseLinkedInCsv } from '../../src/import/linkedin_csv'
import { MatchReason, findDuplicates } from '../../src/import/dedup'
import { detectFormat } from '../../src/import/detect'
import { ContactSource } from '../../src/import/types'

const CSV = [
  'Notes:',
  '"When you export your connection data, you may see fewer connections, with commas."',
  '',
  'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
  'Anna,Berg,https://www.linkedin.com/in/anna,Anna@Example.com,Acme,CTO,05 Oct 2024',
  'Carl,Dorn,,,Beta,,12 Jan 2023',
  'Anna,Berg,https://www.linkedin.com/in/anna2,,Acme,CTO,',
].join('\n')

describe('linkedin connections parser', () => {
  it('skips the preamble, reads the header row, and maps Connected On to a timestamp', () => {
    const r = parseLinkedInCsv(CSV, 'Connections.csv')
    expect(r.contacts).toHaveLength(3)
    expect(r.contacts[0].name).toBe('Anna Berg')
    expect(r.contacts[0].source).toBe(ContactSource.LinkedIn)
    expect(r.contacts[0].since).toBe(Date.UTC(2024, 9, 5))
    expect(r.contacts[2].since).toBeUndefined()
  })

  it('lower-cases the e-mail and keeps company and position', () => {
    const r = parseLinkedInCsv(CSV, 'Connections.csv')
    expect(r.contacts[0].emails).toEqual(['anna@example.com'])
    expect(r.contacts[0].org).toBe('Acme')
    expect(r.contacts[0].title).toBe('CTO')
  })

  it('the same name twice is a name-only duplicate candidate, never sure', () => {
    const r = parseLinkedInCsv(CSV, 'Connections.csv')
    const groups = findDuplicates(r.contacts)
    const g = groups.find((x) => x.members.includes(0) && x.members.includes(2))
    expect(g).toBeTruthy()
    expect(g!.reasons).toContain(MatchReason.SameName)
    expect(g!.sure).toBe(false)
  })

  it('is detected by content, with a preamble', () => {
    expect(isLinkedInCsv(CSV)).toBe(true)
    expect(detectFormat('Connections.csv', CSV)).toBe(ContactSource.LinkedIn)
  })

  it('a Google CSV is not mistaken for LinkedIn', () => {
    const google = 'First Name,Last Name,E-mail 1 - Value\nAnna,Berg,anna@example.com\n'
    expect(isLinkedInCsv(google)).toBe(false)
    expect(detectFormat('contacts.csv', google)).toBe(ContactSource.GoogleCsv)
  })
})
