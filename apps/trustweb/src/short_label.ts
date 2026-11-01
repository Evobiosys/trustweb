// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** A dot's label: the full name if it fits `max` characters, else the first name (prefixes like "Dr." skipped), cut to max-1 + "…". */
export function shortLabel(name: string, max = 20): string {
  const full = name.trim().replace(/\s+/g, ' ')
  if (Array.from(full).length <= max) return full
  const tokens = full.split(' ')
  const first = tokens.find((t) => !t.endsWith('.')) ?? tokens[0]
  const chars = Array.from(first)
  return chars.length <= max ? first : chars.slice(0, max - 1).join('') + '…'
}
