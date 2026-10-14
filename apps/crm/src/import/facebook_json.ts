import { ContactSource, type ImportedContact, type ParseResult, type Parser } from './types'

type Json = Record<string, unknown>

const decoder = new TextDecoder('utf-8', { fatal: true })

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The friends array of a friends list export, or undefined for any other JSON. */
function friendsOf(parsed: unknown): unknown[] | undefined {
  if (!isObject(parsed)) return undefined
  const list = Array.isArray(parsed.friends_v2) ? parsed.friends_v2 : parsed.friends
  return Array.isArray(list) ? list : undefined
}

export function isFacebookFriendsJson(parsed: unknown): boolean {
  return friendsOf(parsed) !== undefined
}

/** Facebook writes UTF-8 bytes as \u00XX code points; undo that when it is unambiguous. */
function repairMojibake(s: string): string {
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 255) return s
    bytes[i] = c
  }
  try {
    return decoder.decode(bytes)
  } catch {
    return s
  }
}

function since(ts: unknown): number | undefined {
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? Math.round(ts * 1000) : undefined
}

function emailOf(rec: Json): string[] {
  const e = typeof rec.email === 'string' ? rec.email : rec.contact_info
  const mail = typeof e === 'string' ? e.trim().toLowerCase() : ''
  return mail.includes('@') ? [mail] : []
}

function toContact(rec: unknown, n: number, file: string): ImportedContact | undefined {
  if (!isObject(rec) || typeof rec.name !== 'string') return undefined
  const name = repairMojibake(rec.name).trim()
  if (!name) return undefined
  const contact: ImportedContact = {
    source: ContactSource.FacebookJson,
    file,
    sourceRef: `#${n}`,
    name,
    phones: [],
    emails: emailOf(rec),
    labels: [],
  }
  const ms = since(rec.timestamp)
  if (ms !== undefined) contact.since = ms
  return contact
}

export const parseFacebookJson: Parser = (text, file): ParseResult => {
  let list: unknown[] | undefined
  try {
    list = friendsOf(JSON.parse(text))
  } catch {
    list = undefined
  }
  const contacts: ImportedContact[] = []
  let skipped = 0
  list?.forEach((rec, i) => {
    const c = toContact(rec, i + 1, file)
    if (c) contacts.push(c)
    else skipped++
  })
  return { contacts, skipped }
}
