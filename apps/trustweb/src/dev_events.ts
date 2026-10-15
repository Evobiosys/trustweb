/**
 * Dev only (Jakob 2026-10-15: "make sure to remember the events that I have created"): every preview port is its own origin and the seed
 * replaces the stored record when it changes, so events would vanish. They are kept in dev-events.json next to the seed file
 * (vite.config.mjs, POST /__tw/events); the define is the literal null in a build, so none of this reaches a bundle.
 */
import type { AppState, TwEvent } from './model'

export interface DevEvents {
  events: TwEvent[]
  /** Per-person event tags, by person id. */
  people: Record<string, string[]>
}

declare const __TW_DEV_EVENTS__: DevEvents | null | undefined

/** The side file's content at serve start (empty while absent), else null (stock twin, no dev record, build). */
export function devEventsFile(): DevEvents | null {
  return typeof __TW_DEV_EVENTS__ === 'undefined' ? null : __TW_DEV_EVENTS__
}

/** Only events and the per-person tags of a record; never the rest of it. */
export function pickDevEvents(s: AppState): DevEvents {
  const people: Record<string, string[]> = {}
  for (const p of s.people ?? []) if (p.events?.length) people[p.id] = p.events
  return { events: s.events ?? [], people }
}

/** Adds the events the state lacks and the tags of people the state has; true when something changed. */
export function mergeDevEvents(s: AppState, file: DevEvents): boolean {
  let changed = false
  const known = new Set((s.events ?? []).map((e) => e.id))
  for (const e of file.events ?? []) {
    if (known.has(e.id)) continue
    s.events = [...(s.events ?? []), e]
    known.add(e.id)
    changed = true
  }
  for (const p of s.people ?? []) {
    for (const id of file.people?.[p.id] ?? []) {
      if (p.events?.includes(id)) continue
      p.events = [...(p.events ?? []), id]
      changed = true
    }
  }
  return changed
}

let pushed = ''
let timer: ReturnType<typeof setTimeout> | undefined
let warned = false

/** Debounced 1 s: posts events and tags to the dev server when they changed since the last post. Fire and forget. */
export function pushDevEvents(s: AppState): void {
  if (typeof __TW_DEV_EVENTS__ === 'undefined' || !__TW_DEV_EVENTS__) return
  const body = JSON.stringify(pickDevEvents(s))
  if (body === pushed) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    pushed = body
    fetch('/__tw/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then((r) => {
      if (!r.ok) throw new Error(String(r.status))
    }).catch(() => {
      if (!warned) console.warn('dev events: could not be saved to dev-events.json')
      warned = true
    })
  }, 1000)
}
