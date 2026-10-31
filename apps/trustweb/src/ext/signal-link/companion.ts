// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Signal / Molly import (wave 27): the pairing hash and the client for the laptop companion (scripts/signal-link). Loopback only; no DOM. */

export const PAIR_KEY = 'trustweb.signal-link'

export interface Pairing { port: number; token: string }

/** `#signal-link=<port>.<token>` (token: base64url). */
export function parsePairing(hash: string): Pairing | null {
  const m = /^#signal-link=(\d{2,5})\.([A-Za-z0-9_-]{16,64})$/.exec(hash)
  const port = m ? Number(m[1]) : 0
  return m && port > 0 && port < 65536 ? { port, token: m[2] } : null
}

/** Reads the hash once: port and token go to localStorage only, then `replace('')` removes the hash from the address bar. */
export function consumePairing(hash: string, store: Pick<Storage, 'setItem'>, replace: (url: string) => void): boolean {
  const p = parsePairing(hash)
  if (!p) return false
  try { store.setItem(PAIR_KEY, JSON.stringify(p)) } catch { return false }
  replace('')
  return true
}

export function loadPairing(store: Pick<Storage, 'getItem'>): Pairing | null {
  try {
    const v = JSON.parse(store.getItem(PAIR_KEY) ?? 'null') as Partial<Pairing> | null
    return v && typeof v.port === 'number' && typeof v.token === 'string' ? { port: v.port, token: v.token } : null
  } catch { return null }
}

export interface CompanionStatus { link: 'idle' | 'waiting' | 'linked' | 'failed'; error?: string; account: boolean; receiving: boolean; messages: number }
/** Counts and timestamps are what the record keeps; `words` is shown on this device only and never stored. */
export interface CompanionConv { e164: string; name: string; n365: number; out: number; in: number; firstTs: number; lastTs: number; words: [string, number][] }

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

export function createClient(p: Pairing, fetchFn: Fetch = (u, i) => fetch(u, i)) {
  const base = `http://127.0.0.1:${p.port}`
  const call = async <T>(path: string, method = 'GET'): Promise<T | null> => {
    try {
      const r = await fetchFn(base + path, { method, headers: { authorization: 'Bearer ' + p.token } })
      return r.ok ? ((await r.json()) as T) : null
    } catch { return null }
  }
  return {
    status: () => call<CompanionStatus>('/status'),
    link: () => call<{ uri: string }>('/link', 'POST'),
    import: () => call<{ conversations: CompanionConv[] }>('/import'),
  }
}
export type CompanionClient = ReturnType<typeof createClient>
