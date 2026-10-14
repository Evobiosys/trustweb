/**
 * This device's settings and view choices, in their own localStorage key (never TrustWeb's, never the CRM record):
 * knowledge-management sync options, where fields sit for me, the activity window.
 */
import { DEFAULT_ACTIVITY_DAYS } from './person_view'
import { emptyClose } from './close'
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
  /** Systems my people sync with; none by default. */
  pkms: Pkm[]
  /** A connected person counts as active (filled circle) if something happened within this many days. */
  activityDays: number
  /** Sync an edit 2 s after it was entered. */
  autoSync: boolean
  /** Tana API token: this device only, never part of the CRM record. */
  token: string
  workspaceId: string
  /** Tana node new people are created under; empty = today's day node. */
  parentNodeId: string
  /** Edits waiting for Tana: coalesced per person and field; the value is read at sync time. */
  queue: { personId: string; key: string }[]
  /** Tana node ids of people created from TrustWeb. */
  nodeIds: Record<string, string>
  log: string[]
}

function load(): Prefs {
  const base: Prefs = { placement: emptyPlacements(), close: emptyClose(), scope: [], pkms: [], activityDays: DEFAULT_ACTIVITY_DAYS,
    filters: { hideDeceased: true, hideFamous: true, onlyConnection: false, onlyClose: false, rules: [] }, autoSync: false, token: '', workspaceId: '', parentNodeId: '', queue: [], nodeIds: {}, log: [] }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    const first = saved.pkms === undefined
    // Developer's own device (dev server with TW_CRM_TANA_TOKEN): Tana sync preloaded ON until the choice was saved once.
    const preload = first && __TW_TANA_TOKEN__ ? { pkms: [Pkm.Tana], token: __TW_TANA_TOKEN__, autoSync: true } : {}
    return { ...base, ...preload, ...saved, filters: { ...base.filters, ...saved.filters }, placement: { ...base.placement, ...saved.placement } }
  } catch {
    return base
  }
}

export const prefs: Prefs = $state(load())

export function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* browser refused: kept in memory */ }
}

export const tanaOn = (): boolean => prefs.pkms.includes(Pkm.Tana)
