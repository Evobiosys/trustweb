/**
 * This device's settings and view choices, in their own localStorage key (never TrustWeb's, never the CRM record):
 * which fields are mandatory, whether the optional section is open.
 */
import { DEFAULT_MANDATORY } from './fields'

export const PREFS_KEY = 'trustweb-crm.v1.prefs'

export enum Pkm {
  None = 'none',
  AppleNotes = 'apple-notes',
  Tana = 'tana',
}

export const PKMS: readonly Pkm[] = [Pkm.None, Pkm.AppleNotes, Pkm.Tana]

export interface Filters {
  hideDeceased: boolean
  hideFamous: boolean
  onlyConnection: boolean
  /** Field keys shown as lines on the people cards. */
  visible: string[]
  /** All must hold (AND): the field's text contains `text`, case-insensitive. */
  rules: { key: string; text: string }[]
}

export interface Prefs {
  filters: Filters
  mandatory: string[]
  optionalOpen: boolean
  pkm: Pkm
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
  const base: Prefs = { mandatory: [...DEFAULT_MANDATORY], optionalOpen: false,
    filters: { hideDeceased: true, hideFamous: true, onlyConnection: false, visible: [], rules: [] }, pkm: Pkm.None, autoSync: false, token: '', workspaceId: '', parentNodeId: '', queue: [], nodeIds: {}, log: [] }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { ...base, ...saved, filters: { ...base.filters, ...saved.filters } }
  } catch {
    return base
  }
}

export const prefs: Prefs = $state(load())

export function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* browser refused: kept in memory */ }
}
