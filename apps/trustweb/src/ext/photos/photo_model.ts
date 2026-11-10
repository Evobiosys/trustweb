// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: the pure rules of the photo store. A photo is one PhotoMeta (who is on it, where it came from, when it was
 * removed) next to its two blobs in IndexedDB (photo_store.ts). Remove = tombstone: hidden at once, kept 30 days, restorable.
 */
import { MAX_SIDE, fitSize } from '../../image_store'

export const FULL_SIDE = MAX_SIDE
export const THUMB_SIDE = 256
export const TOMBSTONE_MS = 30 * 86_400_000
/** A new photo is refused when the store would pass this share of the browser's quota. */
export const QUOTA_SHARE = 0.8

export interface PhotoMeta {
  id: string
  /** Where it came from, in plain words ("Photos folder: Seoul 2018", "picked on this phone"). */
  source: string
  addedAt: number
  bytes: number
  thumbBytes: number
  w: number
  h: number
  /** sha-256 of the kept picture: the same photo is never stored twice. */
  hash: string
  /** Person ids; the links live with the photo on this device, not in the synced record. */
  people: string[]
  deletedAt?: number
}

export const thumbSize = (w: number, h: number): { w: number; h: number } => fitSize(w, h, THUMB_SIDE)

export const isLive = (m: PhotoMeta): boolean => m.deletedAt === undefined
export const expired = (m: PhotoMeta, now: number): boolean => m.deletedAt !== undefined && now - m.deletedAt >= TOMBSTONE_MS

export const assignTo = (m: PhotoMeta, personId: string): PhotoMeta => (m.people.includes(personId) ? m : { ...m, people: [...m.people, personId] })
export const unassign = (m: PhotoMeta, personId: string): PhotoMeta => ({ ...m, people: m.people.filter((p) => p !== personId) })

export const tombstone = (m: PhotoMeta, now: number): PhotoMeta => (m.deletedAt === undefined ? { ...m, deletedAt: now } : m)
export function restore(m: PhotoMeta): PhotoMeta {
  const { deletedAt: _gone, ...rest } = m
  void _gone
  return rest
}

/** The live photos of one person, newest first. */
export const photosOf = (all: readonly PhotoMeta[], personId: string): PhotoMeta[] =>
  all.filter((m) => isLive(m) && m.people.includes(personId)).sort((a, b) => b.addedAt - a.addedAt)

/** The removed photos of one person that can still be restored. */
export const trashedOf = (all: readonly PhotoMeta[], personId: string, now: number): PhotoMeta[] =>
  all.filter((m) => !isLive(m) && !expired(m, now) && m.people.includes(personId)).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

/** Whole percent of the quota in use; null when the browser does not tell the quota. */
export const storageShare = (used: number, quota: number): number | null => (quota > 0 ? Math.floor((used / quota) * 100) : null)

/** Room for `incoming` more bytes? An unknown quota (0) allows it: the write itself fails soft. */
export const quotaRoom = (used: number, quota: number, incoming: number): boolean => quota <= 0 || used + incoming <= quota * QUOTA_SHARE
