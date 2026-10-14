/**
 * This device's settings and view choices, in their own localStorage key (never TrustWeb's, never the CRM record):
 * which fields are mandatory, whether the optional section is open.
 */
import { DEFAULT_MANDATORY } from './fields'

export const PREFS_KEY = 'trustweb-crm.v1.prefs'

export interface Prefs {
  mandatory: string[]
  optionalOpen: boolean
}

function load(): Prefs {
  const base: Prefs = { mandatory: [...DEFAULT_MANDATORY], optionalOpen: false }
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
