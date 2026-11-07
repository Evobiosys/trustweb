// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Any contacts CSV (Dex export, Outlook, a spreadsheet) -> ImportedContact[] through a column mapping guessed from the header names. Pure; never throws.
// Dex headers: https://getdex.com/docs/workflows/export (full_name, first_name, last_name, description, job_title, company, birthday, birthday_year, dex_email(s), dex_phone(s), dex_groups, dex_tags).
import { parseCsv } from './google_csv'
import { ContactSource, type ImportedContact, type ParseResult } from './types'

/** What a column can hold; 'birthyear' is only guessed (Dex keeps the year apart), never offered in the picker. */
export type CsvField = 'name' | 'given' | 'family' | 'email' | 'phone' | 'org' | 'title' | 'birthday' | 'birthyear' | 'note' | 'labels'
/** One entry per column; null = ignored. */
export type CsvMapping = (CsvField | null)[]
export const CSV_FIELDS: readonly Exclude<CsvField, 'birthyear'>[] = ['name', 'given', 'family', 'email', 'phone', 'org', 'title', 'birthday', 'note', 'labels']

const RULES: [CsvField, RegExp][] = [
  ['given', /^(first|given) ?name$|^forename$|^vorname$/],
  ['family', /^(last|family) ?name$|^surname$|^nachname$|^familienname$/],
  ['name', /^(full |display |contact )?name$|^contact$/],
  ['email', /^(dex )?e ?mail( adress(e|en)| address(es)?)?s?( \d+)?( value)?$|^mail$/],
  ['phone', /^(dex )?(phone|mobile|cell|tel|telephone|telefon|mobiltelefon|handy|mobil|mobilnummer|telefonnummer)( number)?s?( \d+)?( value)?$/],
  ['org', /^(company|organi[sz]ation|org|employer|firma|unternehmen|organisation)( name)?$/],
  ['title', /^(job |organi[sz]ation )?title$|^position$|^role$|^berufsbezeichnung$|^funktion$/],
  ['birthyear', /^birthday year$|^birth year$/],
  ['birthday', /^(birthday|birth ?date|date of birth|dob|geburtstag|geburtsdatum)$/],
  ['note', /^(notes?|description|comments?|notizen?|bemerkung(en)?|kommentar(e)?)$/],
  ['labels', /^(dex )?(labels?|groups?|tags?|categories|group membership|gruppen?|kategorien)$/],
]
const BIRTHDAY = /^(\d{4}-\d{2}-\d{2}|--\d{2}-\d{2})$/

/** The separator of the header line: ';' or TAB when it outnumbers ',' outside quotes (Excel in de-AT saves ';'). */
export function sniffDelimiter(text: string): string {
  const line = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
  const n: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (const c of line) { if (c === '"') quoted = !quoted; else if (!quoted && c in n) n[c]++ }
  return n[';'] > n[','] && n[';'] >= n['\t'] ? ';' : n['\t'] > n[','] ? '\t' : ','
}

const clean = (h: string): string => h.replace(/^﻿/, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function autoMap(headers: readonly string[]): CsvMapping {
  return headers.map((h) => RULES.find(([, re]) => re.test(clean(h)))?.[0] ?? null)
}

export function csvHeaders(text: string): string[] {
  try { return (parseCsv(text, sniffDelimiter(text))[0] ?? []).map((h) => h.replace(/^﻿/, '').trim()) } catch { return [] }
}

/** Our own CSV export prefixes a formula-looking cell with an apostrophe (OWASP); reading it back drops that guard. */
const unguard = (v: string): string => v.replace(/^'(?=[=+\-@])/, '')

const first = (text: string): string => text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''

/** A header with at least one way to tell people apart (a name, e-mail or phone column). */
export function isGenericContactCsv(head: string): boolean {
  const m = autoMap(csvHeaders(first(head)))
  return m.some((f) => f === 'name' || f === 'given' || f === 'family' || f === 'email' || f === 'phone')
}

/** Dex's own export: machine headers; recognised by full_name next to a Dex-only column. */
export function isDexCsv(head: string): boolean {
  const h = csvHeaders(first(head)).map((x) => x.toLowerCase())
  return h.includes('full_name') && ['dex_email', 'dex_emails', 'last_seen_at', 'dex_groups'].some((x) => h.includes(x))
}

const split = (v: string): string[] => v.split(/\s*(?::{3}|;|,)\s*/).map((x) => x.trim()).filter(Boolean)
const unique = (xs: string[]): string[] => [...new Set(xs)]

export function parseGenericCsv(text: string, file: string, mapping?: CsvMapping, source: ContactSource = ContactSource.GenericCsv): ParseResult {
  try {
    const [head, ...rows] = parseCsv(text, sniffDelimiter(text))
    if (!head) return { contacts: [], skipped: 0 }
    const map = mapping ?? autoMap(head)
    const contacts: ImportedContact[] = []
    let skipped = 0
    rows.forEach((row, i) => {
      const get = (f: CsvField): string[] => map.flatMap((m, c) => (m === f && (row[c] ?? '').trim() ? [unguard((row[c] ?? '').trim())] : []))
      const one = (f: CsvField): string | undefined => get(f)[0]
      const many = (f: CsvField): string[] => get(f).flatMap(split)
      const emails = unique(many('email').map((e) => e.toLowerCase()))
      const phones = unique(many('phone'))
      const given = one('given')
      const family = one('family')
      const org = one('org')
      const name = one('name') || [given, family].filter(Boolean).join(' ') || org || emails[0] || phones[0]
      if (!name) { skipped++; return }
      const c: ImportedContact = { source, file, sourceRef: `#${i + 1}`, name, phones, emails, labels: unique(many('labels')) }
      if (given) c.given = given
      if (family) c.family = family
      if (org) c.org = org
      const title = one('title')
      if (title) c.title = title
      const year = one('birthyear')
      let birthday = one('birthday')
      if (birthday && year && /^\d{4}$/.test(year) && /^--\d{2}-\d{2}$/.test(birthday)) birthday = `${year}${birthday.slice(1)}`
      if (birthday && BIRTHDAY.test(birthday)) c.birthday = birthday
      const note = one('note')
      if (note) c.note = note
      contacts.push(c)
    })
    return { contacts, skipped }
  } catch {
    return { contacts: [], skipped: 0 }
  }
}
