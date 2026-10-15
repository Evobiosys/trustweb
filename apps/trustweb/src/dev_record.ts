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

/** Cheap content stamp of the seed text (FNV-1a 32 bit), remembered per origin so a changed seed file is noticed. */
function stamp(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16) + ':' + text.length
}

/**
 * Stores the dev record as this origin's record when none is there yet, when the one there carries demo people (an earlier "add demo
 * friends"), or when the seed file changed since it was last applied (Jakob 2026-10-15: the seed is regenerated from Tana, so it wins);
 * the record it replaces is kept under <key>.before-seed. Call before the first loadState.
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
      localStorage.setItem(key, rec.text)
      localStorage.setItem(key + '.seed', now)
    }
  } catch { /* storage blocked: the welcome screen shows as usual */ }
}
