/**
 * Local persistence, namespaced so this app never reads or writes another
 * app's keys on the shared app.idea2.site origin (apps/demo's IndexedDB
 * 'wot-demo', its 'wot.lang', mobile-ui's 'resource-web.*'). Every key this
 * app owns starts with "trustweb.v1.", one record per persona, so the solo
 * split view's two phones ("holder" and "seeker") keep two separate
 * identities in one browser.
 *
 * localStorage, not IndexedDB: the whole state is a few kilobytes. A browser
 * that blocks storage falls back to memory for the visit, and the UI says so.
 */
import type { AppState } from './model'

const PREFIX = 'trustweb.v1.'
const PERSONA_RE = /^[a-z0-9-]{1,24}$/

let memory: string | null = null
let ephemeral = false

export function storageKey(persona: string): string {
  return PREFIX + (PERSONA_RE.test(persona) ? persona : 'me')
}

export function isEphemeral(): boolean {
  return ephemeral
}

export function loadState(persona: string): AppState | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(storageKey(persona))
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

export function saveState(persona: string, s: AppState): void {
  const raw = JSON.stringify(s)
  try {
    localStorage.setItem(storageKey(persona), raw)
  } catch {
    ephemeral = true
    memory = raw
  }
}

/** Removes only this app's own record for one persona, never localStorage.clear(). */
export function clearState(persona: string): void {
  memory = null
  try { localStorage.removeItem(storageKey(persona)) } catch { /* nothing stored */ }
}
