// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Personal previews share one record (Jakob 2026-11-07: "changes I manually make in one personal preview are carried over to the
 * other"). Every preview port is its own origin with its own localStorage, so a save is also posted to the dev server
 * (vite_dev_record.mjs, ~/.cache/trustweb-dev/dev-record.live.json) and a booting preview takes that file when it is newer than the
 * time this origin last posted or took it. vite.config.mjs defines __TW_DEV_LIVE__ true only for `vite serve` with a dev record and
 * without TW_STOCK; everywhere else it is absent/null and none of this runs.
 */
import type { AppState } from './model'
import { parseRecord, storageKey } from './store'

declare const __TW_DEV_LIVE__: boolean | null | undefined

const PATH = '/__tw/dev-record'
const AT_HEADER = 'X-TW-Live-At'
const BASE_HEADER = 'X-TW-Live-Base'
const DEBOUNCE_MS = 2000

/** True in a personal preview (not stock, not a build). */
export const liveDevActive = (): boolean => typeof __TW_DEV_LIVE__ !== 'undefined' && __TW_DEV_LIVE__ === true
const atKey = (persona: string): string => storageKey(persona) + '.live-at'
const readAt = (persona: string): number | null => { try { return Number(localStorage.getItem(atKey(persona))) || null } catch { return null } }
const writeAt = (persona: string, at: number): void => { try { localStorage.setItem(atKey(persona), String(at)) } catch { /* storage blocked */ } }

/** Newer wins: the live file replaces this origin's record when this origin never synced or the file is newer than its last sync. */
export function liveIsNewer(fileAt: number, localAt: number | null): boolean {
  return fileAt > 0 && (localAt === null || fileAt > localAt)
}

/** "synced HH:MM" source for Settings > Advanced: the time of this origin's last sync with the live file, or null. */
export function liveSyncedAt(persona: string): Date | null {
  const at = liveDevActive() ? readAt(persona) : null
  return at ? new Date(at) : null
}

/** Set once the boot-time check has finished; pushes wait for it so a stale record never overwrites a newer live file. */
let ready: Promise<boolean> = Promise.resolve(true)

/**
 * Boot check: takes the live file when it is newer (the replaced record stays under <key>.before-live). Resolves true when the stored
 * record changed, so the caller reloads into it. A 404 or failed fetch changes nothing.
 */
export function seedLiveDevRecord(persona: string, deps: { fetch: typeof fetch } = { fetch: (...a) => fetch(...a) }): Promise<boolean> {
  if (!liveDevActive()) return Promise.resolve(false)
  ready = check(persona, deps)
  return ready
}

async function check(persona: string, deps: { fetch: typeof fetch }): Promise<boolean> {
  let r: Response
  try { r = await deps.fetch(PATH, { cache: 'no-store' }) } catch { return false }
  if (!r.ok) return false
  const at = Number(r.headers.get(AT_HEADER))
  const text = await r.text()
  if (!liveIsNewer(at, readAt(persona)) || !parseRecord(text)) return false
  try {
    const key = storageKey(persona)
    const had = localStorage.getItem(key)
    if (had !== null && had !== text) localStorage.setItem(key + '.before-live', had)
    localStorage.setItem(key, text)
  } catch { return false }
  writeAt(persona, at)
  return true
}

let timer: ReturnType<typeof setTimeout> | undefined
let warned = false
/** Another preview posted a newer record since this tab last synced (409): this tab stops sharing; its next boot takes the newer one and keeps its own as <key>.before-live. */
let stale = false
/** Posts run one after another, so a second save never carries a base older than this tab's own previous post. */
let posting: Promise<unknown> = Promise.resolve()

/** Debounced 2 s: posts the record to the dev server after a save, once the boot check is done and did not replace it. Fire and forget. */
export function pushLiveDevRecord(persona: string, s: AppState): void {
  if (!liveDevActive()) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    const body = JSON.stringify(s)
    posting = posting.then(() => ready).then((replaced) => {
      if (replaced || stale) return
      return fetch(PATH, { method: 'POST', headers: { 'Content-Type': 'application/json', [BASE_HEADER]: String(readAt(persona) ?? 0) }, body }).then(async (r) => {
        if (r.status === 409) { stale = true; console.warn('dev record: another personal preview saved a newer record; this tab no longer shares (reload to take it)'); return }
        if (!r.ok) throw new Error(String(r.status))
        const at = Number(r.headers.get(AT_HEADER))
        if (at) writeAt(persona, at)
      })
    }).catch(() => {
      if (!warned) console.warn('dev record: could not be shared through dev-record.live.json')
      warned = true
    })
  }, DEBOUNCE_MS)
}
