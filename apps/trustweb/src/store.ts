/**
 * Local persistence, namespaced so this app never reads or writes another
 * app's keys on the shared app.idea2.site origin (apps/demo's IndexedDB
 * 'wot-demo', its 'wot.lang', mobile-ui's 'resource-web.*'). Every key this
 * app owns starts with "trustweb.v1.", one record per persona, so the solo
 * split view's two phones ("holder" and "seeker") keep two separate
 * identities in one browser.
 *
 * `context` (seed.ts DemoContext: generic/emergent/ea) is OPTIONAL and only
 * ever passed by the solo split view. Passing it adds a namespace segment so
 * the three demo contexts, which all live under the one app.idea2.site
 * origin, never read or reseed each other's localStorage record. Omitting
 * it (undefined) keeps the original key shape (`trustweb.v1.<persona>`) --
 * load-bearing, not just tidy: a real visitor using TrustWeb on their own
 * phone at the app root (persona 'me', never solo) must keep reading the
 * same key it always has, or an unrelated deploy silently wipes their notes,
 * peers and relay identity on next visit.
 *
 * localStorage, not IndexedDB: the whole state is a few kilobytes. A browser
 * that blocks storage falls back to memory for the visit, and the UI says so.
 */
import type { AppState } from './model'

const PREFIX = 'trustweb.v1.'
const PERSONA_RE = /^[a-z0-9-]{1,24}$/
const CONTEXT_RE = /^[a-z0-9-]{1,24}$/

let memory: string | null = null
let ephemeral = false

export function storageKey(persona: string, context?: string): string {
  const p = PERSONA_RE.test(persona) ? persona : 'me'
  if (context === undefined) return PREFIX + p
  const c = CONTEXT_RE.test(context) ? context : 'generic'
  return PREFIX + c + '.' + p
}

export function isEphemeral(): boolean {
  return ephemeral
}

export function loadState(persona: string, context?: string): AppState | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(storageKey(persona, context))
  } catch {
    ephemeral = true
    raw = memory
  }
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as AppState
    return s && s.v === 1 && s.me ? s : null
  } catch {
    return null
  }
}

export function saveState(persona: string, s: AppState, context?: string): void {
  const raw = JSON.stringify(s)
  try {
    localStorage.setItem(storageKey(persona, context), raw)
  } catch {
    ephemeral = true
    memory = raw
  }
}

/** Removes only this app's own record for one persona/context, never localStorage.clear(). */
export function clearState(persona: string, context?: string): void {
  memory = null
  try { localStorage.removeItem(storageKey(persona, context)) } catch { /* nothing stored */ }
}
