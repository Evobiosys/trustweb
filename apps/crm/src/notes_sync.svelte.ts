/**
 * Two-way sync with the notes vault through the notes bridge (scripts/notes_bridge.mjs, loopback, token) (Jakob 2026-10-16).
 * Push: every person as they are now -> a marked block in the note where they were found (the bridge decides where).
 * Pull: what the vault says that the record does not -> ring (newer wins, judged by the bridge) and added bullets as new lines.
 * "Sync now" does pull then push; auto-sync does the same 2 s after the last edit.
 */
import { host } from './bridge'
import { dayKey } from './dates'
import { applyChanges, peoplePayload } from './notes_client'
import type { Change, PushResult } from './notes_client'
import { Pkm, prefs, savePrefs } from './prefs.svelte'
import { RING_KEY } from './rings'
import { store } from './state.svelte'
import { saveField } from './sync.svelte'

export const notes = $state({ running: false, last: '' })
const DEBOUNCE_MS = 400
const POLL_MS = 2000
const MAX_LOG = 100
let timer: ReturnType<typeof setTimeout> | undefined

export const notesOn = (): boolean => prefs.pkms.includes(Pkm.Obsidian)

function log(text: string): void {
  notes.last = text
  prefs.log = [`${new Date().toTimeString().slice(0, 8)} notes: ${text}`, ...prefs.log].slice(0, MAX_LOG)
  savePrefs()
}

async function call<T>(route: string, body: unknown): Promise<T> {
  const r = await fetch(`${prefs.notesUrl.replace(/\/$/, '')}${route}`, {
    method: 'POST', headers: { Authorization: `Bearer ${prefs.notesToken.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`bridge answered HTTP ${r.status}`)
  return r.json() as Promise<T>
}

/** Pull (vault -> record), then push (record -> vault). `everyone` also writes one page per person (one shot). */
export async function syncNotes(everyone = false): Promise<void> {
  if (notes.running || !notesOn()) return
  notes.running = true
  try {
    const people = peoplePayload(store.app.people, store.crm.personFields, store.crm.interactions)
    const { changes } = await call<{ changes: Change[] }>('/changes', { people })
    const applied = applyChanges(changes, people, {
      setRing: (id, ring) => saveField(id, RING_KEY, ring),
      addLine: (id, line) => {
        host.addLine?.(id, line)
        store.app.people.find((p) => p.id === id)?.lines.push(line)
      },
      now: () => Date.now(),
      newId: () => `vault-${dayKey(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
    })
    const r = await call<PushResult>('/push', { people: peoplePayload(store.app.people, store.crm.personFields, store.crm.interactions), everyone })
    log(`${applied.rings} ring(s) and ${applied.lines} line(s) from the vault; ${r.written} written, ${r.unchanged} unchanged, ${r.noHome} without a note${everyone ? `, ${r.pages} page(s)` : ''}${r.errors.length ? `; ${r.errors.join('; ')}` : ''}`)
  } catch (e) {
    log(`bridge not reachable (${e instanceof Error ? e.message : String(e)})`)
  } finally {
    notes.running = false
  }
}

/** An edit happened: with auto-sync on, the vault hears about it 2 s after the last one. */
export function notesTouched(): void {
  if (!notesOn() || !prefs.notesAutoSync) return
  clearTimeout(timer)
  timer = setTimeout(() => { timer = undefined; void syncNotes() }, DEBOUNCE_MS)
}

/** The bridge watches the vault; while auto-sync is on, a file saved there is pulled within POLL_MS (a saved file, not an unsaved editor buffer). */
let seenStamp = 0
async function pollVault(): Promise<void> {
  if (!notesOn() || !prefs.notesAutoSync || notes.running) return
  try {
    const r = await fetch(`${prefs.notesUrl.replace(/\/$/, '')}/status`, { headers: { Authorization: `Bearer ${prefs.notesToken.trim()}` } })
    if (!r.ok) return
    const { changedAt } = await r.json() as { changedAt?: number }
    if (typeof changedAt === 'number' && changedAt > seenStamp) { seenStamp = changedAt; await syncNotes() }
  } catch { /* bridge away: the next tick tries again */ }
}

if (typeof window !== 'undefined') {
  if (prefs.notesAutoSync && notesOn()) void syncNotes()
  setInterval(() => { void pollVault() }, POLL_MS)
}
