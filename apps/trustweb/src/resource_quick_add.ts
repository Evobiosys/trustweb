// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 outliner-quickadd: the # tag / @ person typeahead of the outline's quick-add input (same flow as the chip input) and the chips of a line. Pure. */
export interface QuickKnown { tags: readonly string[]; people: readonly string[] }

const TAIL = /(^|\s)([#@][^\s#@]*)$/u
const CHIP = /(^|\s)([#@][\p{L}\p{N}_-]+)/gu
const MAX_HITS = 6

/** Suggestions for the #/@ word at the end of `text` (prefix matches first); an exact match or no trailing word gives none. */
export function quickHits(text: string, known: QuickKnown): string[] {
  const m = TAIL.exec(text)
  if (!m) return []
  const mark = m[2][0]
  const q = m[2].slice(1).toLowerCase()
  const pool = (mark === '#' ? known.tags : known.people).map((l) => mark + l)
  if (pool.some((l) => l.slice(1).toLowerCase() === q && q)) return []
  const has = (l: string): boolean => l.slice(1).toLowerCase().includes(q)
  const starts = (l: string): boolean => l.slice(1).toLowerCase().startsWith(q)
  return [...pool.filter(starts), ...pool.filter((l) => has(l) && !starts(l))].slice(0, MAX_HITS)
}

/** Puts the chosen suggestion in place of the trailing word. */
export const completeToken = (text: string, hit: string): string => text.replace(TAIL, (_all, pre: string) => `${pre}${hit} `)

/** The #tags and @names a line carries, in order. */
export const lineChips = (text: string): string[] => [...text.matchAll(CHIP)].map((m) => m[2])
