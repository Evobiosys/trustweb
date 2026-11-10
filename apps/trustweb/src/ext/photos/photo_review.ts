// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: the Photos folder import. A picked folder becomes a review list; the owner says who each picture shows (existing people
 * only, typed by name) or assigns a whole sub-folder at once. With the opt-in on, phone numbers in the path and face clusters add SUGGESTIONS
 * that count only once the owner takes them. Pure; the files are carried along untouched for photo_ingest.
 */
import type { Person } from '../../model'
import { isImageFile } from './photo_ingest'
import type { FaceCluster } from './face_match'
import { phoneHint } from './phone_match'

export interface PickedFile { name: string; type: string; webkitRelativePath?: string }
export interface ReviewItem<F extends PickedFile = PickedFile> {
  key: string
  file: F
  name: string
  path: string
  /** Sub-folders under the picked folder, joined with "/"; empty for the top level or a plain multi-file pick. */
  folder: string
  personId?: string
  suggest?: { personId: string; why: 'phone' | 'face' }
}

export function buildReview<F extends PickedFile>(files: readonly F[]): ReviewItem<F>[] {
  return files.filter(isImageFile).map((file, i) => {
    const path = file.webkitRelativePath || file.name
    return { key: `${i}:${path}`, file, name: file.name, path, folder: path.split('/').slice(1, -1).join('/') }
  })
}

export function foldersOf(items: readonly ReviewItem[]): { folder: string; count: number }[] {
  const out = new Map<string, number>()
  for (const it of items) out.set(it.folder, (out.get(it.folder) ?? 0) + 1)
  return [...out].map(([folder, count]) => ({ folder, count }))
}

export const assigned = <F extends PickedFile>(items: readonly ReviewItem<F>[]): ReviewItem<F>[] => items.filter((i) => i.personId !== undefined)

export const setAssign = <F extends PickedFile>(items: readonly ReviewItem<F>[], key: string, personId: string | undefined): ReviewItem<F>[] =>
  items.map((i) => {
    if (i.key !== key) return i
    const { personId: _old, ...rest } = i
    void _old
    return personId === undefined ? rest : { ...rest, personId }
  })

export const assignFolder = <F extends PickedFile>(items: readonly ReviewItem<F>[], folder: string, personId: string): ReviewItem<F>[] =>
  items.map((i) => (i.folder === folder ? { ...i, personId } : i))

export const assignKeys = <F extends PickedFile>(items: readonly ReviewItem<F>[], keys: readonly string[], personId: string): ReviewItem<F>[] =>
  items.map((i) => (keys.includes(i.key) ? { ...i, personId } : i))

export interface Hints {
  people: readonly Pick<Person, 'id' | 'channels' | 'fields'>[]
  clusters?: readonly FaceCluster[]
  /** The person the owner named for a cluster (cluster id -> person id). */
  clusterPerson?: Readonly<Record<string, string>>
}

/** Adds suggestions to the pictures nobody chose a person for yet: a phone number in the path first, else the cluster's person. */
export function suggestAll<F extends PickedFile>(items: readonly ReviewItem<F>[], h: Hints): ReviewItem<F>[] {
  const clusterOf = new Map<string, string>()
  for (const c of h.clusters ?? []) { const p = h.clusterPerson?.[c.id]; if (p) for (const k of c.photoIds) clusterOf.set(k, p) }
  return items.map((i) => {
    if (i.personId !== undefined) return i
    const phone = phoneHint(i.path, h.people)
    const face = clusterOf.get(i.key)
    const suggest = phone ? { personId: phone, why: 'phone' as const } : face ? { personId: face, why: 'face' as const } : undefined
    return suggest ? { ...i, suggest } : i
  })
}

export const takeSuggestions = <F extends PickedFile>(items: readonly ReviewItem<F>[]): ReviewItem<F>[] =>
  items.map((i) => {
    if (!i.suggest) return i
    const { suggest, ...rest } = i
    return i.personId === undefined ? { ...rest, personId: suggest.personId } : rest
  })
