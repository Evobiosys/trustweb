// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// LinkedIn Connections.csv -> ImportedContact[]. Notes lines before the header are skipped. Pure; never throws.
import { parseCsv } from './google_csv'
import { ContactSource, type ImportedContact, type ParseResult, type Parser } from './types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "05 Oct 2024" (LinkedIn's own form) or "2024-10-05"; UTC midnight. Undefined when neither fits. */
export function parseConnectedOn(raw: string | undefined): number | undefined {
  const s = (raw ?? '').trim()
  let m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase())
    return month < 0 ? undefined : Date.UTC(Number(m[3]), month, Number(m[1]))
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined
}

const isHeader = (row: string[]): boolean => {
  const h = row.map((c) => c.trim().toLowerCase())
  return h[0] === 'first name' && h.includes('last name') && h.includes('connected on')
}

/** True when a LinkedIn Connections header row appears in the first lines (a preamble may come first). */
export function isLinkedInCsv(text: string): boolean {
  return parseCsv(text.replace(/^﻿/, '').slice(0, 4000)).some(isHeader)
}

export const parseLinkedInCsv: Parser = (text, file): ParseResult => {
  try {
    const rows = parseCsv(text)
    const at = rows.findIndex(isHeader)
    if (at < 0) return { contacts: [], skipped: 0 }
    const headers = rows[at].map((c) => c.trim().toLowerCase())
    const col = (name: string): number => headers.indexOf(name)
    const get = (row: string[], name: string): string => (row[col(name)] ?? '').trim()
    const contacts: ImportedContact[] = []
    let skipped = 0
    rows.slice(at + 1).forEach((row, i) => {
      const name = [get(row, 'first name'), get(row, 'last name')].filter(Boolean).join(' ') || get(row, 'company')
      if (!name) { skipped++; return }
      const c: ImportedContact = {
        source: ContactSource.LinkedIn,
        file,
        sourceRef: `#${i + 1}`,
        name,
        phones: [],
        emails: [get(row, 'email address')].filter(Boolean).map((e) => e.toLowerCase()),
        labels: [],
      }
      const org = get(row, 'company')
      if (org) c.org = org
      const title = get(row, 'position')
      if (title) c.title = title
      const since = parseConnectedOn(get(row, 'connected on'))
      if (since !== undefined) c.since = since
      contacts.push(c)
    })
    return { contacts, skipped }
  } catch {
    return { contacts: [], skipped: 0 }
  }
}
