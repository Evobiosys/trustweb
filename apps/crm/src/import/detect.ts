/** Which export a file is, by its content and never its name (wave 7). Pure; never throws. */
import { isFacebookFriendsJson, parseFacebookJson } from './facebook_json'
import { isGoogleCsvHeader, parseGoogleCsv } from './google_csv'
import { isLinkedInCsv, parseLinkedInCsv } from './linkedin_csv'
import { ContactSource } from './types'
import type { ParseResult, Parser } from './types'
import { parseVCard } from './vcard'

// WhatsApp is not here: a chat needs the owner's own name, so whatsapp.ts reads it directly.
const PARSERS: Partial<Record<ContactSource, Parser>> = {
  [ContactSource.VCard]: parseVCard,
  [ContactSource.GoogleCsv]: parseGoogleCsv,
  [ContactSource.FacebookJson]: parseFacebookJson,
  [ContactSource.LinkedIn]: parseLinkedInCsv,
}

function isFacebookText(text: string): boolean {
  try { return isFacebookFriendsJson(JSON.parse(text)) } catch { return false }
}

export function detectFormat(_name: string, text: string): ContactSource | null {
  const head = text.replace(/^\uFEFF/, '').trimStart()
  if (/^BEGIN:VCARD/i.test(head)) return ContactSource.VCard
  if (head.startsWith('{') && isFacebookText(head)) return ContactSource.FacebookJson
  if (isLinkedInCsv(head)) return ContactSource.LinkedIn
  return isGoogleCsvHeader(head.split(/\r?\n/, 1)[0]) ? ContactSource.GoogleCsv : null
}

export interface ParsedFile {
  format: ContactSource | null
  result: ParseResult
}

export function parseFile(name: string, text: string): ParsedFile {
  const format = detectFormat(name, text)
  return { format, result: format && PARSERS[format] ? PARSERS[format](text, name) : { contacts: [], skipped: 0 } }
}
