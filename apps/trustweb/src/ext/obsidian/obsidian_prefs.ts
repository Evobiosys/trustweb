// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: the opt-in for complete ingestion belongs to the device it was given on (like a consent), so it stays in localStorage and never syncs. */
import { HOSTS_KEY, INGEST_KEY, SUGGEST_KEY } from './obsidian_data'

export const ingestOptIn = (): boolean => { try { return localStorage.getItem(INGEST_KEY) === '1' } catch { return false } }
export function setIngestOptIn(on: boolean): void {
  try { if (on) localStorage.setItem(INGEST_KEY, '1'); else localStorage.removeItem(INGEST_KEY) } catch { /* not kept: it stays off */ }
}

/** Wave 42 (F05): "Let my AI look for more people": the same kind of consent, per device, off by default. */
export const suggestOptIn = (): boolean => { try { return localStorage.getItem(SUGGEST_KEY) === '1' } catch { return false } }
export function setSuggestOptIn(on: boolean): void {
  try { if (on) localStorage.setItem(SUGGEST_KEY, '1'); else localStorage.removeItem(SUGGEST_KEY) } catch { /* not kept: it stays off */ }
}

/** The hosts the owner confirmed as the place their notes may go (one confirmation per host; another host asks again). Unreadable storage = none confirmed. */
function hosts(): string[] {
  try { const v: unknown = JSON.parse(localStorage.getItem(HOSTS_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}
export const hostConfirmed = (host: string): boolean => hosts().includes(host.toLowerCase())
export function confirmHost(host: string): void {
  try { localStorage.setItem(HOSTS_KEY, JSON.stringify([...new Set([...hosts(), host.toLowerCase()])])) } catch { /* not kept: asked again next time */ }
}
