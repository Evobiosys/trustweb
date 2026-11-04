// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Host-scoped short alias for share links (wave 32). The DID stays the root; the link carries a 10-character token the user's
 * own TrustWeb host resolves: https://<host>/s/<token> (about 37 characters on app.trustweb.one). After a key rotation the new
 * key signs a succession record naming the old DID, so the alias and every link already shared survive.
 * Pure helpers plus one request (registerAlias); the server side is services/trustweb-backup/alias_routes.mjs.
 */
import { signBytes, verifyDidSignature } from '../../demo/src/did'
import type { Identity } from '../../demo/src/did'
import { postTo } from './connect_code'
import type { ConnectClientDeps, ConnectRecord } from './connect_code'

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'
const TOKEN_RE = /^[a-z2-7]{10}$/

/** The new key's signed statement that it succeeds `old`. `sig` = ed25519 over successionMessage, base64url. */
export interface Succession {
  old: string
  new: string
  at: number
  sig: string
}

export interface AliasEntry {
  did: string
  createdAt: number
  succession?: Succession
  /** Epoch ms of the last time the host accepted this entry (local bookkeeping). Absent: not yet. */
  registeredAt?: number
}

/** token -> entry (AppState.aliases). */
export type Aliases = Record<string, AliasEntry>

/** 10 random base32 characters (50 bits); 256 is a multiple of 32, so masking a byte has no bias. */
export function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => BASE32[b & 31]).join('')
}

export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN_RE.test(value)

export const aliasUrl = (host: string, token: string): string => `https://${host}/s/${token}`

/** The token of `did`, made once: returns the (possibly new) map, which is the same object when nothing was added. */
export function ensureOwnAlias(aliases: Aliases, did: string, now: number, make: () => string = makeToken): { token: string; created: boolean; aliases: Aliases } {
  const held = Object.keys(aliases).find((t) => aliases[t].did === did)
  if (held !== undefined) return { token: held, created: false, aliases }
  let token = make()
  while (token in aliases) token = make()
  return { token, created: true, aliases: { ...aliases, [token]: { did, createdAt: now } } }
}

const successionMessage = (s: Pick<Succession, 'old' | 'new' | 'at'>): Uint8Array => new TextEncoder().encode(`tw-succession-v1\n${s.old}\n${s.new}\n${s.at}`)

/** The NEW identity signs that it succeeds `oldDid`. */
export function signSuccession(oldDid: string, next: Identity, at: number): Succession {
  const record = { old: oldDid, new: next.did, at }
  return { ...record, sig: signBytes(next, successionMessage(record)) }
}

/** True when `s.sig` is a valid signature by the key inside `s.new`. */
export function verifySuccession(s: Succession): boolean {
  return verifyDidSignature(s.new, successionMessage(s), s.sig)
}

/** Points every alias of `s.old` at `s.new` and keeps the record; the tokens stay. An unverifiable record changes nothing (same object back). */
export function rotateAliases(aliases: Aliases, s: Succession): Aliases {
  if (!verifySuccession(s)) return aliases
  return Object.fromEntries(Object.entries(aliases).map(([t, e]) => [t, e.did === s.old ? { ...e, did: s.new, succession: s } : e]))
}

/** The short link for a thing that has a DID ('me', 'person'); zones have no alias yet (null). For the share-link rows to call later. */
export function shortLinkFor(aliases: Aliases, host: string, kind: 'me' | 'person' | 'zone', id: string): string | null {
  if (kind === 'zone') return null
  const token = Object.keys(aliases).find((t) => aliases[t].did === id)
  return token === undefined ? null : aliasUrl(host, token)
}

/** Tells the host token -> did (and the succession, if any), signed in with the connect code's secret. True on 200/201. */
export async function registerAlias(deps: ConnectClientDeps, record: ConnectRecord, token: string, entry: AliasEntry): Promise<boolean> {
  const body = JSON.stringify({ code: record.code, secret: record.secret, token, did: entry.did, ...(entry.succession ? { succession: entry.succession } : {}) })
  const out = await postTo(deps, '/s', body)
  return typeof out === 'object' && (out.status === 200 || out.status === 201)
}
