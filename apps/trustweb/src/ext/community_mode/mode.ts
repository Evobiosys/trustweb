// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 community-mode: the whole-app interface switch (Personal | Community), its default per profile, the "you are at an event"
 * suggestion, the Community bottom row and the layouts a user saves as their own version. Pure, no DOM.
 * The module's slice of the record is `AppState.extData['community-mode']` (ModeData); the interface picked in this session is kept
 * by the host (sessionStorage), the default lives in `AppState.twSettings.interfaces`.
 */
import { localDay } from '../../engagement'
import type { TwEvent } from '../../model'
import type { ProfileId, TwSettings, UiInterface } from '../profiles'
import { profileOf } from '../profiles'

export const MODE_ID = 'community-mode'

export const COMM_ITEMS = ['home', 'spaces', 'events', 'members', 'docs', 'chat', 'web'] as const
export type CommItem = (typeof COMM_ITEMS)[number]
export const DEFAULT_ITEMS: readonly CommItem[] = COMM_ITEMS
/** The bottom-row glyph of each item (names in icons.ts). */
export const COMM_ICON: Record<CommItem, string> = { home: 'feed', spaces: 'stones', events: 'calendar', members: 'users', docs: 'inventory', chat: 'chat', web: 'web' }

export interface Version { id: string; name: string; items: CommItem[] }
export interface ModeData {
  /** The Community bottom row now (absent = every item). */
  items?: CommItem[]
  /** Event suggestion answers: Never by event id; Not now by event id -> the local day it was answered. */
  suggest?: { never?: string[]; notNow?: Record<string, string> }
  /** Layouts saved as "my version". */
  versions?: Version[]
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isItem = (v: unknown): v is CommItem => (COMM_ITEMS as readonly unknown[]).includes(v)
const itemsOf = (v: unknown): CommItem[] => (Array.isArray(v) ? [...new Set(v.filter(isItem))] : [])

export const parseInterface = (v: unknown): UiInterface | null => (v === 'personal' || v === 'community' ? v : null)

/** This session's pick, else the profile's default, else Personal. */
export function resolveInterface(tw: TwSettings | undefined, picked: unknown): UiInterface {
  return parseInterface(picked) ?? tw?.interfaces?.[profileOf(tw)] ?? 'personal'
}

export function setDefaultInterface(tw: TwSettings | undefined, profile: ProfileId, mode: unknown): TwSettings {
  const m = parseInterface(mode)
  return m ? { ...tw, interfaces: { ...tw?.interfaces, [profile]: m } } : (tw ?? {})
}

/** Every field checked (the slice rides the device sync like any setting); unknown fields dropped. */
export function parseModeData(raw: unknown): ModeData {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const d: ModeData = {}
  const items = itemsOf(o.items)
  if (items.length) d.items = items
  const sg = o.suggest as Record<string, unknown> | undefined
  if (sg && typeof sg === 'object') {
    const never = Array.isArray(sg.never) ? sg.never.filter(isStr) : []
    const notNow = Object.fromEntries(Object.entries(sg.notNow && typeof sg.notNow === 'object' ? sg.notNow : {}).filter((e): e is [string, string] => isStr(e[1])))
    if (never.length || Object.keys(notNow).length) d.suggest = { ...(never.length ? { never } : {}), ...(Object.keys(notNow).length ? { notNow } : {}) }
  }
  if (Array.isArray(o.versions)) {
    const versions = o.versions.flatMap((v): Version[] => {
      const r = v as Record<string, unknown> | null
      const items = itemsOf(r?.items)
      return r && isStr(r.id) && isStr(r.name) && items.length ? [{ id: r.id, name: r.name, items }] : []
    })
    if (versions.length) d.versions = versions
  }
  return d
}

/** Two of my devices: Never answers join, Not now by event, versions by id; the incoming row layout wins. */
export function mergeModeData(mineRaw: unknown, theirsRaw: unknown): ModeData {
  const a = parseModeData(mineRaw)
  const b = parseModeData(theirsRaw)
  const never = [...new Set([...(a.suggest?.never ?? []), ...(b.suggest?.never ?? [])])]
  const notNow = { ...a.suggest?.notNow, ...b.suggest?.notNow }
  const versions = [...new Map([...(a.versions ?? []), ...(b.versions ?? [])].map((v) => [v.id, v])).values()]
  const items = b.items ?? a.items
  return { ...(items ? { items } : {}), ...(never.length || Object.keys(notNow).length ? { suggest: { ...(never.length ? { never } : {}), ...(Object.keys(notNow).length ? { notNow } : {}) } } : {}), ...(versions.length ? { versions } : {}) }
}

export interface SuggestInput {
  mode: UiInterface
  events: readonly TwEvent[] | undefined
  /** The events module's answers (extData['events-view'].rsvp), when that module exists. */
  rsvp: Record<string, string> | undefined
  data: ModeData
  now: number
}

/** The first event I am going to that is on today (any day of its span), not answered with Never or with Not now today; null when in Community already. */
export function suggestForEvent(i: SuggestInput): { id: string; name: string } | null {
  if (i.mode === 'community') return null
  const today = localDay(new Date(i.now))
  const hit = (i.events ?? []).find((e) => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(e.from)) return false
    const from = e.from.slice(0, 10)
    const to = (e.to ?? e.from).slice(0, 10)
    const going = e.attended || i.rsvp?.[e.id] === 'going'
    return going && from <= today && today <= to && !i.data.suggest?.never?.includes(e.id) && i.data.suggest?.notNow?.[e.id] !== today
  })
  return hit ? { id: hit.id, name: hit.name } : null
}

