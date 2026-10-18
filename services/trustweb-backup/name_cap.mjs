// Per-address cap on CLAIMED names (wave 15). The count lives in the connect store file; this module is the allow-list of organizers (higher cap, approved ahead).
//
//   NAME_CAP_ALLOW  JSON file: [{"addr":"203.0.113.7" | "prefix":"2001:db8:1:2:", "code":"<22 chars>", "cap":20, "note":"organizer <who>, approved <when>"}]
//   An entry matches a request when its addr (same /64 rule as ipKey) or its prefix (start of the ipKey) or its code is the request's. The highest matching cap wins.
//   Read at start and on SIGHUP; a missing or unreadable file means no entries. Pure parsing, no logging.

import fs from 'node:fs'
import { ipKey } from './limits.mjs'

/** The usable entries of the allow-list text: a JSON array of objects with an integer cap >= 1 and at least one of addr, prefix, code. */
export function parseNameCapAllow(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e) => e !== null && typeof e === 'object' && Number.isInteger(e.cap) && e.cap >= 1 && [e.addr, e.prefix, e.code].some((v) => typeof v === 'string' && v !== ''))
    .map((e) => ({ addr: typeof e.addr === 'string' && e.addr !== '' ? ipKey(e.addr) : undefined, prefix: e.prefix || undefined, code: e.code || undefined, cap: e.cap, note: String(e.note ?? '') }))
}

/** The cap for a request from `key` (an ipKey) acting for `code`: the highest matching entry, else `base`. */
export function capFor(list, key, code, base) {
  let cap = base
  for (const e of list) if (e.cap > cap && (e.addr === key || e.code === code || (e.prefix !== undefined && key.startsWith(e.prefix)))) cap = e.cap
  return cap
}

/** The allow-list of `file` ('' = none): {list(), reload()}. */
export function createNameCapAllow(file) {
  let entries = []
  const reload = () => {
    try {
      entries = file === '' ? [] : parseNameCapAllow(fs.readFileSync(file, 'utf8'))
    } catch {
      entries = []
    }
  }
  reload()
  return { list: () => entries, reload }
}
