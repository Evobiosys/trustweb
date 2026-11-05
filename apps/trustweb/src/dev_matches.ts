// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Dev only (wave 31): polls GET /__tw/matches (vite.config.mjs) for the lines the pc24 matching service streams in. The define is the literal null in a build. */
import type { Match } from './model'
import { parseLines } from './matches'

declare const __TW_DEV_MATCHES__: true | null | undefined

export interface MatchStatus { phase?: string; done?: number; total?: number }

export const devMatchesOn = (): boolean => typeof __TW_DEV_MATCHES__ !== 'undefined' && __TW_DEV_MATCHES__ === true

let cursor = 0

/** The lines after the last poll; null when the endpoint is not there. */
export async function pollDevMatches(): Promise<{ items: Match[]; status: MatchStatus | null } | null> {
  if (!devMatchesOn()) return null
  try {
    const r = await fetch(`/__tw/matches?from=${cursor}`, { cache: 'no-store' })
    if (!r.ok) return null
    const b = await r.json() as { lines: string[]; next: number; status: MatchStatus | null }
    cursor = b.next
    return { items: parseLines(b.lines), status: b.status }
  } catch { return null }
}
