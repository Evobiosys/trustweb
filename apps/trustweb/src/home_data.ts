// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 home-dashboard: what the request tiles of the Home board show, read from the record. Asks I sent show their text only, never who
 * answered or how (I2 asker blindness). Pure, no imports: apps/mcp loads it under plain node.
 */
export const ROWS_MAX = 3
export interface HomeRow { id: string; text: string }
export interface TileData { count: number; rows: HomeRow[] }

interface Rec {
  awayAsks?: { id: string; at: number; from: string; text: string }[]
  heldAsks?: { qid: string; text: string; fromName: string }[]
  wantsToConnect?: { peerId: string; name: string; at: number }[]
  sentAsks?: { id: string; text: string; at: number }[]
  invitesSent?: number
}

export type RequestKind = 'away' | 'held' | 'connect' | 'sent'
export interface RequestRow { id: string; kind: RequestKind; text: string }
/** Wave 44c home-default: every open request, grouped for the Existing requests list (mine and others'). Text only (I2). */
export interface RequestGroups { toMe: RequestRow[]; connects: RequestRow[]; sent: RequestRow[]; invites: number }

export function requestGroups(s: Rec): RequestGroups {
  const seen = new Set<string>()
  const toMe: RequestRow[] = []
  for (const a of s.awayAsks ?? []) if (!seen.has(a.id)) { seen.add(a.id); toMe.push({ id: a.id, kind: 'away', text: `${a.from}: ${a.text}` }) }
  for (const h of s.heldAsks ?? []) if (!seen.has(h.qid)) { seen.add(h.qid); toMe.push({ id: h.qid, kind: 'held', text: `${h.fromName}: ${h.text}` }) }
  return {
    toMe,
    connects: (s.wantsToConnect ?? []).map((w) => ({ id: w.peerId, kind: 'connect', text: w.name })),
    sent: [...(s.sentAsks ?? [])].sort((a, b) => b.at - a.at).map((a) => ({ id: a.id, kind: 'sent', text: a.text })),
    invites: s.invitesSent ?? 0,
  }
}

export function findRequest(s: Rec, id: string): RequestRow | null {
  const g = requestGroups(s)
  return [...g.toMe, ...g.connects, ...g.sent].find((r) => r.id === id) ?? null
}

const cut = (rows: HomeRow[]): TileData => ({ count: rows.length, rows: rows.slice(0, ROWS_MAX) })

export function tileData(s: Rec, tile: string): TileData {
  if (tile === 'asksToMe') {
    const seen = new Set<string>()
    const rows: HomeRow[] = []
    for (const a of s.awayAsks ?? []) if (!seen.has(a.id)) { seen.add(a.id); rows.push({ id: a.id, text: `${a.from}: ${a.text}` }) }
    for (const h of s.heldAsks ?? []) if (!seen.has(h.qid)) { seen.add(h.qid); rows.push({ id: h.qid, text: `${h.fromName}: ${h.text}` }) }
    return cut(rows)
  }
  if (tile === 'connects') return cut((s.wantsToConnect ?? []).map((w) => ({ id: w.peerId, text: w.name })))
  if (tile === 'asksSent') return cut([...(s.sentAsks ?? [])].sort((a, b) => b.at - a.at).map((a) => ({ id: a.id, text: a.text })))
  if (tile === 'requests') {
    const g = requestGroups(s)
    const all = [...g.toMe, ...g.connects, ...g.sent]
    return { count: all.length + g.invites, rows: all.slice(0, ROWS_MAX) }
  }
  if (tile === 'invites') return { count: s.invitesSent ?? 0, rows: [] }
  return { count: 0, rows: [] }
}