export function dismissSuggestion(d: ModeData, eventId: string, kind: 'later' | 'never', now: number): ModeData {
  const sg = d.suggest ?? {}
  return { ...d, suggest: kind === 'never'
    ? { ...sg, never: [...new Set([...(sg.never ?? []), eventId])] }
    : { ...sg, notNow: { ...sg.notNow, [eventId]: localDay(new Date(now)) } } }
}

/** The Community bottom row: the chosen items in their order (all by default), without the sections the Community module's own menu switched off; Web always stays. */
export function communityBar(d: ModeData, navOff: readonly string[]): CommItem[] {
  const items = d.items?.length ? d.items : DEFAULT_ITEMS
  return items.filter((i) => i === 'web' || !navOff.includes(i))
}

/** An empty or unusable choice falls back to every item. */
export function setItems(d: ModeData, items: readonly unknown[]): ModeData {
  const next = itemsOf(items)
  const { items: _old, ...rest } = d
  return next.length ? { ...rest, items: next } : rest
}

/** Takes an item out of the row, or appends it back; the last item stays. */
export function toggleItem(d: ModeData, item: CommItem): ModeData {
  const row = d.items?.length ? d.items : DEFAULT_ITEMS
  if (!row.includes(item)) return setItems(d, [...row, item])
  return row.length > 1 ? setItems(d, row.filter((i) => i !== item)) : d
}

/** One place left (-1) or right (+1) in the row; at the ends nothing changes. */
export function moveItem(d: ModeData, item: CommItem, dir: -1 | 1): ModeData {
  const row = [...(d.items?.length ? d.items : DEFAULT_ITEMS)]
  const i = row.indexOf(item)
  const j = i + dir
  if (i < 0 || j < 0 || j >= row.length) return setItems(d, row)
  ;[row[i], row[j]] = [row[j], row[i]]
  return setItems(d, row)
}

/** "Save this layout as my version": the row as it is now, under a name; the same id overwrites. */
export function saveVersion(d: ModeData, name: string, id: string): ModeData {
  const v: Version = { id, name: name.trim().slice(0, 40) || 'My version', items: [...(d.items?.length ? d.items : DEFAULT_ITEMS)] }
  return { ...d, versions: [...(d.versions ?? []).filter((x) => x.id !== id), v] }
}

export function restoreVersion(d: ModeData, id: string): ModeData {
  const v = d.versions?.find((x) => x.id === id)
  return v ? { ...d, items: [...v.items] } : d
}

export const removeVersion = (d: ModeData, id: string): ModeData => ({ ...d, versions: (d.versions ?? []).filter((x) => x.id !== id) })
