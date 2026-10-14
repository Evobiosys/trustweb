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
 *
 * A record that is there but cannot be read (damaged JSON, or a shape this
 * build does not know, e.g. saved by a newer build that was rolled back) is
 * NEVER overwritten silently (review-app-a, wave 1733): it is first copied
 * aside, untouched, to `trustweb.unreadable.v1.<persona>[.<context>]`. Where
 * even that copy cannot be written (storage full), this visit never writes
 * that key at all and runs from memory, so the only copy survives.
 */
import { Ring } from './model'
import type { AppState } from './model'

const PREFIX = 'trustweb.v1.'
/** Where an unreadable record is kept aside, untouched (one per key; never read by the app). */
const UNREADABLE_PREFIX = 'trustweb.unreadable.v1.'
const PERSONA_RE = /^[a-z0-9-]{1,24}$/
const CONTEXT_RE = /^[a-z0-9-]{1,24}$/

let memory: string | null = null
let ephemeral = false
/** Keys found holding an unreadable record this visit (kept aside or not). */
const unreadable = new Set<string>()
/** Keys holding an unreadable record that could NOT be kept aside: never written this visit. */
const writeBlocked = new Set<string>()

export function storageKey(persona: string, context?: string): string {
  const p = PERSONA_RE.test(persona) ? persona : 'me'
  if (context === undefined) return PREFIX + p
  const c = CONTEXT_RE.test(context) ? context : 'generic'
  // ea-demo's seed changed 2026-09-27 (demo-edit-3: William MacAskill
  // added). A version segment on that context's key forces a fresh
  // seedState() reseed for any browser that already saved a pre-edit-3
  // ea-demo record, instead of silently keeping the old 6-person list.
  // generic/emergent seeds are unchanged, so their key shape is untouched.
  const seedSuffix = c === 'ea' ? '-2' : ''
  return PREFIX + c + seedSuffix + '.' + p
}

export function isEphemeral(): boolean {
  return ephemeral
}

/** The key an unreadable record of this persona/context is kept aside under. */
export function unreadableKey(persona: string, context?: string): string {
  return UNREADABLE_PREFIX + storageKey(persona, context).slice(PREFIX.length)
}

/** A stored record this build can use: an object at version 1 with an owner. */
export function parseRecord(raw: string): AppState | null {
  try {
    const s = JSON.parse(raw) as AppState | null
    if (!(s && typeof s === 'object' && s.v === 1 && s.me && typeof s.me === 'object')) return null
    // The ring value of the outliner and the CRM spells close_friend; the record keeps 'close'.
    for (const p of [...(s.people ?? []), ...(s.peers ?? [])]) if ((p.ring as string) === 'close_friend') p.ring = Ring.Close
    return s
  } catch {
    return null
  }
}

/** Copies an unreadable record aside, once; false where storage refused the copy. */
function keepAside(persona: string, context: string | undefined, raw: string): boolean {
  const aside = unreadableKey(persona, context)
  try {
    if (localStorage.getItem(aside) !== raw) localStorage.setItem(aside, raw)
    return true
  } catch {
    return false
  }
}

export function loadState(persona: string, context?: string): AppState | null {
  const key = storageKey(persona, context)
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    // Storage blocked: only this visit's own memory copy (always readable) exists.
    ephemeral = true
    return memory ? parseRecord(memory) : null
  }
  if (!raw) return null
  const s = parseRecord(raw)
  if (s) return s
  unreadable.add(key)
  if (!keepAside(persona, context, raw)) writeBlocked.add(key)
  return null
}

/**
 * Was this persona's record there but unreadable this visit? Then nothing may
 * be merged into it without the person (the demo carry-over waits), and the
 * app says it was kept aside.
 */
export function wasUnreadable(persona: string, context?: string): boolean {
  return unreadable.has(storageKey(persona, context))
}

export function saveState(persona: string, s: AppState, context?: string): void {
  const raw = JSON.stringify(s)
  const key = storageKey(persona, context)
  if (writeBlocked.has(key)) {
    ephemeral = true
    memory = raw
    return
  }
  try {
    localStorage.setItem(key, raw)
  } catch {
    ephemeral = true
    memory = raw
  }
}

/**
 * Removes only this app's own record for one persona/context, never
 * localStorage.clear(). "Reset this phone" is the person's explicit choice, so
 * it also lifts a write block; a record kept aside stays kept aside.
 */
export function clearState(persona: string, context?: string): void {
  memory = null
  const key = storageKey(persona, context)
  writeBlocked.delete(key)
  unreadable.delete(key)
  try { localStorage.removeItem(key) } catch { /* nothing stored */ }
}
