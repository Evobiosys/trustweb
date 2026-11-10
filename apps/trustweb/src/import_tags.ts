// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 (import-curate): the small pure rules under the Curate page, kept apart from services_import.ts so both can use them: tag ids from
 * labels, the system tag of one import, which names are junk (date-time or phone number), whether a row has chat history, and the
 * fingerprint that tells "the owner edited this person since the import". Pure: no DOM, no storage.
 */
import { EMAIL_FIELD } from './intending_reminder'
import type { Person, ServiceRow } from './model'
import { fingerprint } from './safe_text'

export const DEFAULT_IMPORT_NOTE = 'Only focused on people; phone numbers can still be added later (maybe no longer up to date)'

/** A system tag id starts with this; such tags are hidden unless the Tools toggle "show system tags" is on. */
export const SYSTEM_TAG_PREFIX = 'import:'
export const isSystemTagId = (id: string): boolean => id.startsWith(SYSTEM_TAG_PREFIX)

/** The id a label gets as a person tag (the same rule as tag_create.ts createTag, without the uniqueness suffix). */
export const tagSlug = (label: string): string => label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'tag'

const SOURCE_SLUG: Record<string, string> = { vcard: 'vcf', 'google-csv': 'google-csv', 'google-api': 'google', 'facebook-json': 'facebook', 'dex-csv': 'dex', 'generic-csv': 'csv', mcp: 'mcp' }

/** `import:<YYYY-MM-DD>-<source>`; several sources in one pass are joined with "+". */
export function importTagId(at: number, sources: readonly string[]): string {
  const names = [...new Set(sources.map((s) => SOURCE_SLUG[s] ?? s))]
  return `${SYSTEM_TAG_PREFIX}${new Date(at).toISOString().slice(0, 10)}-${names.join('+') || 'import'}`
}

/** The tags a row carries: its card's categories, trimmed, once each. */
export const rowTags = (r: Pick<ServiceRow, 'labels'>): string[] => [...new Set((r.labels ?? []).map((l) => l.trim()).filter(Boolean))]

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?'
const DATE_NAMES: readonly RegExp[] = [
  new RegExp(`^${MONTH}\\s+\\d{1,2},?\\s+\\d{4}`, 'i'),
  new RegExp(`^\\d{1,2}\\s+${MONTH}\\s+\\d{4}`, 'i'),
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/,
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/,
]
/** A name that is a date and time (Google makes such contacts from a call log). */
export const isDateName = (name: string): boolean => DATE_NAMES.some((re) => re.test(name.trim()))
/** A name that is only a phone number. */
export const isPhoneName = (name: string): boolean => /^\+?[\d\s().-]{5,}$/.test(name.trim())
/** Rows with no real name: grouped last under "Unnamed numbers". */
export const isUnnamed = (r: Pick<ServiceRow, 'name'>): boolean => !r.name.trim() || isDateName(r.name) || isPhoneName(r.name)

/** A chat export counts messages; a contacts file carries none, so its ring is only a default. */
export const hasHistory = (r: Pick<ServiceRow, 'n365' | 'out' | 'in'>): boolean => (r.n365 ?? 0) + (r.out ?? 0) + (r.in ?? 0) > 0

/** What the owner can change on a person after an import, as one fingerprint (name, ring, every field and tag, notes, connections). */
export const snapOf = (p: Person): string => fingerprint(JSON.stringify([
  p.name, p.ring, Object.entries(p.fields ?? {}).map(([k, v]) => [k, String(v)]).sort(), (p.lines ?? []).map((l) => l.id), p.generalNote ?? '', p.knows ?? [], p.affiliated ?? [],
]))

/** The first e-mail and the first phone number a person carries in their fields ("email", "phone"), for the one-line contact data of a list row. */
export function contactOf(p: Pick<Person, 'fields'>): { email: string; phone: string } {
  const f = p.fields ?? {}
  return { email: String(f[EMAIL_FIELD] ?? '').trim(), phone: String(f.phone ?? '').trim() }
}
