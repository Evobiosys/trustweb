/** Which export a file is, by its content and never its name (wave 7). Pure; never throws. */
import { isFacebookFriendsJson, parseFacebookJson } from './facebook_json'
import { isDexCsv, isGenericContactCsv, parseGenericCsv } from './generic_csv'
import { isGoogleCsvHeader, parseGoogleCsv } from './google_csv'
import { isLinkedInCsv, parseLinkedInCsv } from './linkedin_csv'
import type { CsvMapping } from './generic_csv'
import { ContactSource } from './types'
import type { ParseResult, Parser } from './types'
import { parseVCard } from './vcard'

// WhatsApp is not here: a chat needs the owner's own name, so whatsapp.ts reads it directly.
const PARSERS: Partial<Record<ContactSource, Parser>> = {
  [ContactSource.DexCsv]: (text, file) => parseGenericCsv(text, file, undefined, ContactSource.DexCsv),
  [ContactSource.GenericCsv]: (text, file) => parseGenericCsv(text, file),
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
  const line = head.split(/\r?\n/, 1)[0]
  if (isDexCsv(line)) return ContactSource.DexCsv
  if (isGoogleCsvHeader(line)) return ContactSource.GoogleCsv
  return isGenericContactCsv(line) ? ContactSource.GenericCsv : null
}

export interface ParsedFile {
  format: ContactSource | null
  result: ParseResult
}

/** `mapping`: the owner's fixed column mapping for a generic CSV (wave 33). */
export function parseFile(name: string, text: string, mapping?: CsvMapping): ParsedFile {
  const format = detectFormat(name, text)
  if (format === ContactSource.GenericCsv && mapping) return { format, result: parseGenericCsv(text, name, mapping) }
  return { format, result: format && PARSERS[format] ? PARSERS[format](text, name) : { contacts: [], skipped: 0 } }
}
