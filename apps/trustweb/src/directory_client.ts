// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c social-hosting: the app's side of the name directory on the Swiss server (services/trustweb-backup/directory.mjs):
 * publish a signed name record, find one by first+last name, withdraw, leave an "intend to connect", pull the ones left for me.
 * Fetch, clock and verifier are injected, nothing here throws (a server that cannot be reached answers "no"/empty), and nothing
 * calls it while trusted-only is on (the caller asks serversAllowed first, trust_mode.ts). No DOM, no model.ts runtime imports.
 */
import { newest, normName, verifyIntent } from './name_record'
import type { Intent, NameRecord, Signer, Verifier } from './name_record'

/** The "no list" entry: this app's own origin, the Swiss server on questhub. */
export const DEFAULT_SERVER = ''

export interface DirDeps {
  fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json: () => Promise<unknown> }>
  origins: string[]
  now: () => number
  verify: Verifier
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/

/** The servers a person chose (Advanced), cleaned: https only (http for loopback), no trailing slash, no duplicates; none chosen = the default origin. */
export function serversOf(s: { directoryServers?: string[] }, ownOrigin: string): string[] {
  const clean = [...new Set((s.directoryServers ?? []).map((u) => String(u).trim().replace(/\/+$/, '')).filter((u) => /^https:\/\/[^/\s]+$/.test(u) || LOOPBACK.test(u)))]
  return clean.length ? clean : [ownOrigin]
}

const JSON_H = { 'Content-Type': 'application/json' }
async function ask(d: DirDeps, origin: string, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; json: unknown } | null> {
  try {
    const body = init?.body === undefined ? undefined : JSON.stringify(init.body)
    const res = await d.fetch(`${origin}${path}`, { method: init?.method ?? 'GET', ...(body === undefined ? {} : { headers: { ...JSON_H, 'Content-Length': String(new TextEncoder().encode(body).length) }, body }) })
    let json: unknown = null
    try { json = res.status === 204 ? null : await res.json() } catch { json = null }
    return { status: res.status, json }
  } catch {
    return null
  }
}

/** True when at least one server took the call (204). */
async function everywhere(d: DirDeps, path: string, method: string, body: unknown): Promise<boolean> {
  const answers = await Promise.all(d.origins.map((o) => ask(d, o, path, { method, body })))
  return answers.some((a) => a?.status === 204)
}

export const putRecord = (d: DirDeps, rec: NameRecord): Promise<boolean> => everywhere(d, '/directory', 'PUT', { rec })

const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)

export function deleteRecord(d: DirDeps, key: string, sign: Signer): Promise<boolean> {
  const ts = d.now()
  return everywhere(d, '/directory', 'DELETE', { key, ts, sig: sign(bytesOf(`tw-del-v1\n${key}\n${ts}`)) })
}

export const sendIntent = (d: DirDeps, intent: Intent): Promise<boolean> => everywhere(d, '/directory/intent', 'POST', { intent })

/** Valid records for this exact name from every server, the newest per key. */
export async function searchName(d: DirDeps, first: string, last: string): Promise<NameRecord[]> {
  const name = normName(first, last)
  if (!first.trim() || !last.trim()) return []
  const answers = await Promise.all(d.origins.map((o) => ask(d, o, `/directory?q=${encodeURIComponent(name)}`)))
  const all = answers.flatMap((a) => (a?.status === 200 && Array.isArray((a.json as { records?: unknown })?.records) ? (a.json as { records: unknown[] }).records : []))
  const keys = [...new Set(all.map((r) => (r as { key?: unknown })?.key).filter((k): k is string => typeof k === 'string'))]
  return keys.flatMap((k) => newest(all.filter((r) => (r as { key?: unknown })?.key === k), d.verify) ?? []).filter((r) => normName(r.first, r.last) === name)
}

/** The "intend to connect" notices left for my key, valid and addressed to me; the server clears them as it hands them over. */
export async function pullIntents(d: DirDeps, me: string, sign: Signer): Promise<Intent[]> {
  const ts = d.now()
  const body = { key: me, ts, sig: sign(bytesOf(`tw-pull-v1\n${me}\n${ts}`)) }
  const answers = await Promise.all(d.origins.map((o) => ask(d, o, '/directory/intents', { method: 'POST', body })))
  const all = answers.flatMap((a) => (a?.status === 200 && Array.isArray((a.json as { intents?: unknown })?.intents) ? (a.json as { intents: unknown[] }).intents : []))
  return all.filter((i): i is Intent => verifyIntent(i, d.verify) && i.to === me)
}
