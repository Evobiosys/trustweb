/**
 * The caps on recordings kept on this phone (audio_store.ts), as a pure rule
 * so it is unit-tested as the app runs it: at most MAX_RECORDINGS recordings
 * and MAX_BYTES in all; the oldest audio goes first until both hold.
 */

/** 20 recordings. */
export const MAX_RECORDINGS = 20
/** 300 MB: about 20 hours at the 32 kbit/s the recorder asks for (about 14.4 MB per hour). */
export const MAX_BYTES = 300 * 1024 * 1024

export interface AudioEntry {
  id: string
  savedAt: number
  bytes: number
}

/** The ids whose audio to drop, oldest first, so that what stays is within both caps. */
export function clampAudioPlan(entries: readonly AudioEntry[], maxCount: number = MAX_RECORDINGS, maxBytes: number = MAX_BYTES): string[] {
  const oldestFirst = [...entries].sort((a, b) => a.savedAt - b.savedAt)
  let count = oldestFirst.length
  let bytes = oldestFirst.reduce((n, e) => n + e.bytes, 0)
  const drop: string[] = []
  for (const e of oldestFirst) {
    if (count <= maxCount && bytes <= maxBytes) break
    drop.push(e.id)
    count--
    bytes -= e.bytes
  }
  return drop
}

/** "4.2 MB", for the Settings line. */
export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
