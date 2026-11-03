// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 (Jakob 2026-11-01): the TrustZones view. Pure, no DOM: which people the rings show (archived never, the two filters), the saved view state
 * (`uiRings`), the orange tone per rung, the community tag source, and the zzz suggestions grouped by kind. Nothing here moves a person.
 */
import { Ring } from './model'
import type { AppState, Person } from './model'
import { type ColourTag, tagsOf } from './colour_tags'
import { isBlocked } from './non_responsive'
import { ringShown } from './rings_filter'
import { webSlot } from './rings_layout'

/** Rung order from the centre out: the index is the colour token (`--ring-N` in styles.css: five oranges, strongest inside; the outermost grey). */
export const TONE_ORDER: readonly Ring[] = [Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted]

export const toneIndex = (ring: Ring): number => Math.max(0, TONE_ORDER.indexOf(ring))
export const toneVar = (ring: Ring): string => `var(--ring-${toneIndex(ring)})`

/** Archived = filed under "Not in my web" (Ring.None: what Dismiss and an import undo leave): never listed, drawn, searched or counted (G5). */
export const isArchived = (p: Pick<Person, 'ring'>): boolean => p.ring === Ring.None

type UiState = Partial<Pick<AppState, 'uiRings'>>

/** Rings drawn with everyone in them, not only the closest five. Absent = acquaintances (the default fill). */
export const filledRings = (s: UiState): readonly Ring[] => s.uiRings?.filled ?? [Ring.Acquaintance]
export const filterOpen = (s: UiState): boolean => s.uiRings?.filterOpen === true
/** List sections unfolded; the closest few show by default. */
export const openRings = (s: UiState): readonly Ring[] => s.uiRings?.open ?? [Ring.Closest]
export const communityOf = (s: UiState): string | null => s.uiRings?.community ?? null

/** Sets one saved flag of the view; arrays toggle `ring` in or out. */
export function setUi<K extends keyof NonNullable<AppState['uiRings']>>(s: UiState & { uiRings?: AppState['uiRings'] }, key: K, value: NonNullable<AppState['uiRings']>[K]): void {
  s.uiRings = { ...s.uiRings, [key]: value }
}
export function toggleRing(s: UiState & { uiRings?: AppState['uiRings'] }, key: 'filled' | 'open', ring: Ring): void {
  const now = key === 'filled' ? filledRings(s) : openRings(s)
  setUi(s, key, now.includes(ring) ? now.filter((r) => r !== ring) : [...now, ring])
}

/** Who the rings and lists show: not blocked, not archived, and the ring filter (every ring shown by default). */
export function inZones<P extends Pick<Person, 'ring' | 'fields' | 'ringSuggested' | 'blocked'>>(people: readonly P[], s: UiState): P[] {
  return people.filter((p) => {
    if (isBlocked(p) || isArchived(p)) return false
    const slot = webSlot(p)
    return ringShown(s, slot)
  })
}

/** The zone a person is drawn in: with a community tag picked, acquainted holders of it join the friends and community zone. */
export function zoneFor(p: Pick<Person, 'ring' | 'fields' | 'ringSuggested'>, community: string | null): Ring {
  const slot = webSlot(p)
  return community && slot === Ring.Acquaintance && tagsOf(p, [{ id: community, colour: '#000000' }]).length ? Ring.Friend : slot
}

/** The community tag dropdown: the colour tags flagged `community`; none flagged = every colour tag (guess: the tags are the community nodes). */
export function communityTags(tags: readonly ColourTag[]): ColourTag[] {
  const flagged = tags.filter((t) => t.community === true)
  return flagged.length ? flagged : [...tags]
}

export interface MoveKind { from: Ring; to: Ring; ids: string[] }

/** The zzz suggestions grouped by kind (same ring to the same ring): one tap accepts a person, a second control accepts a whole group. */
export function moveKinds(moves: readonly { person: Pick<Person, 'id' | 'ring'>; to: Ring }[]): MoveKind[] {
  const kinds = new Map<string, MoveKind>()
  for (const m of moves) {
    const key = `${m.person.ring}>${m.to}`
    const k = kinds.get(key) ?? { from: m.person.ring, to: m.to, ids: [] }
    k.ids.push(m.person.id)
    kinds.set(key, k)
  }
  return [...kinds.values()]
}
