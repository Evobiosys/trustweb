/**
 * Dev-only seed (Jakob 2026-10-14): a local preview port is a fresh origin, so it would open on the welcome screen.
 * vite.config.mjs `define`s __TW_DEV_RECORD__ only for `vite serve` with TW_DEV_RECORD set (scripts/tw_dev.sh); in
 * every build it is null, so this code and the record never reach a bundle. File-only: the record lives outside the repo.
 */
import { parseRecord, storageKey } from './store'

declare const __TW_DEV_RECORD__: { file: string; text: string } | null | undefined

function devRecord(): { file: string; text: string } | null {
  return typeof __TW_DEV_RECORD__ === 'undefined' ? null : __TW_DEV_RECORD__
}

/** The seed file's name while a dev record is in play, else null (About sheet banner). */
export function devRecordFile(): string | null {
  return devRecord()?.file ?? null
}

/** Stores the dev record as this origin's record when none is there yet, or when the one there carries demo people (an earlier "add demo friends"): a record preview shows only the record's people. Call before the first loadState. */
export function seedDevRecord(persona: string): void {
  const rec = devRecord()
  if (!rec || !parseRecord(rec.text)) return
  try {
    const key = storageKey(persona)
    const had = localStorage.getItem(key)
    if (had === null || parseRecord(had)?.demo) localStorage.setItem(key, rec.text)
  } catch { /* storage blocked: the welcome screen shows as usual */ }
}
