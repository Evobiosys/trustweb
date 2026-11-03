/**
 * Two-way sync with the notes vault through the notes bridge (scripts/notes_bridge.mjs, loopback, token) (Jakob 2026-10-16).
 * Push: every person as they are now -> a marked block in the note where they were found (the bridge decides where).
 * Pull: what the vault says that the record does not -> ring (newer wins, judged by the bridge) and added bullets as new lines.
 * "Sync now" does pull then push; auto-sync does the same 2 s after the last edit.
 * Join offers (owner 2026-11-03): after each sync the open offers (a first name alone in a note) are fetched; deciding one is a
 * POST to the bridge (the next scheduled pull honours it), and a join lands right away through applyChanges.
 */
import type { Person } from '../../trustweb/src/model'
import { host } from './bridge'
import { dayKey } from './dates'
import { applyChanges, peoplePayload } from './notes_client'
import type { ApplyHooks, Change, PushResult } from './notes_client'
import { Decision, joinChanges, offerCandidates } from './notes_offers'
import type { Candidate, JoinOffer } from './notes_offers'
import { Pkm, prefs, savePrefs } from './prefs.svelte'
import { store } from './state.svelte'

export const notes = $state({ running: false, last: '', offers: [] as JoinOffer[] })
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

async function get<T>(route: string): Promise<T> {
  const r = await fetch(`${prefs.notesUrl.replace(/\/$/, '')}${route}`, { headers: { Authorization: `Bearer ${prefs.notesToken.trim()}` } })
  if (!r.ok) throw new Error(`bridge answered HTTP ${r.status}`)
  return r.json() as Promise<T>
}

// The host's live record (the Web view's drags and placements), never the Curator's copy taken at mount: a stale copy pushed into the vault
// and pulled back was the fight that moved dots back (Jakob 2026-10-16).
const live = (): readonly Person[] => host.record?.()?.people ?? store.app.people
const livePeople = (): Person[] => peoplePayload(live(), store.crm.personFields, store.crm.interactions)
const hooks: ApplyHooks = {
  addLine: (id, line) => {
    host.addLine?.(id, line)
    store.app.people.find((p) => p.id === id)?.lines.push(line)
  },
  now: () => Date.now(),
  newId: () => `vault-${dayKey(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
}

/** Pull (vault -> record), then push (record -> vault). `everyone` also writes one page per person (one shot). */
export async function syncNotes(everyone = false): Promise<void> {
  if (notes.running || !notesOn()) return
  notes.running = true
  try {
    const people = livePeople()
    const { changes } = await call<{ changes: Change[] }>('/changes', { people })
    const applied = applyChanges(changes, people, hooks)
    const r = await call<PushResult>('/push', { people: livePeople(), everyone })
    log(`${applied.lines} line(s) from the vault; ${r.written} written, ${r.unchanged} unchanged, ${r.noHome} without a note${everyone ? `, ${r.pages} page(s)` : ''}${r.errors.length ? `; ${r.errors.join('; ')}` : ''}`)
    await loadOffers()
  } catch (e) {
    log(`bridge not reachable (${e instanceof Error ? e.message : String(e)})`)
  } finally {
    notes.running = false
  }
}

/** The open join offers from the bridge; a bridge away keeps the list as it was. */
export async function loadOffers(): Promise<void> {
  if (!notesOn()) return
  try {
    const { offers } = await get<{ offers: JoinOffer[]; decided: number }>('/offers')
    notes.offers = Array.isArray(offers) ? offers : []
  } catch { /* bridge away: the next sync tries again */ }
}
export const refreshOffers = loadOffers

/** Each open offer with its candidates recomputed against the live people (the converter's come first and are the default). */
export function offerRows(): { offer: JoinOffer; candidates: Candidate[] }[] {
  const people = livePeople()
  return notes.offers.map((offer) => ({ offer, candidates: offerCandidates(offer, people) }))
}

/** The owner's answer: remembered by the bridge for the next pull; a join also lands now (applyChanges, local provenance). */
export async function decideOffer(key: string, decision: Decision, into?: string): Promise<void> {
  const offer = notes.offers.find((o) => o.key === key)
  if (!offer || (decision === Decision.Join && !into)) return
  try {
    await call<{ ok: boolean }>('/offers', { key, decision, ...(decision === Decision.Join ? { into } : {}) })
    notes.offers = notes.offers.filter((o) => o.key !== key)
    if (decision === Decision.Join && into) {
      const people = livePeople()
      const { lines } = applyChanges([joinChanges(offer, into)], people, hooks)
      log(`"${offer.name}" (${offer.path}) joined ${people.find((p) => p.id === into)?.name ?? into}: ${lines} line(s)`)
      notesTouched()
    } else log(`"${offer.name}" (${offer.path}): nobody here`)
  } catch (e) {
    log(`bridge not reachable (${e instanceof Error ? e.message : String(e)})`)
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
  else void loadOffers()
  setInterval(() => { void pollVault() }, POLL_MS)
}
