/**
 * Dev-only seed (Jakob 2026-10-14): a local preview port is a fresh origin, so it would open on the welcome screen.
 * vite.config.mjs `define`s __TW_DEV_RECORD__ only for `vite serve` with TW_DEV_RECORD set (scripts/tw_dev.sh); in
 * every build it is null, so this code and the record never reach a bundle. File-only: the record lives outside the repo.
 */
import { mergeDevEvents, pickDevEvents } from './dev_events'
import type { AppState } from './model'
import { parseRecord, storageKey } from './store'

declare const __TW_DEV_RECORD__: { file: string; text: string } | null | undefined

function devRecord(): { file: string; text: string } | null {
  return typeof __TW_DEV_RECORD__ === 'undefined' ? null : __TW_DEV_RECORD__
}

/** The seed file's name while a dev record is in play, else null (About sheet banner). */
export function devRecordFile(): string | null {
  return devRecord()?.file ?? null
}

/** Cheap content stamp of the seed text (FNV-1a 32 bit), remembered per origin so a changed seed file is noticed. */
function stamp(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16) + ':' + text.length
}

/** The seed text with the events and tags of the record it replaces merged on top; the seed text itself where there is nothing to keep. */
function withKeptEvents(seed: string, replaced: string | null): string {
  const old = replaced === null ? null : parseRecord(replaced)
  const next = parseRecord(seed)
  if (!old || !next) return seed
  const events = mergeDevEvents(next, pickDevEvents(old))
  const placed = keepPlacements(next, old)
  return events || placed ? JSON.stringify(next) : seed
}

/**
 * A re-applied seed never moves what the phone placed (Jakob 2026-10-16: "if there is a fight, TrustWeb stays as is"): for every
 * person in both, the stored ring, intending value and dot angle win over the seed's. Returns whether anything was kept.
 */
export function keepPlacements(next: AppState, old: AppState): boolean {
  const was = new Map(old.people.map((p) => [p.id, p]))
  let kept = false
  for (const p of next.people) {
    const o = was.get(p.id)
    if (!o) continue
    if (o.ring !== p.ring) { p.ring = o.ring; delete p.ringSuggested; kept = true }
    if (o.intending && JSON.stringify(o.intending) !== JSON.stringify(p.intending)) { p.intending = o.intending; kept = true }
    if (o.angle !== undefined && o.angle !== p.angle) { p.angle = o.angle; kept = true }
  }
  return kept
}

/**
 * Stores the dev record as this origin's record when none is there yet, when the one there carries demo people (an earlier "add demo
 * friends"), or when the seed file changed since it was last applied (Jakob 2026-10-15: the seed is regenerated from Tana, so it wins);
 * the record it replaces is kept under <key>.before-seed, and its events and per-person event tags carry over onto the new seed. Call before the first loadState.
 */
export function seedDevRecord(persona: string): void {
  const rec = devRecord()
  if (!rec || !parseRecord(rec.text)) return
  try {
    const key = storageKey(persona)
    const had = localStorage.getItem(key)
    const seen = localStorage.getItem(key + '.seed')
    const now = stamp(rec.text)
    if (had === null || parseRecord(had)?.demo || seen !== now) {
      if (had !== null && had !== rec.text) localStorage.setItem(key + '.before-seed', had)
      localStorage.setItem(key, withKeptEvents(rec.text, had))
      localStorage.setItem(key + '.seed', now)
    }
  } catch { /* storage blocked: the welcome screen shows as usual */ }
}
