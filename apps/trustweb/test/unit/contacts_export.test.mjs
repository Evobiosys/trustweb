// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33: contacts export (vCard 3.0, CSV, JSON) of the people I know; nothing beyond the listed fields leaves. */
import { toVCard, toCsv, toJson } from '../../src/contacts_export.ts'
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'
import { parseVCard } from '../../../crm/src/import/vcard.ts'
import { parseCsv } from '../../../crm/src/import/google_csv.ts'

const NOW = Date.UTC(2026, 10, 7)
const opts = { now: NOW, ringLabel: (r) => `Ring ${r}`, lastContact: (p) => (p.id === 'a' ? Date.UTC(2026, 9, 3) : undefined) }

const anna = {
  id: 'a', name: 'Anna Muster', context: '', ring: 'close', metAt: 0, lines: [],
  fields: {
    [EMAIL_FIELD]: 'anna@example.at', 'email 2': 'anna@example.com', organization: 'Muster; GmbH, Wien', 'job title': 'CTO',
    birthday: '1990-02-03', note: 'Line one\nline, two; \\ end', labels: 'friends, choir',
  },
  channels: { whatsapp: '+436605550001', signal: '+436605550002', telegram: 'annatg' },
  generalNote: 'SECRET-ONLY-ME', sources: [{ source: 's', file: 'f', importedAt: 1, key: 'KEY-LEAK' }],
  theirChannels: { matrix: '@leak:example.com' },
}
const ben = { id: 'b', name: 'Ben', context: '', ring: 'friend', metAt: 0, lines: [], fields: { note: '=HYPERLINK("x")', organization: '@corp' }, channels: { telegram: '+-12' } }
const people = [anna, ben]

describe('contacts export', () => {
  it('vCard round-trips names, emails, phones through the CRM parser', () => {
    const text = toVCard(people, opts)
    expect(text.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true)
    expect(text).toContain('\r\nEND:VCARD\r\n')
    const { contacts } = parseVCard(text, 'x.vcf')
    expect(contacts.map((c) => c.name)).toEqual(['Anna Muster', 'Ben'])
    expect(contacts[0].emails).toEqual(['anna@example.at', 'anna@example.com'])
    expect(contacts[0].phones.map((p) => p.replace(/\s/g, ''))).toEqual(['+436605550001', '+436605550002'])
    expect(contacts[0].org).toBe('Muster; GmbH, Wien')
    expect(contacts[0].title).toBe('CTO')
    expect(contacts[0].birthday).toBe('1990-02-03')
    expect(contacts[0].note).toBe('Line one\nline, two; \\ end')
    expect(contacts[0].labels).toEqual(expect.arrayContaining(['Ring close', 'friends', 'choir']))
  })
  it('vCard escapes and folds at 75 octets', () => {
    const text = toVCard(people, opts)
    expect(text).toContain('ORG:Muster\\; GmbH\\, Wien')
    expect(text).toContain('NOTE:Line one\\nline\\, two\\; \\\\ end')
    expect(text).toContain('N:Muster;Anna;;;')
    const long = toVCard([{ ...ben, fields: { note: 'ä'.repeat(100) } }], opts)
    for (const l of long.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    expect(parseVCard(long, 'x.vcf').contacts[0].note).toBe('ä'.repeat(100))
  })
  it('CSV: BOM, machine headers, CRLF, quoting, parses back', () => {
    const text = toCsv(people, opts)
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text.slice(1).split('\r\n')[0]).toBe('full_name,first_name,last_name,email,emails,phone,phones,company,job_title,birthday,notes,labels,ring,last_contact,channels')
    const rows = parseCsv(text)
    const h = rows[0]
    const a = Object.fromEntries(h.map((k, i) => [k, rows[1][i]]))
    expect(a.full_name).toBe('Anna Muster')
    expect(a.emails).toBe('anna@example.at ::: anna@example.com')
    expect(a.email).toBe('anna@example.at')
    expect(a.phone).toBe('+436605550001')
    expect(a.phones).toBe('+436605550001 ::: +436605550002')
    expect(a.company).toBe('Muster; GmbH, Wien')
    expect(a.notes).toBe('Line one\nline, two; \\ end')
    expect(a.labels).toBe('friends ::: choir')
    expect(a.ring).toBe('Ring close')
    expect(a.last_contact).toBe('2026-10-03')
    expect(a.channels).toBe('whatsapp=+436605550001;signal=+436605550002;telegram=annatg')
  })
  it('CSV formula guard keeps phones with + intact', () => {
    const rows = parseCsv(toCsv(people, opts))
    const b = Object.fromEntries(rows[0].map((k, i) => [k, rows[2][i]]))
    expect(b.notes).toBe("'=HYPERLINK(\"x\")")
    expect(b.company).toBe("'@corp")
    expect(b.last_contact).toBe('')
    const a = Object.fromEntries(rows[0].map((k, i) => [k, rows[1][i]]))
    expect(a.phone.startsWith('+')).toBe(true)
  })
  it('JSON shape', () => {
    const j = JSON.parse(toJson(people, opts))
    expect(j.version).toBe(1)
    expect(j.exportedAt).toBe(new Date(NOW).toISOString())
    expect(j.people[0]).toEqual({
      name: 'Anna Muster', given: 'Anna', family: 'Muster', emails: ['anna@example.at', 'anna@example.com'],
      phones: ['+436605550001', '+436605550002'], org: 'Muster; GmbH, Wien', title: 'CTO', birthday: '1990-02-03',
      note: 'Line one\nline, two; \\ end', labels: ['friends', 'choir'], ring: 'Ring close', lastContact: '2026-10-03',
      channels: { whatsapp: '+436605550001', signal: '+436605550002', telegram: 'annatg' },
    })
    expect(j.people[1].phones).toEqual([])
    expect(j.people[1]).not.toHaveProperty('lastContact')
  })
  it('never leaks generalNote, ids, keys, sources, theirChannels', () => {
    for (const out of [toVCard(people, opts), toCsv(people, opts), toJson(people, opts)]) {
      for (const bad of ['SECRET-ONLY-ME', 'KEY-LEAK', '@leak:example.com']) expect(out).not.toContain(bad)
    }
    expect(Object.keys(JSON.parse(toJson(people, opts)).people[0]).sort()).toEqual(
      ['birthday', 'channels', 'emails', 'family', 'given', 'labels', 'lastContact', 'name', 'note', 'org', 'phones', 'ring', 'title'])
  })
  it('phones typed by the import (fields phone, phone 2) are exported once, next to the channels', () => {
    const eva = { id: 'e', name: 'Eva Muster', context: '', ring: 'friend', metAt: 0, lines: [], fields: { phone: '+43 660 5550201', 'phone 2': '+43 660 5550202' }, channels: { whatsapp: '+436605550201' } }
    const { contacts } = parseVCard(toVCard([eva], opts), 'x.vcf')
    expect(contacts[0].phones.map((x) => x.replace(/\s/g, ''))).toEqual(['+436605550201', '+436605550202'])
  })
})
