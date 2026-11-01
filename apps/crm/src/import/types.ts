/**
 * The contract every contacts importer and the de-duplication share (wave 7).
 *
 * Each parser (vcard.ts, google_csv.ts, facebook_json.ts) turns one file's text
 * into ImportedContact[]; dedup.ts groups them; the intake screen stores the
 * result in the CRM's own key. Pure data: no DOM, no network, no storage here.
 * Everything in it stays on this device (I1): imported contacts are never part
 * of TrustWeb's record, so the matcher never sees them.
 */

export enum ContactSource {
  VCard = 'vcard',
  GoogleCsv = 'google-csv',
  FacebookJson = 'facebook-json',
  /** Chat export (_chat.txt): read by whatsapp.ts with the owner's own name; never by the contact-file picker. */
  WhatsApp = 'whatsapp',
  /** LinkedIn Connections.csv (a data export, re-imported when a newer one is dropped). */
  LinkedIn = 'linkedin',
}

export interface ImportedContact {
  source: ContactSource
  /** File name only (no folder path). */
  file: string
  /** Stable within its file: the vCard UID, else the record's position ("#12"). */
  sourceRef: string
  /** Display name, never empty (a record without any name, email or phone is skipped). */
  name: string
  given?: string
  family?: string
  /** As written in the file, trimmed, no duplicates. */
  phones: string[]
  /** Trimmed and lower-cased, no duplicates. */
  emails: string[]
  org?: string
  title?: string
  /** YYYY-MM-DD, or --MM-DD when the year is unknown. */
  birthday?: string
  note?: string
  /** Google labels / vCard CATEGORIES, without Google's system labels ("* myContacts"). */
  labels: string[]
  /** Facebook: friends since, ms since epoch. */
  since?: number
}

export interface ParseResult {
  contacts: ImportedContact[]
  /** Records in the file that could not become a contact (no name, email or phone; malformed). */
  skipped: number
}

/** `file` is the file name only; `text` the whole file as UTF-8 text. Never throws. */
export type Parser = (text: string, file: string) => ParseResult
