/**
 * This device's settings and view choices, in their own localStorage key (never TrustWeb's, never the CRM record):
 * knowledge-management sync options, where fields sit for me, the activity window.
 */
import { host } from './bridge'
import { DEFAULT_ACTIVITY_DAYS } from './person_view'
import { DEV_CLOSE, emptyClose } from './close'
import type { Close } from './close'
import { emptyPlacements } from './placement'
import type { Placements } from './placement'

export const PREFS_KEY = 'trustweb-crm.v1.prefs'

export enum Pkm {
  Tana = 'tana',
  AppleNotes = 'apple-notes',
  Obsidian = 'obsidian-logseq',
}

export const PKMS: readonly Pkm[] = [Pkm.Tana, Pkm.AppleNotes, Pkm.Obsidian]

export interface Filters {
  hideDeceased: boolean
  hideFamous: boolean
  onlyConnection: boolean
  /** Show only people close to me (Settings > Close to me). */
  onlyClose: boolean
  /** All must hold (AND): the field's text contains `text`, case-insensitive. */
  rules: { key: string; text: string }[]
}

export interface Prefs {
  filters: Filters
  /** Field placement "for me". */
  placement: Placements
  close: Close
  /** Networks a placement edit goes to; empty = for me. */
  scope: string[]
  /** Order of the fields in a ring chooser's advanced list (drag to reorder); unknown ids keep schema order after these. */
  advancedOrder: string[]
  /** Systems my people sync with; none by default. */
  pkms: Pkm[]
  /** A connected person counts as active (filled circle) if something happened within this many days. */
  activityDays: number
  /** Light theme chosen in Settings; dark is the default, whatever the OS theme is. */
  light: boolean
  /** Sync an edit 2 s after it was entered. */
  autoSync: boolean
  /** Tana API token: this device only, never part of the CRM record. */
  token: string
  workspaceId: string
  /** Tana node new people are created under; empty = today's day node. */
  parentNodeId: string
  /** Edits waiting for Tana: coalesced per person and field; the value is read at sync time. `append` = one line to add to a multi-line field (notes), never coalesced. */
  queue: { personId: string; key: string; append?: string; into?: string; rename?: { from: string; to: string } }[]
  /** People whose suggested family tag / desire were queued for Tana once. */
  suggestedQueued: string[]
  /** People whose suggested ring was queued for Tana once (approved [ ]). */
  ringQueued: string[]
  /** Tana node ids of people created from TrustWeb. */
  nodeIds: Record<string, string>
  log: string[]
}

function load(): Prefs {
  const base: Prefs = { placement: emptyPlacements(), close: emptyClose(), scope: [], advancedOrder: [], pkms: [], activityDays: DEFAULT_ACTIVITY_DAYS,
    filters: { hideDeceased: true, hideFamous: true, onlyConnection: false, onlyClose: false, rules: [] }, light: false, autoSync: false, token: '', workspaceId: '', parentNodeId: '', queue: [], suggestedQueued: [], ringQueued: [], nodeIds: {}, log: [] }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    const first = saved.pkms === undefined
    // Developer's own device (dev server with TW_CRM_TANA_TOKEN): Tana sync preloaded ON until the choice was saved once.
    const preload = first && __TW_TANA_TOKEN__ ? { pkms: [Pkm.Tana], token: __TW_TANA_TOKEN__, autoSync: true } : {}
    // Same dev path: Jakob's "Close to me" set until he saved his own.
    const near = saved.close === undefined && __TW_RECORD__ ? { close: DEV_CLOSE } : {}
    return { ...base, ...preload, ...near, ...saved, filters: { ...base.filters, ...saved.filters }, placement: { ...base.placement, ...saved.placement } }
  } catch {
    return base
  }
}

export const prefs: Prefs = $state(load())

export function applyTheme(): void {
  (host.root ?? document.documentElement).dataset.theme = prefs.light ? 'light' : 'dark'
}
applyTheme()

export function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* browser refused: kept in memory */ }
}

export const tanaOn = (): boolean => prefs.pkms.includes(Pkm.Tana)
