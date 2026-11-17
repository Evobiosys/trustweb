// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c answers-44c (A4 tombstones, Jakob 2026-11-17 "Yes"): deleting an event, resource, task, meeting or invitation moves it into
 * AppState.trash for 30 days (like a person, deleted_people.ts). The entry travels to every linked device as its own sync entity (`x:<kind>:<id>`,
 * sync_core.ts), so a delete on one device deletes on the others; Settings > Recently deleted puts it back, and the restore travels too.
 * Pure, no imports (apps/mcp loads it under plain node).
 */
export const TRASH_KINDS = ['event', 'resource', 'task', 'meeting', 'invitation'] as const
export type TrashKind = (typeof TRASH_KINDS)[number]
export interface TrashEntry { kind: TrashKind; id: string; item: { id: string }; deleted_at: string }
type Rec = { trash?: TrashEntry[] } & object
export const TRASH_DAYS = 30
const DAY_MS = 86_400_000
/** The record list each kind lives in. */
export const TRASH_LIST: Record<TrashKind, 'events' | 'inventory' | 'tasks' | 'meetings' | 'invitations'> = { event: 'events', resource: 'inventory', task: 'tasks', meeting: 'meetings', invitation: 'invitations' }

export const trashKey = (t: Pick<TrashEntry, 'kind' | 'id'>): string => `x:${t.kind}:${t.id}`

const listOf = (s: Rec, kind: TrashKind): { id: string }[] => {
  const v = (s as Record<string, unknown>)[TRASH_LIST[kind]]
  return Array.isArray(v) ? (v as { id: string }[]) : []
}
const setList = (s: Rec, kind: TrashKind, list: { id: string }[]): void => { (s as Record<string, unknown>)[TRASH_LIST[kind]] = list }
const setTrash = (s: Rec, t: TrashEntry[]): void => { if (t.length) s.trash = t; else delete s.trash }

export const isTrashEntry = (v: unknown): v is TrashEntry => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const item = o.item as Record<string, unknown> | null
  return (TRASH_KINDS as readonly unknown[]).includes(o.kind) && typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 100
    && !!item && typeof item === 'object' && item.id === o.id && typeof o.deleted_at === 'string' && !Number.isNaN(Date.parse(o.deleted_at))
}

/** Moves the items with these ids out of their list into the trash (stamped `now`); returns the new entries. */
export function trashItems(s: Rec, kind: TrashKind, ids: readonly string[], now: number): TrashEntry[] {
  const list = listOf(s, kind)
  const gone = list.filter((x) => ids.includes(x.id))
  if (!gone.length) return []
  setList(s, kind, list.filter((x) => !ids.includes(x.id)))
  const at = new Date(now).toISOString()
  const added = gone.map((item): TrashEntry => ({ kind, id: item.id, item, deleted_at: at }))
  setTrash(s, [...(s.trash ?? []).filter((t) => !(t.kind === kind && ids.includes(t.id))), ...added])
  return added
}

/** Puts a trashed item back into its list; false when it is not in the trash. */
export function restoreTrashed(s: Rec, kind: TrashKind, id: string): boolean {
  const t = (s.trash ?? []).find((x) => x.kind === kind && x.id === id)
  if (!t) return false
  setList(s, kind, [...listOf(s, kind).filter((x) => x.id !== id), t.item])
  setTrash(s, (s.trash ?? []).filter((x) => x !== t))
  return true
}

const due = (t: TrashEntry, now: number): boolean => now - Date.parse(t.deleted_at) > TRASH_DAYS * DAY_MS

/** What Settings > Recently deleted lists: inside the 30 days, newest deletion first. */
export const recentlyTrashed = (s: Rec, now: number): TrashEntry[] =>
  (s.trash ?? []).filter((t) => !due(t, now)).sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at))

/** Drops entries older than 30 days for good; returns how many. */
export function purgeTrash(s: Rec, now: number): number {
  const all = s.trash ?? []
  const keep = all.filter((t) => !due(t, now))
  if (keep.length !== all.length) setTrash(s, keep)
  return all.length - keep.length
}

/** Whole days left before an entry goes for good. */
export const trashDaysLeft = (t: TrashEntry, now: number): number => Math.max(0, TRASH_DAYS - Math.floor((now - Date.parse(t.deleted_at)) / DAY_MS))

/**
 * Sync (sync_core.ts mergeBundle, before the lists merge). `liveKey(kind, id)` = the item's own stamp key; `myAt`/`theirAt` = stamp times.
 * Their tombstone newer than my copy: my copy goes into my trash. Their copy of an item I trashed: it comes back only when it is newer than my delete
 * (an edit or a restore over there), then my tombstone goes. Returns how many items changed and their lists without the items my trash keeps out.
 */
export function mergeTrash(
  mine: Rec, theirTrash: readonly TrashEntry[], theirLists: Record<TrashKind, { id: string }[]>,
  liveKey: (kind: TrashKind, id: string) => string, myAt: (key: string) => number, theirAt: (key: string) => number,
): { changed: number; lists: Record<TrashKind, { id: string }[]> } {
  let changed = 0
  let trash = [...(mine.trash ?? [])]
  const stampOf = (t: TrashEntry, at: (k: string) => number): number => at(trashKey(t)) || Date.parse(t.deleted_at)
  for (const t of theirTrash) {
    const live = listOf(mine, t.kind)
    const have = live.find((x) => x.id === t.id)
    if (have && stampOf(t, theirAt) < myAt(liveKey(t.kind, t.id))) continue // edited or restored here after their delete
    if (have) { setList(mine, t.kind, live.filter((x) => x !== have)); changed++ }
    if (!trash.some((x) => x.kind === t.kind && x.id === t.id)) { trash.push(t); if (!have) changed++ }
  }
  const lists = { ...theirLists }
  for (const kind of TRASH_KINDS) {
    lists[kind] = (theirLists[kind] ?? []).filter((x) => {
      const mineT = trash.find((t) => t.kind === kind && t.id === x.id)
      if (!mineT) return true
      if (theirAt(liveKey(kind, x.id)) <= stampOf(mineT, myAt)) return false // their copy is older than my delete
      trash = trash.filter((t) => t !== mineT); changed++
      return true
    })
  }
  setTrash(mine, trash)
  return { changed, lists }
}
