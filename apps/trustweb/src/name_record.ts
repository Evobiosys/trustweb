// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c social-hosting: the signed name record that friends and the directory server carry, and the signed "intend to connect" notice.
 *   record = {v:1, first, last, key(did), ts, open, srv, hosts[], sig}; sig covers name, key, ts, open, srv. hosts[] is advisory (hosts add and
 *   remove themselves), so it is NOT signed: a forged hosts[] can only send a lookup to someone who then cannot show a valid record.
 * Pure: no imports at all (apps/mcp runs this under plain node). Signing and verifying are injected (the app passes did.ts, the MCP and the
 * server a node:crypto one), so every runtime checks the exact same bytes. Wire format documented in DEVLOG/wave43/social-hosting_DESIGN.txt.
 */
/** Wave 44b profile-page: the optional profile fields the owner marked discoverable (profile.ts directoryExtra). Signed; absent = the older bytes. */
export type Extra = Record<string, string>
export interface NameRecord { v: 1; first: string; last: string; key: string; ts: number; open: boolean; srv: boolean; hosts: string[]; sig: string; extra?: Extra }
export interface Intent { to: string; from: { first: string; last: string; key: string }; ts: number; sig: string }
export type Signer = (bytes: Uint8Array) => string
export type Verifier = (did: string, bytes: Uint8Array, sig: string) => boolean

export const MAX_NAME = 60
export const MAX_DID = 512
export const MAX_HOSTS = 20
export const EXTRA_KEYS: readonly string[] = ['prefix', 'middle', 'suffix', 'nickname', 'bio', 'pronouns', 'languages', 'location', 'link0', 'link1', 'link2', 'link3']
export const MAX_EXTRA = 340

/** The directory key of a name: lowercase, NFKC, spaces squashed, "first last". */
export function normName(first: string, last: string): string {
  return `${first} ${last}`.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)
const extraBytes = (x: Extra | undefined): string => (x === undefined ? '' : `\n${JSON.stringify(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))}`)
const recordBytes = (r: Pick<NameRecord, 'first' | 'last' | 'key' | 'ts' | 'open' | 'srv' | 'extra'>): Uint8Array =>
  bytesOf(`tw-name-v1\n${normName(r.first, r.last)}\n${r.key}\n${r.ts}\n${r.open ? 1 : 0}\n${r.srv ? 1 : 0}${extraBytes(r.extra)}`)
const intentBytes = (i: Pick<Intent, 'to' | 'from' | 'ts'>): Uint8Array => bytesOf(`tw-intent-v1\n${i.to}\n${i.from.key}\n${normName(i.from.first, i.from.last)}\n${i.ts}`)

export function makeRecord(sign: Signer, o: { first: string; last: string; key: string; ts: number; open: boolean; srv: boolean; hosts?: string[]; extra?: Extra }): NameRecord {
  const base = { first: o.first.trim(), last: o.last.trim(), key: o.key, ts: o.ts, open: o.open, srv: o.srv, ...(o.extra && Object.keys(o.extra).length ? { extra: o.extra } : {}) }
  return { v: 1, ...base, hosts: o.hosts ?? [], sig: sign(recordBytes(base)) }
}

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max

export function extraOk(x: unknown): x is Extra {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  return Object.entries(x).every(([k, v]) => EXTRA_KEYS.includes(k) && typeof v === 'string' && v.length > 0 && v.length <= MAX_EXTRA)
}

/** Shape and signature in one: never throws, false for anything odd. */
export function verifyRecord(r: unknown, verify: Verifier): r is NameRecord {
  if (typeof r !== 'object' || r === null) return false
  const o = r as Record<string, unknown>
  if (o.v !== 1 || !text(o.first, MAX_NAME) || !text(o.last, MAX_NAME) || !text(o.key, MAX_DID) || !text(o.sig, 200)) return false
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts) || typeof o.open !== 'boolean' || typeof o.srv !== 'boolean') return false
  if (!Array.isArray(o.hosts) || o.hosts.length > MAX_HOSTS || !o.hosts.every((h) => text(h, MAX_DID))) return false
  if (o.extra !== undefined && !extraOk(o.extra)) return false
  try { return verify(o.key as string, recordBytes(o as unknown as NameRecord), o.sig as string) } catch { return false }
}

/** The valid record with the highest ts (a stale or forged one never wins); null when none is valid. */
export function newest(recs: readonly unknown[], verify: Verifier): NameRecord | null {
  let best: NameRecord | null = null
  for (const r of recs) if (verifyRecord(r, verify) && (best === null || r.ts > best.ts)) best = r
  return best
}

export function makeIntent(sign: Signer, o: { to: string; first: string; last: string; key: string; ts: number }): Intent {
  const base = { to: o.to, from: { first: o.first.trim(), last: o.last.trim(), key: o.key }, ts: o.ts }
  return { ...base, sig: sign(intentBytes(base)) }
}

export function verifyIntent(i: unknown, verify: Verifier): i is Intent {
  if (typeof i !== 'object' || i === null) return false
  const o = i as Record<string, unknown>
  const f = o.from as Record<string, unknown> | null
  if (!text(o.to, MAX_DID) || typeof f !== 'object' || f === null || !text(f.first, MAX_NAME) || !text(f.last, MAX_NAME) || !text(f.key, MAX_DID)) return false
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts) || !text(o.sig, 200)) return false
  try { return verify(f.key as string, intentBytes(o as unknown as Intent), o.sig as string) } catch { return false }
}
