// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { DEFAULT_BASE_URL, normalizeBaseUrl } from './compose_link'
import { NETWORKS, type Network } from './selectors'

export interface Settings {
  baseUrl: string
  sites: Record<Network, boolean>
  /** Hostnames the user chose "Never on this site" for. */
  never: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: DEFAULT_BASE_URL,
  sites: { mastodon: true, x: true, facebook: true, linkedin: true },
  never: [],
}

/** Stored (untrusted) value -> complete, valid Settings. */
export function mergeSettings(stored: unknown): Settings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const sites = { ...DEFAULT_SETTINGS.sites }
  if (s.sites && typeof s.sites === 'object') {
    for (const k of Object.keys(sites) as Network[]) {
      const v = (s.sites as Record<string, unknown>)[k]
      if (typeof v === 'boolean') sites[k] = v
    }
  }
  const base = typeof s.baseUrl === 'string' ? normalizeBaseUrl(s.baseUrl) : null
  const never = Array.isArray(s.never) ? s.never.filter((h): h is string => typeof h === 'string') : []
  return { baseUrl: base ?? DEFAULT_SETTINGS.baseUrl, sites, never }
}

export function shouldAsk(settings: Settings, network: Network, host: string): boolean {
  return settings.sites[network] && !settings.never.includes(host)
}

export const SETTINGS_KEY = 'settings'

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Review wave 40: the host of a Mastodon instance the person adds in the options: a plain host name (labels of letters, digits, inner hyphens),
 * not one of the built-in sites (their content script runs already) and not one added before. Null = refuse.
 */
export function instanceHost(raw: string, added: readonly string[]): string | null {
  const h = raw.trim().toLowerCase()
  const labels = h.split('.')
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,}$/.test(labels[labels.length - 1] ?? '')) return null
  const builtIn = Object.values(NETWORKS).flatMap((n) => n.hosts)
  return builtIn.includes(h) || added.includes(h) ? null : h
}
