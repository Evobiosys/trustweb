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

export interface Prefs {
  mandatory: string[]
  optionalOpen: boolean
  pkm: Pkm
  autoSync: boolean
  /** Tana API token: this device only, never part of the CRM record. */
  token: string
  workspaceId: string
  /** Tana node new people are created under; empty = today's day node. */
  parentNodeId: string
}

function load(): Prefs {
  const base: Prefs = { mandatory: [...DEFAULT_MANDATORY], optionalOpen: false, pkm: Pkm.None, autoSync: false, token: '', workspaceId: '', parentNodeId: '' }
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return base
  }
}

export const prefs: Prefs = $state(load())

export function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* browser refused: kept in memory */ }
}
