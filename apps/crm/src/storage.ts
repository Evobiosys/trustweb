/**
 * Where the CRM's data comes from and where its own records go.
 *
 * TrustWeb's record: READ ONLY in this skeleton. On the same origin (the live
 * app sits at app.idea2.site/trustweb/, this one would sit at
 * app.idea2.site/crm/) the CRM reads TrustWeb's localStorage key
 * `trustweb.v1.me` directly (store.ts PREFIX + persona 'me'), so the contact
 * list is the same people with no copy and no sync. The CRM never writes that
 * key: TrustWeb keeps its state in memory and saves the whole object on every
 * change, so a write from a second page would be overwritten the next time
 * TrustWeb saves. Write-back is an open design point (the report lists it).
 *
 * The CRM's own records: its own key, `trustweb-crm.v1.<persona>`, never a
 * key another app on the origin owns. Nothing here touches the network.
 *
 * Fallbacks, in order: TrustWeb's record on this origin; a file the person
 * imported (a decrypted backup payload `{ v, at, data }` or a bare AppState);
 * the fictional sample set, so the app always has something to show.
 */
import type { AppState } from '../../trustweb/src/model'
import { host } from './bridge'
import { emptyCrm, isAppState, isCrmState } from './model'
import type { CrmState } from './model'

export const TRUSTWEB_KEY = 'trustweb.v1.me'
export const CRM_PREFIX = 'trustweb-crm.v1.'
export const IMPORT_KEY = CRM_PREFIX + 'import'
const PERSONA_RE = /^[a-z0-9-]{1,24}$/

export enum Source {
  TrustWeb = 'trustweb',
  Imported = 'imported',
  /** Dev server started with TW_CRM_RECORD: that file is the record. */
  Record = 'record',
  Sample = 'sample',
}

export function crmKey(persona: string): string {
  return CRM_PREFIX + (PERSONA_RE.test(persona) ? persona : 'me')
}

function getItem(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function setItem(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true } catch { return false }
}

function parse(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** TrustWeb's own record on this origin, if the browser has one. */
export function readTrustWeb(): AppState | null {
  const s = host.record ? host.record() : parse(getItem(TRUSTWEB_KEY))
  return isAppState(s) ? s : null
}

/**
 * An export the person chose: either the backup payload TrustWeb encrypts
 * (`{ v, at, data: AppState }`, see backup.ts backupNow) once decrypted, or a
 * bare AppState. Anything else is refused.
 */
export function parseImport(text: string): AppState | null {
  const x = parse(text)
  if (isAppState(x)) return x
  if (x && typeof x === 'object' && 'data' in x && isAppState((x as { data: unknown }).data)) {
    return (x as { data: AppState }).data
  }
  return null
}

export function readImported(): AppState | null {
  const s = parse(getItem(IMPORT_KEY))
  return isAppState(s) ? s : null
}

export function saveImported(app: AppState): boolean {
  return setItem(IMPORT_KEY, JSON.stringify(app))
}

export function clearImported(): void {
  try { localStorage.removeItem(IMPORT_KEY) } catch { /* nothing stored */ }
}

export function loadCrm(persona: string): CrmState {
  const s = parse(getItem(crmKey(persona)))
  return isCrmState(s) ? s : emptyCrm()
}

export function saveCrm(persona: string, crm: CrmState): boolean {
  return setItem(crmKey(persona), JSON.stringify(crm))
}
