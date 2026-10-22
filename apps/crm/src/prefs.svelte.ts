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
import { TabbarMode, tabbarMode } from './tabbar'

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
  /** Sources (trustweb sources.ts: tana, local) whose people are hidden when NOTHING else knows them (Jakob 2026-10-16). */
  hideSources: string[]
  /** Communities (a note's `trustweb-community`, lines tagged community) whose people are hidden when they are in no other community. */
  hideCommunities: string[]
}

/** The sync option a hideable source belongs to; Apple Notes has no import yet. */
export const PKM_SOURCE: Partial<Record<Pkm, string>> = { [Pkm.Tana]: 'tana', [Pkm.Obsidian]: 'local' }

export interface Prefs {
  filters: Filters
  /** Field placement "for me". */
  placement: Placements
  close: Close
  /** Networks a placement edit goes to; empty = for me. */
  scope: string[]
  /** Order of the fields in a ring chooser's advanced list (drag to reorder); unknown ids keep schema order after these. */
  advancedOrder: string[]
  /** People list: the order I dragged each ring section into (ring id -> person ids), this device. */
  customOrder: Record<string, string[]>
  /** Systems my people sync with; none by default. */
  pkms: Pkm[]
  /** Advanced settings on: networks I admin (Curate, field scope) and the Pipeline tab. Off = the simple version (Jakob 2026-10-16). */
  advanced: boolean
  /** The bottom tab bar: always shown, slides away until the pointer reaches the bottom edge, or hidden. */
  tabbar: TabbarMode
  /** The system everyone lives in (Jakob 2026-10-16: "everyone should be in Tana"); the others get only the people they already mention. Empty: none declared. */
  truth: Pkm | ''
  /** The notes bridge (scripts/notes_bridge.mjs) this computer runs, and its token (stays on this device). */
  notesUrl: string
  notesToken: string
  notesAutoSync: boolean
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
  queue: { personId: string; key: string; approved?: boolean; append?: string; into?: string; rename?: { from: string; to: string } }[]
  /** People whose suggested family tag / desire were queued for Tana once. */
  suggestedQueued: string[]
  /** People whose suggested ring was queued for Tana once (approved [ ]). */
  ringQueued: string[]
  /** Tana node ids of people created from TrustWeb. */
  nodeIds: Record<string, string>
  log: string[]
}

function load(): Prefs {
  const base: Prefs = { placement: emptyPlacements(), close: emptyClose(), scope: [], advancedOrder: [], customOrder: {}, pkms: [], advanced: false, tabbar: TabbarMode.Always, truth: '', notesUrl: 'http://127.0.0.1:8263', notesToken: '', notesAutoSync: true, activityDays: DEFAULT_ACTIVITY_DAYS,
    filters: { hideDeceased: true, hideFamous: true, onlyConnection: false, onlyClose: false, rules: [], hideSources: [], hideCommunities: [] }, light: false, autoSync: false, token: '', workspaceId: '', parentNodeId: '', queue: [], suggestedQueued: [], ringQueued: [], nodeIds: {}, log: [] }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    const first = saved.pkms === undefined
    // Developer's own device (dev server with TW_CRM_TANA_TOKEN): Tana sync preloaded ON until the choice was saved once.
    const preload = first && __TW_TANA_TOKEN__ ? { pkms: [Pkm.Tana], token: __TW_TANA_TOKEN__, autoSync: true } : {}

    // Same dev path: Jakob's "Close to me" set until he saved his own.
    const near = saved.close === undefined && __TW_RECORD__ ? { close: DEV_CLOSE } : {}
    const merged = { ...base, ...preload, ...near, ...saved, filters: { ...base.filters, ...saved.filters }, placement: { ...base.placement, ...saved.placement }, tabbar: tabbarMode(saved.tabbar) }
    // Same dev path for the notes bridge: its token read from ~/.config/trustweb/notes-bridge.json by the dev server (vite define), until the developer saved one.
    if (__TW_NOTES_TOKEN__ && saved.notesToken === undefined) {
      merged.notesToken = __TW_NOTES_TOKEN__
      if (!merged.pkms.includes(Pkm.Obsidian)) merged.pkms = [...merged.pkms, Pkm.Obsidian]
      if (!merged.truth && merged.pkms.includes(Pkm.Tana)) merged.truth = Pkm.Tana
    }
    return merged
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
