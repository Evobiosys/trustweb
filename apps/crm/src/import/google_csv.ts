// Google Contacts CSV (current and legacy export) -> ImportedContact[]. Pure; never throws.
import { ContactSource, type ImportedContact, type Parser } from './types'

const MULTI = ' ::: '
const BIRTHDAY = /^(\d{4}-\d{2}-\d{2}|--\d{2}-\d{2})$/

/** RFC 4180: quoted fields, "" escape, newlines in quotes, CRLF/LF. Rows without text are dropped. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const endRow = (): void => {
    row.push(cell)
    cell = ''
    if (row.some((v) => v.trim())) rows.push(row)
    row = []
  }
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') cell += c
      else if (text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') endRow()
    else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length) endRow()
  return rows
}

const norm = (h: string): string => h.trim().toLowerCase()
const hasFirstName = (headers: string[]): boolean => headers.some((h) => h === 'first name' || h === 'given name')

export function isGoogleCsvHeader(firstLine: string): boolean {
  const first = parseCsv(firstLine)[0]
  return !!first && hasFirstName(first.map(norm))
}

type Cols = Map<string, number>

function indexOf(headers: string[]): Cols {
  const cols: Cols = new Map()
  headers.forEach((h, i) => { if (!cols.has(h)) cols.set(h, i) })
  return cols
}

/** Values of the first matching column, multi-value cells split. */
function values(row: string[], cols: Cols, ...names: string[]): string[] {
  for (const n of names) {
    const i = cols.get(n)
    if (i !== undefined) return (row[i] ?? '').split(MULTI).map((v) => v.trim()).filter(Boolean)
  }
  return []
}

const one = (row: string[], cols: Cols, ...names: string[]): string | undefined => {
  for (const n of names) {
    const i = cols.get(n)
    const v = i === undefined ? '' : (row[i] ?? '').trim()
    if (v) return v
  }
  return undefined
}

/** Every "<prefix> N - Value" column (E-mail / Phone), in column order. */
function valueColumns(headers: string[], prefix: string): string[] {
  const re = new RegExp(`^${prefix} \\d+ - value$`)
  return headers.filter((h) => re.test(h))
}

const unique = (xs: string[]): string[] => [...new Set(xs)]

function toContact(row: string[], cols: Cols, headers: string[], file: string, n: number): ImportedContact | null {
  const given = one(row, cols, 'first name', 'given name')
  const family = one(row, cols, 'last name', 'family name')
  const middle = one(row, cols, 'middle name', 'additional name')
  const phones = unique(valueColumns(headers, 'phone').flatMap((h) => values(row, cols, h)))
  const emails = unique(valueColumns(headers, 'e-mail').flatMap((h) => values(row, cols, h)).map((e) => e.toLowerCase()))
  const org = one(row, cols, 'organization name', 'organization 1 - name')
  const name =
    [given, middle, family].filter(Boolean).join(' ') ||
    one(row, cols, 'name', 'nickname', 'file as') ||
    org ||
    emails[0] ||
    phones[0]
  if (!name) return null
  const birthday = one(row, cols, 'birthday')
  const c: ImportedContact = {
    source: ContactSource.GoogleCsv,
    file,
    sourceRef: `#${n}`,
    name,
    phones,
    emails,
    labels: unique(values(row, cols, 'labels', 'group membership').filter((l) => !l.startsWith('* '))),
  }
  if (given) c.given = given
  if (family) c.family = family
  if (org) c.org = org
  const title = one(row, cols, 'organization title', 'organization 1 - title')
  if (title) c.title = title
  if (birthday && BIRTHDAY.test(birthday)) c.birthday = birthday
  const note = one(row, cols, 'notes')
  if (note) c.note = note
  return c
}

export const parseGoogleCsv: Parser = (text, file) => {
  try {
    const [head, ...rows] = parseCsv(text)
    const headers = (head ?? []).map(norm)
    if (!hasFirstName(headers)) return { contacts: [], skipped: 0 }
    const cols = indexOf(headers)
    const contacts: ImportedContact[] = []
    let skipped = 0
    rows.forEach((row, i) => {
      const c = toContact(row, cols, headers, file, i + 1)
      if (c) contacts.push(c)
      else skipped++
    })
    return { contacts, skipped }
  } catch {
    return { contacts: [], skipped: 0 }
  }
}
