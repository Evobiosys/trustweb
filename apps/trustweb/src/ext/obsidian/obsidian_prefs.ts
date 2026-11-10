// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: the opt-in for complete ingestion belongs to the device it was given on (like a consent), so it stays in localStorage and never syncs. */
const KEY = 'trustweb.v1.obsidian.ingest'

export const ingestOptIn = (): boolean => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export function setIngestOptIn(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* not kept: it stays off */ }
}
