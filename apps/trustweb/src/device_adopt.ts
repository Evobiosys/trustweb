// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Take another device's state (wave 40, Jakob 2026-11-10: "just accept the state of another device and archive local copies that are
 * different"). Pure and DOM-free: how many things differ, the wholesale adoption of a sync bundle, the archived copies of the record that
 * adoption replaced (plain JSON in localStorage, tombstoned for 30 days like a deleted person), and the one edit-stream line.
 *
 * Adoption replaces what a bundle carries (people, resources, meetings, events, tasks, invitations, chats, sameAs, messenger links, the
 * shared name and every non-excluded setting) and leaves what is true of this device only (SYNC_EXCLUDED: identity, peers, permissions, tab
 * row, ...). A picture lives on one device, so a person or resource both sides know keeps this device's picture. The caller archives first
 * and goes ahead only when `archiveRecord` returned true; afterwards it sets the stamps from the bundle (stampsAfterMerge) so the next sync
 * finds both sides identical and lists no conflict.
 */
import type { AppState, Person } from './model'
import { alive } from './deleted_people'
import { withoutPersonImage } from './person_image'
import { restoreRecord } from './snapshot'
import { settingsOf, slimMeeting } from './sync_core'
import type { SyncBundle } from './sync_core'

export const ARCHIVE_DAYS = 30
/** Copies kept at most, oldest dropped first (each is a whole record in localStorage). */
export const ARCHIVE_KEEP = 5
const DAY = 86_400_000

export interface Differences { people: number; notes: number; settings: number }

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((x) => [x.id, x]))

/** What taking `theirs` would change on this device: people added, removed or changed; note lines added, removed or reworded on people both know; settings that differ. */
export function differences(mine: AppState, theirs: SyncBundle): Differences {
  const a = byId(alive(mine.people).map(withoutPersonImage))
  const b = byId(theirs.people.map(withoutPersonImage))
  let people = 0
  let notes = 0
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const m = a.get(id)
    const t = b.get(id)
    if (!m || !t) { people++; continue }
    if (!same(m, t)) people++
    const ml = byId(m.lines)
    const tl = byId(t.lines)
    for (const lid of new Set([...ml.keys(), ...tl.keys()])) if (!same(ml.get(lid), tl.get(lid))) notes++
  }
  const mySettings = settingsOf(mine)
  const theirSettings = theirs.settings ?? mySettings
  const settings = [...new Set([...Object.keys(mySettings), ...Object.keys(theirSettings)])].filter((k) => !same(mySettings[k], theirSettings[k])).length
  return { people, notes, settings }
}

function keepPictures<T extends { id: string }>(incoming: T[], local: T[], key: 'image' | 'imageId'): T[] {
  const pics = new Map(local.flatMap((x) => { const v = (x as Record<string, unknown>)[key]; return v ? [[x.id, v] as const] : [] }))
  return incoming.map((x) => (pics.has(x.id) ? { ...x, [key]: pics.get(x.id) } : x))
}

/** Replaces, in place, what the bundle carries with the bundle's version. Running it again with the same bundle changes nothing. */
export function adoptBundle(mine: AppState, theirs: SyncBundle): void {
  const t = structuredClone(theirs)
  const own = mine as unknown as Record<string, unknown>
  mine.people = keepPictures(t.people, mine.people, 'image')
  mine.inventory = keepPictures(t.inventory, mine.inventory, 'imageId')
  mine.meetings = t.meetings
  mine.events = t.events ?? []
  for (const k of ['tasks', 'invitations', 'sameAs'] as const) { if (t[k]) own[k] = t[k]; else delete own[k] }
  mine.chats = t.chats ?? {}
  if (t.channels) { mine.myChannels = t.channels.mine; mine.contactShare = t.channels.share }
  if (t.displayName && mine.me) mine.me.displayName = t.displayName
  if (t.settings) {
    for (const k of Object.keys(settingsOf(mine))) if (!(k in t.settings)) delete own[k]
    Object.assign(own, t.settings)
  }
}

export interface ArchivedCopy {
  id: string
  at: number
  expiresAt: number
  reason: string
  device: string
  people: number
  /** False when storage was too tight for the pictures: they are not in this copy. */
  pictures: boolean
  record: AppState
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** The kept copies, newest first; the ones past their 30 days are not listed (and go at the next write). Unreadable storage: none. */
export function readArchived(store: Store, storeKey: string, now: number): ArchivedCopy[] {
  try {
    const list: unknown = JSON.parse(store.getItem(storeKey) ?? '[]')
    return Array.isArray(list) ? list.filter((c): c is ArchivedCopy => typeof c?.id === 'string' && typeof c.expiresAt === 'number' && c.expiresAt > now && typeof c.record === 'object').sort((x, y) => y.at - x.at) : []
  } catch { return [] }
}

/**
 * Keeps a copy of the record as it is now (meetings without transcript, early packs and late link, as snapshots do). Too big for storage:
 * once more without the pictures. False = nothing was kept; the caller must not go on to replace the record.
 */
export function archiveRecord(store: Store, storeKey: string, s: AppState, why: { reason: string; device: string }, now: number): boolean {
  const slim: AppState = { ...structuredClone(s), ...(s.meetings ? { meetings: s.meetings.map(slimMeeting) } : {}) }
  const bare: AppState = { ...slim, people: slim.people.map(withoutPersonImage) }
  const kept = readArchived(store, storeKey, now)
  for (const [record, pictures] of [[slim, true], [bare, false]] as const) {
    const copy: ArchivedCopy = { id: `${now}-${kept.length}`, at: now, expiresAt: now + ARCHIVE_DAYS * DAY, ...why, people: alive(s.people).length, pictures, record }
    for (const list of [[copy, ...kept].slice(0, ARCHIVE_KEEP), [copy, ...kept].slice(0, 1)]) {
      try { store.setItem(storeKey, JSON.stringify(list)); return true } catch { /* full: fewer old copies, then the other form */ }
    }
  }
  return false
}

/** The record of a copy for use now; transcripts and pictures this device still holds come back from `live`. */
export function restoreArchived(c: ArchivedCopy, live: AppState | null): AppState {
  const rec = restoreRecord(structuredClone(c.record), live)
  if (c.pictures) return rec
  const pics = new Map((live?.people ?? []).flatMap((p) => (p.image ? [[p.id, p.image] as const] : [])))
  return { ...rec, people: rec.people.map((p: Person) => (pics.has(p.id) ? { ...p, image: pics.get(p.id) } : p)) }
}
