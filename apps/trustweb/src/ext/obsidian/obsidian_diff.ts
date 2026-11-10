// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: what changed in a vault since the last sync, by sha-256 of each note's text. Pure; runs in the Web Worker and in tests. */

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface HashDiff { added: string[]; changed: string[]; removed: string[]; same: string[] }

/** `known` = path -> hash from the last sync, `current` = path -> hash now. Each list is sorted. */
export function diffHashes(known: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>): HashDiff {
  const d: HashDiff = { added: [], changed: [], removed: [], same: [] }
  for (const [p, h] of Object.entries(current)) {
    if (!(p in known)) d.added.push(p)
    else if (known[p] === h) d.same.push(p)
    else d.changed.push(p)
  }
  for (const p of Object.keys(known)) if (!(p in current)) d.removed.push(p)
  for (const k of Object.keys(d) as (keyof HashDiff)[]) d[k].sort()
  return d
}
