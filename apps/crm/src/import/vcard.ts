/**
 * vCard (2.1, 3.0, 4.0) parser: phone exports, Google Takeout "All Contacts.vcf", iCloud.
 * Pure text in, ImportedContact[] out. A malformed card counts as skipped, never throws.
 */
import { ContactSource, type ImportedContact, type ParseResult, type Parser } from './types'

interface Prop {
  name: string
  params: string[]
  value: string
}

const QP_PARAM = /(^|;)(ENCODING=)?QUOTED-PRINTABLE(;|:)/i
const BEGIN = /^BEGIN:VCARD$/i
const END = /^END:VCARD$/i

/** Undo line folding (newline + space/tab) and quoted-printable soft breaks (trailing "="). */
function unfold(text: string): string[] {
  const out: string[] = []
  let softBreak = false
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (out.length > 0 && (softBreak || /^[ \t]/.test(line))) {
      out[out.length - 1] += softBreak ? line : line.slice(1)
    } else {
      out.push(line)
    }
    const last = out[out.length - 1]
    softBreak = QP_PARAM.test(last) && last.endsWith('=')
    if (softBreak) out[out.length - 1] = last.slice(0, -1)
  }
  return out
}

function decodeQuotedPrintable(value: string, charset: string): string {
  const enc = new TextEncoder()
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    const hex = value.slice(i + 1, i + 3)
    if (value[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else {
      bytes.push(...enc.encode(value[i]))
    }
  }
  const raw = Uint8Array.from(bytes)
  try {
    return new TextDecoder(charset).decode(raw)
  } catch {
    return new TextDecoder().decode(raw)
  }
}

function parseProp(line: string): Prop | null {
  const colon = line.indexOf(':')
  if (colon < 1) return null
  const [head, ...params] = line.slice(0, colon).split(';')
  const name = head.slice(head.lastIndexOf('.') + 1).toUpperCase()
  let value = line.slice(colon + 1)
  if (!['FN', 'N', 'TEL', 'EMAIL', 'ORG', 'TITLE', 'BDAY', 'NOTE', 'CATEGORIES', 'UID'].includes(name)) {
    return null
  }
  if (QP_PARAM.test(`${params.join(';')};`)) {
    const charset = params.find((p) => /^CHARSET=/i.test(p))?.slice(8) ?? 'utf-8'
    value = decodeQuotedPrintable(value, charset)
  }
  return { name, params, value }
}

const unescape = (s: string): string => s.replace(/\\([\s\S])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

/** Split on an unescaped separator, then unescape each part and trim it. */
function split(value: string, sep: ';' | ','): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') cur += value[i] + (value[++i] ?? '')
    else if (value[i] === sep) {
      parts.push(cur)
      cur = ''
    } else cur += value[i]
  }
  parts.push(cur)
  return parts.map((p) => unescape(p).trim())
}

function birthday(value: string): string | undefined {
  const v = value.trim()
  const full = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(v)
  const noYear = /^--(\d{2})-?(\d{2})$/.exec(v)
  const [year, month, day] = full ? full.slice(1) : noYear ? ['', ...noYear.slice(1)] : ['', '0', '0']
  if (+month < 1 || +month > 12 || +day < 1 || +day > 31) return undefined
  return year ? `${year}-${month}-${day}` : `--${month}-${day}`
}

const addUnique = (list: string[], v: string): void => {
  if (v && !list.includes(v)) list.push(v)
}

function toContact(props: Prop[], file: string, n: number): ImportedContact | null {
  const phones: string[] = []
  const emails: string[] = []
  const labels: string[] = []
  const first: Partial<Record<'FN' | 'N' | 'ORG' | 'TITLE' | 'BDAY' | 'NOTE' | 'UID', string>> = {}
  for (const { name, value } of props) {
    if (name === 'TEL') addUnique(phones, unescape(value).replace(/^tel:/i, '').trim())
    else if (name === 'EMAIL') addUnique(emails, unescape(value).replace(/^mailto:/i, '').trim().toLowerCase())
    else if (name === 'CATEGORIES') split(value, ',').forEach((l) => !l.startsWith('* ') && addUnique(labels, l))
    else if (name === 'ORG') first.ORG ??= split(value, ';')[0]
    else if (!(name in first)) first[name as keyof typeof first] = value
  }
  const [family = '', given = ''] = split(first.N ?? '', ';')
  const org = first.ORG || undefined
  const name =
    unescape(first.FN ?? '').trim() || [given, family].filter(Boolean).join(' ') || org || emails[0] || phones[0]
  if (!name) return null
  const bday = first.BDAY === undefined ? undefined : birthday(first.BDAY)
  const contact: ImportedContact = {
    source: ContactSource.VCard,
    file,
    sourceRef: unescape(first.UID ?? '').trim() || `#${n}`,
    name,
    phones,
    emails,
    labels,
  }
  if (given) contact.given = given
  if (family) contact.family = family
  if (org) contact.org = org
  const title = unescape(first.TITLE ?? '').trim()
  if (title) contact.title = title
  if (bday) contact.birthday = bday
  const note = unescape(first.NOTE ?? '').trim()
  if (note) contact.note = note
  return contact
}

export const parseVCard: Parser = (text, file) => {
  const result: ParseResult = { contacts: [], skipped: 0 }
  let props: Prop[] | null = null
  let n = 0
  for (const line of unfold(text)) {
    const t = line.trim()
    if (BEGIN.test(t)) {
      if (props) result.skipped++ // previous card never ended
      props = []
      n++
    } else if (END.test(t)) {
      const contact = props && toContact(props, file, n)
      if (contact) result.contacts.push(contact)
      else if (props) result.skipped++
      props = null
    } else if (props) {
      const prop = parseProp(line)
      if (prop) props.push(prop)
    }
  }
  if (props) result.skipped++ // last card never ended
  return result
}
