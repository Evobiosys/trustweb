// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 push-popup: every notification the worker or the page shows is first written to a local inbox (IndexedDB, the one store a
 * worker and the page share). When the app comes to the front with an unseen item in it, one modal popup lists them until the person
 * presses its X. The list logic is pure; the store at the bottom is a thin IndexedDB wrapper. Nothing leaves the device (I1).
 */
import type { NotifyKind } from './notify_kinds'
import { route, type NotifyHome } from './notify_route'

/** `other`: the worker's fallback line, when no wire could be read. */
export type InboxKind = NotifyKind | 'other'
export interface InboxItem { id: string; kind: InboxKind; title: string; body: string; at: number; seenAt: number | null }
export interface PopupRow { id: string; kind: InboxKind; title: string; body: string; at: number; home: NotifyHome }

export const INBOX_CAP = 50

export function newItem(kind: InboxKind, title: string, body: string, at: number, id: string): InboxItem {
  return { id, kind, title, body, at, seenAt: null }
}

const newestFirst = (a: InboxItem, b: InboxItem): number => b.at - a.at

/** Adds one item (a known id is ignored); newest first, at most INBOX_CAP kept. */
export function addItem(list: readonly InboxItem[], item: InboxItem): InboxItem[] {
  if (list.some((i) => i.id === item.id)) return [...list]
  return [item, ...list].sort(newestFirst).slice(0, INBOX_CAP)
}

export function unseen(list: readonly InboxItem[]): InboxItem[] {
  return list.filter((i) => i.seenAt === null).sort(newestFirst)
}

export function markSeen(list: readonly InboxItem[], ids: readonly string[], at: number): InboxItem[] {
  return list.map((i) => (ids.includes(i.id) && i.seenAt === null ? { ...i, seenAt: at } : i))
}

export function markOneSeen(list: readonly InboxItem[], id: string, at: number): InboxItem[] {
  return markSeen(list, [id], at)
}

/** The store and the mirror kept in the record (for MCP) merge by id; a seenAt on either side wins. */
export function reconcileInbox(store: readonly InboxItem[], mirror: readonly InboxItem[]): InboxItem[] {
  const by = new Map<string, InboxItem>()
  for (const i of [...mirror, ...store]) {
    const had = by.get(i.id)
    by.set(i.id, had ? { ...i, seenAt: had.seenAt ?? i.seenAt } : i)
  }
  return [...by.values()].sort(newestFirst).slice(0, INBOX_CAP)
}

/** What the popup lists: nothing while the setting is off (`off`) or all is seen; else unseen items, newest first, each with the screen it opens. */
export function popupRows(list: readonly InboxItem[], off: boolean): PopupRow[] {
  if (off) return []
  return unseen(list).map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, at: i.at, home: route(i.kind === 'other' ? 'connect' : i.kind) }))
}

// --- IndexedDB (page and worker) ---------------------------------------------------------------------------------------------------

const DB_NAME = 'trustweb-inbox'
const STORE = 'items'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => { resolve(req.result); db.close() }
    req.onerror = () => { reject(req.error); db.close() }
  })
}

export async function inboxAll(): Promise<InboxItem[]> {
  try { return ((await withStore<InboxItem[]>('readonly', (s) => s.getAll())) ?? []).sort(newestFirst) } catch { return [] }
}

/** Never throws: a blocked store must not stop the notification itself. */
export async function inboxPut(item: InboxItem): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(item))
    const all = await inboxAll()
    for (const old of all.slice(INBOX_CAP)) await withStore('readwrite', (s) => s.delete(old.id))
  } catch { /* the notification still shows */ }
}

export async function inboxSetSeen(ids: readonly string[], at: number): Promise<void> {
  const all = await inboxAll()
  for (const i of markSeen(all, ids, at)) if (ids.includes(i.id)) await withStore('readwrite', (s) => s.put(i)).catch(() => undefined)
}

/** The whole list in ONE transaction: a reload right after cannot catch it half written. */
export async function inboxReplace(list: readonly InboxItem[]): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.clear()
      for (const i of list) store.put(i)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch { /* keep going */ }
}

export const inboxId = (at: number, n: number): string => `${at.toString(36)}-${n}-${Math.random().toString(36).slice(2, 6)}`
