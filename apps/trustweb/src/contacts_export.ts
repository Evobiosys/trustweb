// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 33: my people as a contacts file (vCard 3.0, CSV, JSON) for another address book. Pure, no DOM.
 * Only name, emails, phones, organisation, title, birthday, note, labels, ring, last contact and the channel
 * handles leave; never ids, keys, sources, agreements, theirChannels or the only-me note (model.ts).
 */
import { EMAIL_FIELD } from './intending_reminder'
import type { Person, Ring } from './model'

export interface ExportOpts {
  now: number
  ringLabel: (r: Ring) => string
  lastContact: (p: Person) => number | undefined
}

interface Row {
  name: string
  given?: string
  family?: string
  emails: string[]
  phones: string[]
  org?: string
  title?: string
  birthday?: string
  note?: string
  labels: string[]
  ring: string
  lastContact?: string
  channels: Record<string, string>
}

const E164 = /^\+\d{6,15}$/
const MULTI = ' ::: '

const uniq = (xs: string[]): string[] => [...new Set(xs)]
const field = (p: Person, key: string): string | undefined => p.fields?.[key]?.trim() || undefined
const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

function emailsOf(p: Person): string[] {
  const extra = Object.keys(p.fields ?? {})
    .map((k) => /^email (\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => field(p, m[0]))
  return uniq([field(p, EMAIL_FIELD), ...extra].filter((e): e is string => !!e))
}

const phoneKey = (v: string): string => v.replace(/[^\d+]/g, '')
/** Phones typed or imported (fields 'phone', 'phone 2', ...) first, then the E.164 numbers of the channels; one entry per number. */
function phonesOf(p: Person, channels: Record<string, string>): string[] {
  const typed = Object.keys(p.fields ?? {})
    .map((k) => /^phone(?: (\d+))?$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1] ?? 1) - Number(b[1] ?? 1))
    .map((m) => field(p, m[0]))
  const seen = new Set<string>()
  return [...typed, ...Object.values(channels).filter((v) => E164.test(v))].filter((v): v is string => {
    if (!v || seen.has(phoneKey(v))) return false
    seen.add(phoneKey(v))
    return true
  })
}

function toRow(p: Person, o: ExportOpts): Row {
  const channels: Record<string, string> = {}
  for (const [k, v] of Object.entries(p.channels ?? {})) if (v) channels[k] = v
  const words = p.name.trim().split(/\s+/)
  const row: Row = {
    name: p.name,
    emails: emailsOf(p),
    phones: phonesOf(p, channels),
    labels: (field(p, 'labels') ?? '').split(', ').filter(Boolean),
    ring: o.ringLabel(p.ring),
    channels,
  }
  if (words.length > 1) row.family = words.pop()
  row.given = words.join(' ')
  const optional = { org: field(p, 'organization'), title: field(p, 'job title'), birthday: field(p, 'birthday'), note: field(p, 'note') }
  for (const [k, v] of Object.entries(optional)) if (v) (row as unknown as Record<string, string>)[k] = v
  const last = o.lastContact(p)
  if (last !== undefined) row.lastContact = isoDate(last)
  return row
}

// --- vCard 3.0 (RFC 2426 / 6350 escaping) ---

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')

/** Fold at 75 octets (RFC 2426 3.2); a continuation line starts with one space and never splits a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (size + n > 75) { out.push(cur); cur = ' '; size = 1 }
    cur += ch
    size += n
  }
  out.push(cur)
  return out.join('\r\n')
}

export function toVCard(people: readonly Person[], o: ExportOpts): string {
  return people.map((p) => {
    const r = toRow(p, o)
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(r.name)}`, `N:${esc(r.family ?? '')};${esc(r.given ?? '')};;;`]
    for (const e of r.emails) lines.push(`EMAIL;TYPE=INTERNET:${esc(e)}`)
    for (const t of r.phones) lines.push(`TEL:${esc(t)}`)
    if (r.org) lines.push(`ORG:${esc(r.org)}`)
    if (r.title) lines.push(`TITLE:${esc(r.title)}`)
    if (r.birthday) lines.push(`BDAY:${esc(r.birthday)}`)
    if (r.note) lines.push(`NOTE:${esc(r.note)}`)
    lines.push(`CATEGORIES:${[r.ring, ...r.labels].map(esc).join(',')}`, 'END:VCARD')
    return lines.map(fold).join('\r\n') + '\r\n'
  }).join('')
}

// --- CSV (RFC 4180) ---

const HEADERS = ['full_name', 'first_name', 'last_name', 'email', 'emails', 'phone', 'phones', 'company', 'job_title', 'birthday', 'notes', 'labels', 'ring', 'last_contact', 'channels']
const PHONE_COLUMNS = new Set(['phone', 'phones'])

/** CSV formula injection: a cell a spreadsheet would read as a formula gets a leading apostrophe; phone numbers keep their +. */
function cell(v: string, column: string): string {
  const safe = /^[=+\-@]/.test(v) && !(PHONE_COLUMNS.has(column) && v.startsWith('+')) ? `'${v}` : v
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(people: readonly Person[], o: ExportOpts): string {
  const lines = people.map((p) => {
    const r = toRow(p, o)
    const values = [
      r.name, r.given ?? '', r.family ?? '', r.emails[0] ?? '', r.emails.join(MULTI), r.phones[0] ?? '', r.phones.join(MULTI),
      r.org ?? '', r.title ?? '', r.birthday ?? '', r.note ?? '', r.labels.join(MULTI), r.ring, r.lastContact ?? '',
      Object.entries(r.channels).map(([k, v]) => `${k}=${v}`).join(';'),
    ]
    return values.map((v, i) => cell(v, HEADERS[i])).join(',')
  })
  return '\ufeff' + [HEADERS.join(','), ...lines].join('\r\n') + '\r\n'
}

// --- JSON (the neutral ImportedContact-like shape) ---

export function toJson(people: readonly Person[], o: ExportOpts): string {
  return JSON.stringify({ version: 1, exportedAt: new Date(o.now).toISOString(), people: people.map((p) => toRow(p, o)) })
}
