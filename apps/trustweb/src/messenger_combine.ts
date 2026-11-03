// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28: the combined chat view. TrustWeb, Matrix, Geb and Signal rows merged by time, each tagged with its source (the left C-bracket colour). Pure, no DOM. */
import type { MessengerSource, ThreadSummary } from './ext/registry'

export const TRUSTWEB_SOURCE = 'trustweb'

/** The left-edge bracket colour per source; "Matrix" keeps its own so a row shows where it comes from. */
export const SOURCE_COLOR: Record<string, string> = {
  trustweb: 'var(--electric)',
  matrix: '#E0A100',
  geb: '#8B5CF6',
  'signal-link': '#3A76F0',
}
export const sourceColor = (id: string): string => SOURCE_COLOR[id] ?? 'var(--ink-soft)'

export interface TaggedThread extends ThreadSummary { source: string }

/** Newest first; equal times keep the order the sources were given. */
export function mergeThreads(bySource: Record<string, ThreadSummary[]>): TaggedThread[] {
  return Object.entries(bySource)
    .flatMap(([source, ts]) => ts.map((t) => ({ ...t, source })))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.lastAt - a.t.lastAt || a.i - b.i)
    .map((x) => x.t)
}

/** Do Not Disturb keeps the last state: nothing newer than the moment it was switched on. */
export const hideNewerThan = <T extends { lastAt: number }>(rows: readonly T[], since: number | undefined): T[] =>
  since === undefined ? [...rows] : rows.filter((r) => r.lastAt <= since)

/** on = usable now, setup = listed greyed (needs setting up first). A source the owner switched off is not listed at all. */
export interface SourceEntry { id: string; label: string; state: 'on' | 'setup' }

export function listEntries(sources: readonly Pick<MessengerSource, 'id' | 'label' | 'status'>[], off: ReadonlySet<string>, trustwebLabel = 'TrustWeb'): SourceEntry[] {
  return [
    { id: TRUSTWEB_SOURCE, label: trustwebLabel, state: 'on' as const },
    ...sources.filter((s) => !off.has(s.id)).map((s) => ({ id: s.id, label: s.label, state: s.status() === 'needs-setup' ? ('setup' as const) : ('on' as const) })),
  ]
}

/** The chosen sources that can show now; TrustWeb when none can. */
export function usableSelection(selection: readonly string[], entries: readonly SourceEntry[]): string[] {
  const ok = selection.filter((id) => entries.some((e) => e.id === id && e.state === 'on'))
  return ok.length ? ok : [TRUSTWEB_SOURCE]
}

export function toggleSource(selection: readonly string[], id: string): string[] {
  if (!selection.includes(id)) return [...selection, id]
  return selection.length > 1 ? selection.filter((x) => x !== id) : [...selection]
}

/** "Matrix", "TrustWeb + Signal", or the all-chats name when every usable source is in. */
export function viewTitle(selection: readonly string[], labels: Record<string, string>, allName: string, usableCount = Infinity): string {
  if (selection.length > 2 && selection.length >= usableCount) return allName
  return selection.map((id) => labels[id] ?? id).join(' + ')
}

const strings = (raw: string | null): string[] => {
  try {
    const v: unknown = JSON.parse(raw ?? 'null')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
export const parseSelection = (raw: string | null): string[] => { const s = strings(raw); return s.length ? s : [TRUSTWEB_SOURCE] }
export const parseOff = (raw: string | null): Set<string> => new Set(strings(raw))

/** "Only this chat" (distraction-free): just the row with this source:id key, or all rows when none is picked. */
export const focusRows = <T extends { source: string; id: string }>(rows: readonly T[], key: string | null): T[] =>
  key ? rows.filter((r) => `${r.source}:${r.id}` === key) : [...rows]
