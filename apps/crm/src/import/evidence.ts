// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Interaction evidence (wave 27): one row per message or call seen in an export, kept on this device.
 * A row says WHEN and WHICH WAY, never what was said: there is no text field, and the parsers never read one into a row (I1).
 * Pure: no DOM, no network, no storage.
 */
import type { ContactSource } from './types'

export type EvidenceDir = 'in' | 'out' | 'none'
export type EvidenceKind = 'msg' | 'call' | 'meeting'

export interface Evidence {
  id: string
  /** Stable person key from the parser (for WhatsApp: "wa:" + the normalised display name). */
  personKey: string
  source: ContactSource
  /** Milliseconds since epoch (UTC). */
  ts: number
  /** in: they wrote to me; out: I wrote to them; none: no direction known. */
  dir: EvidenceDir
  kind: EvidenceKind
  /** Where in the export the row came from (e.g. "_chat.txt#line:12"). Never message text. */
  ref: string
}

export const WINDOW_DAYS = 365
const DAY_MS = 86_400_000

export interface Summary {
  /** Rows in the last WINDOW_DAYS days up to `now` (future rows ignored). */
  n365: number
  in: number
  out: number
  /** Latest row at or before `now`, any age. Absent when there is none. */
  lastTs?: number
  /** Ids of the rows counted in n365, so a proposal can point at its evidence. */
  ids: string[]
}

export function summarise(list: readonly Evidence[], personKey: string, now: number): Summary {
  const floor = now - WINDOW_DAYS * DAY_MS
  const s: Summary = { n365: 0, in: 0, out: 0, ids: [] }
  for (const e of list) {
    if (e.personKey !== personKey || e.ts > now) continue
    if (s.lastTs === undefined || e.ts > s.lastTs) s.lastTs = e.ts
    if (e.ts < floor) continue
    s.n365++
    if (e.dir === 'in') s.in++
    if (e.dir === 'out') s.out++
    s.ids.push(e.id)
  }
  return s
}

/** Every person's summary in one pass per person key; a map from personKey to its Summary. */
export function summariseAll(list: readonly Evidence[], now: number): Map<string, Summary> {
  const keys = new Set(list.map((e) => e.personKey))
  return new Map([...keys].map((k) => [k, summarise(list, k, now)]))
}
