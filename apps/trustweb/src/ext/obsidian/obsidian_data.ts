// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: the module's slice of the record (`AppState.extData.obsidian`) and the deep link back into Obsidian. Small on purpose:
 * this file is in the main bundle (the stub registers the merge, the person card builds the link), everything else loads only when the module is on.
 * Only the vault's NAME rides the device sync; the parsed notes and the folder access stay on the device they were read on.
 */
export const MODULE_ID = 'obsidian'

/** localStorage keys of this module (opt-in for complete ingestion, hosts the owner confirmed): per device, cleared by Reset this phone. */
export const INGEST_KEY = 'trustweb.v1.obsidian.ingest'
export const HOSTS_KEY = 'trustweb.v1.obsidian.hosts'
export const SUGGEST_KEY = 'trustweb.v1.obsidian.suggest'
export const PREF_KEYS = [INGEST_KEY, HOSTS_KEY, SUGGEST_KEY] as const

/** One database per record on this device (obsidian_cache.ts). */
export const obsidianDbName = (meId: string): string => `trustweb-obsidian.${meId}`

/** `forgotAt`: the tombstone of "Forget this vault", so the other device's vault name does not come back on the next sync. */
export interface SuggestionData { path: string; name: string; confidence: number; why: string }
/** Wave 42: `suggestions` = people the owner's AI proposed that wait for a tick (at most SUGGESTIONS_KEPT); `suggestedAt` decides which device's list wins. */
export interface ObsidianData { vault?: string; syncedAt?: number; forgotAt?: number; suggestions?: SuggestionData[]; suggestedAt?: number }
export const SUGGESTIONS_KEPT = 200

function parseSuggestions(raw: unknown): SuggestionData[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.flatMap((x): SuggestionData[] => {
    const o = x as Record<string, unknown> | null
    return o && typeof o.path === 'string' && typeof o.name === 'string' && typeof o.confidence === 'number' && typeof o.why === 'string'
      ? [{ path: o.path, name: o.name, confidence: o.confidence, why: o.why }] : []
  }).slice(0, SUGGESTIONS_KEPT)
}

export function parseObsidian(raw: unknown): ObsidianData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  return {
    ...(typeof o.vault === 'string' && o.vault ? { vault: o.vault } : {}),
    ...(typeof o.syncedAt === 'number' ? { syncedAt: o.syncedAt } : {}),
    ...(typeof o.forgotAt === 'number' ? { forgotAt: o.forgotAt } : {}),
    ...(parseSuggestions(o.suggestions) ? { suggestions: parseSuggestions(o.suggestions) } : {}),
    ...(typeof o.suggestedAt === 'number' ? { suggestedAt: o.suggestedAt } : {}),
  }
}

/** The side with the later sync decides the vault's name (a tie: the larger name, the same on both devices); a sync older than a Forget does not bring the vault back. */
export function mergeObsidian(mine: unknown, theirs: unknown): ObsidianData {
  const a = parseObsidian(mine)
  const b = parseObsidian(theirs)
  const at = a.syncedAt ?? 0
  const bt = b.syncedAt ?? 0
  const newer = bt > at ? b : bt < at ? a : (b.vault ?? '') > (a.vault ?? '') ? b : a
  const vault = newer.vault ?? a.vault ?? b.vault
  const syncedAt = Math.max(at, bt)
  const forgotAt = Math.max(a.forgotAt ?? 0, b.forgotAt ?? 0)
  if (forgotAt && syncedAt <= forgotAt) return { forgotAt }
  // The suggestions follow their own clock; a tie takes the list that sorts larger as JSON (the same on both devices).
  const sa = a.suggestedAt ?? 0
  const sb = b.suggestedAt ?? 0
  const key = (d: ObsidianData): string => JSON.stringify(d.suggestions ?? [])
  const pick = sb > sa ? b : sb < sa ? a : key(b) > key(a) ? b : a
  const suggestedAt = Math.max(sa, sb)
  return {
    ...(vault ? { vault } : {}), ...(syncedAt ? { syncedAt } : {}), ...(forgotAt ? { forgotAt } : {}),
    ...(pick.suggestions ? { suggestions: pick.suggestions } : {}), ...(suggestedAt ? { suggestedAt } : {}),
  }
}

/** Reset this phone: the record's database and the module's preference keys go. Settles whatever IndexedDB does (blocked, silent). */
export function clearObsidianData(
  meId: string,
  idb: Pick<IDBFactory, 'deleteDatabase'> | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
  storage: Pick<Storage, 'removeItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
  timeoutMs = 3_000,
): Promise<void> {
  for (const k of PREF_KEYS) { try { storage?.removeItem(k) } catch { /* not kept anyway */ } }
  if (!idb) return Promise.resolve()
  const work = new Promise<void>((resolve) => {
    const r = idb.deleteDatabase(obsidianDbName(meId))
    r.onsuccess = r.onerror = r.onblocked = (): void => resolve()
  })
  return Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
}

/** obsidian://open?vault=<name>&file=<note path without .md>; null when either is missing. */
export function deepLink(vault: string, notePath: string): string | null {
  if (!vault || !notePath) return null
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(notePath.replace(/\.md$/i, ''))}`
}
