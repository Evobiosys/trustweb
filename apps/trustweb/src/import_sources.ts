// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The import paths: what we have verified end to end with real exports, and what is still coming. First-run offers only the verified ones. */
export interface ImportSource { id: string; label: string }

export const VERIFIED_SOURCES: readonly ImportSource[] = [{ id: 'whatsapp', label: 'WhatsApp' }]

export const COMING_SOURCES: readonly ImportSource[] = [
  { id: 'vcard', label: 'Phone contacts' },
  { id: 'google-csv', label: 'Google contacts' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'facebook-json', label: 'Facebook' },
]
