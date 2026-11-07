// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 33 review P5: semicolon / tab exports and German headers.
import { describe, expect, it } from 'vitest'
import { parseFile } from '../../src/import/detect'
import { ContactSource } from '../../src/import/types'

describe('generic CSV: European exports', () => {
  it('reads a semicolon file with German headers', () => {
    const r = parseFile('x.csv', 'Name;E-Mail;Telefon\nAnna Berger;a@x.at;+4366012345\n')
    expect(r.format).toBe(ContactSource.GenericCsv)
    expect(r.result.contacts[0]).toMatchObject({ name: 'Anna Berger', emails: ['a@x.at'], phones: ['+4366012345'] })
  })
  it('reads Vorname/Nachname/E-Mail-Adresse/Mobiltelefon', () => {
    const r = parseFile('x.csv', 'Vorname,Nachname,E-Mail-Adresse,Mobiltelefon,Firma\nAnna,Berger,a@x.at,+4366012345,Acme\n')
    expect(r.result.contacts[0]).toMatchObject({ name: 'Anna Berger', org: 'Acme', phones: ['+4366012345'] })
  })
  it('reads a tab-separated file', () => {
    const r = parseFile('x.csv', 'Vorname\tNachname\tTelefon\nAnna\tBerger\t0664 123\n')
    expect(r.result.contacts[0]).toMatchObject({ name: 'Anna Berger', phones: ['0664 123'] })
  })
  it('keeps a quoted semicolon inside a comma file', () => {
    const r = parseFile('x.csv', 'name,email\n"Berger; Anna",a@x.at\n')
    expect(r.result.contacts[0].name).toBe('Berger; Anna')
  })
})
