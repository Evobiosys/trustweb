// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-geb): the app side of the Geb bridge (scripts/geb-bridge). Pure: no DOM. The bridge's JSON is read defensively; its exact Geb output shapes are not verified. */
import { consensualDid } from '../../channel'
import { Channel, type Person } from '../../model'
import type { ThreadSummary } from '../registry'

/** Port and token live in this device's localStorage only, never in the synced record. */
export const PAIR_KEY = 'tw.geb.bridge'
export interface Pairing { port: number; token: string }
interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const HASH = /^#geb-bridge=(\d{1,5})\.([A-Za-z0-9_-]{20,64})$/

export function parsePairingHash(hash: string): Pairing | null {
  const m = HASH.exec(hash)
  const port = m ? Number(m[1]) : 0
  return m && port >= 1024 && port <= 65535 ? { port, token: m[2] } : null
}

export function loadPairing(s: Store): Pairing | null {
  try {
    const v = JSON.parse(s.getItem(PAIR_KEY) ?? 'null') as Partial<Pairing> | null
    return v && Number.isInteger(v.port) && typeof v.token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(v.token) ? { port: v.port as number, token: v.token } : null
  } catch {
    return null
  }
}

export function savePairing(s: Store, p: Pairing): void {
  s.setItem(PAIR_KEY, JSON.stringify(p))
}

export function clearPairing(s: Store): void {
  s.removeItem(PAIR_KEY)
}

/** Reads the pairing link's fragment once: stores it and has the address bar rewritten without it. False when the hash is not ours. */
export function consumePairingHash(loc: { hash: string; pathname: string; search: string }, s: Store, replaceUrl: (url: string) => void): boolean {
  const p = parsePairingHash(loc.hash)
  if (!p) return false
  savePairing(s, p)
  replaceUrl(loc.pathname + loc.search)
  return true
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** One call to the loopback bridge. Rejects when it is not running, refuses, or errs. */
export async function bridgeCall(p: Pairing, path: string, body?: unknown, fetchFn: FetchLike = fetch as FetchLike): Promise<Record<string, unknown>> {
  const init: RequestInit & { headers: Record<string, string> } = { credentials: 'omit', headers: { authorization: 'Bearer ' + p.token } }
  if (body !== undefined) {
    init.method = 'POST'
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const r = await fetchFn(`http://127.0.0.1:${p.port}${path}`, init)
  if (!r.ok) throw new Error('bridge ' + r.status)
  return (await r.json()) as Record<string, unknown>
}

/** The person whose stored Geb address holds this DID. */
export function personForDid(people: readonly Person[], did: string): Person | undefined {
  return people.find((p) => {
    const v = p.channels?.[Channel.Consensual]
    return v !== undefined && consensualDid(v) === did
  })
}

export function toThreadSummaries(raw: unknown, people: readonly Person[]): ThreadSummary[] {
  if (!Array.isArray(raw)) return []
  const out: ThreadSummary[] = []
  for (const t of raw as Record<string, unknown>[]) {
    if (!t || typeof t.did !== 'string') continue
    const p = personForDid(people, t.did)
    out.push({
      id: t.did,
      title: p?.name ?? (typeof t.title === 'string' && t.title ? t.title : t.did.slice(0, 12)),
      lastAt: typeof t.lastAt === 'number' ? t.lastAt : 0,
      unread: typeof t.unread === 'number' ? t.unread : 0,
      ...(p ? { peerId: p.id } : {}),
    })
  }
  return out
}
