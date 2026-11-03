// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Text output helpers: a padded table and a few shared spellings. Plain ASCII, no colour: it must read the same piped into a file. */

/** Rows padded into columns; a header row is underlined with dashes. Empty rows -> `empty`. */
export function table(rows: readonly (readonly string[])[], header?: readonly string[], empty = '(none)'): string[] {
  if (!rows.length) return [empty]
  const all = header ? [header, ...rows] : rows
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)))
  const line = (r: readonly string[]): string => r.map((c, i) => (i === r.length - 1 ? c : (c ?? '').padEnd(widths[i]))).join('  ').trimEnd()
  const out = all.map(line)
  if (header) out.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('  '))
  return out
}

/** `2026-11-02T12:00:00.000Z` -> `2026-11-02 12:00`. */
export const when = (iso: string): string => iso.replace('T', ' ').slice(0, 16)

/** `n thing` / `n things`. */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
