// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 5, Jakob 2026-11-18 00:18: "make sure the personal devices only hold the Tana token"). The Tana token lives in this
 * browser's storage only (tana_token.ts: this visit, or sealed on this computer), never in the record. Defence in depth for anything that
 * reaches the record anyway (an import, an older build, a hand-edited file): a key naming a Tana token, key, secret, password or credential, or such
 * a key inside an object whose key names Tana, is dropped from what leaves this device: the device-sync bundle and delta (sync_core.ts), the
 * export (sovereign_switch.ts), the MCP reads (apps/mcp record_tools.ts load). Pure, no imports (apps/mcp loads it under plain node).
 */
const SECRET = new Set(['token', 'secret', 'key', 'apikey', 'password', 'credential', 'credentials'])
/** The words of a key: camelCase and _ - . spaces split ("importTana" -> import, tana); a random id stays one word, so it never reads as "tana". */
const words = (k: string): string[] => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** `path` = the keys from the record root down to this one. */
export function isTanaSecret(path: readonly string[]): boolean {
  const k = path[path.length - 1] ?? ''
  if (!words(k).some((w) => SECRET.has(w))) return false
  return path.some((p) => words(p).includes('tana'))
}

/** A deep copy without the Tana secrets; arrays and plain objects are walked, other values are kept as they are. The input is never changed. */
export function scrubSecrets<T>(v: T): T {
  const walk = (x: unknown, path: string[]): unknown => {
    if (Array.isArray(x)) return x.map((y) => walk(y, path))
    if (!x || typeof x !== 'object' || Object.getPrototypeOf(x) !== Object.prototype) return x
    const out: Record<string, unknown> = {}
    for (const [k, y] of Object.entries(x)) {
      const p = [...path, k]
      if (!isTanaSecret(p)) out[k] = walk(y, p)
    }
    return out
  }
  return walk(v, []) as T
}
