// The free allowance as pure arithmetic: no I/O, so every edge is unit-testable.
//
// Plan "free" = 10 RECORDINGS of up to 1 hour per person (wave 2, P10: the allowance is counted in recordings, not in gigabytes):
//   the number of recordings is the primary figure (MAX_RECORDINGS, shown as used/limit); declared seconds (36000 in total,
//   3600 per recording) and ciphertext bytes (1 GB per account) stay as guards. The byte guard never binds before the others:
//   10 recordings x 30 MB = 300 MB at most, and the global cap and free-disk floor (hosted_store.mjs) protect the backups.

/** Why a write stopped; each reason maps to one HTTP status in hosted.mjs. */
export const CapReason = Object.freeze({
  Recording: 'recording', // one recording over its byte cap -> 413
  Sanity: 'sanity', // more bytes than the declared seconds can explain -> 400
  Account: 'account', // the account's byte allowance -> 402
  Global: 'global', // the server's hosted-bytes cap or free-disk floor -> 507
})

export const AllowanceReason = Object.freeze({ Seconds: 'seconds', Bytes: 'bytes', Recordings: 'recordings' })

export function planFromConfig(cfg) {
  return Object.freeze({
    name: 'free',
    secondsLimit: cfg.accountSecondsLimit,
    bytesLimit: cfg.accountBytesLimit,
    maxSecondsPerRecording: cfg.maxRecSeconds,
    maxBytesPerRecording: cfg.maxRecBytes,
    maxRecordings: cfg.maxRecordings, // THE allowance: recordings per account (also the `limit` of the usage body)
    sanityBytesPerSecond: cfg.sanityBytesPerSecond,
  })
}

/** recs: [{id, seconds, bytes}] -> totals. */
export function usageOf(recs) {
  let seconds = 0
  let bytes = 0
  for (const r of recs) {
    seconds += r.seconds
    bytes += r.bytes
  }
  return { seconds, bytes, count: recs.length }
}

/** Bytes a recording of `seconds` may plausibly occupy (128 kbps by default, plus slack for headers). */
export function sanityBytes(plan, seconds) {
  return seconds * plan.sanityBytesPerSecond + 65536
}

/**
 * Pre-stream check with what is already known (the recording count, the declared seconds).
 * Returns null when the write may start, else {reason}. A write to an existing id replaces it: its seconds and bytes
 * are freed first, and it never counts against the recording limit (an account above the limit, e.g. from before the
 * limit was lowered, can still replace what it holds; it just cannot add).
 */
export function checkBeforeWrite(plan, recs, id, seconds) {
  const others = recs.filter((r) => r.id !== id)
  const usage = usageOf(others)
  const replacing = others.length !== recs.length
  if (!replacing && recs.length >= plan.maxRecordings) return { reason: AllowanceReason.Recordings }
  if (usage.seconds + seconds > plan.secondsLimit) return { reason: AllowanceReason.Seconds }
  if (usage.bytes >= plan.bytesLimit) return { reason: AllowanceReason.Bytes }
  return null
}

/**
 * The hard byte cut-off for a streaming write: the smallest of every cap, and which cap it was.
 * globalRemaining = bytes the server may still take (hosted cap, reservations, disk floor).
 */
export function writeCap(plan, recs, id, seconds, globalRemaining) {
  const usage = usageOf(recs.filter((r) => r.id !== id))
  const candidates = [
    { reason: CapReason.Recording, bytes: plan.maxBytesPerRecording },
    { reason: CapReason.Sanity, bytes: sanityBytes(plan, seconds) },
    { reason: CapReason.Account, bytes: plan.bytesLimit - usage.bytes },
    // a replace may grow into the room the old version frees
    { reason: CapReason.Global, bytes: globalRemaining + (recs.find((r) => r.id === id)?.bytes ?? 0) },
  ]
  return candidates.reduce((min, c) => (c.bytes < min.bytes ? c : min))
}

/** Body of GET /hosted/<account>/usage and of the 402 answer. */
export function usageBody(plan, recs, transcribedSeconds) {
  const usage = usageOf(recs)
  return {
    plan: plan.name,
    used: usage.count, // recordings held (wave 2, P10); hours come from secondsUsed / secondsLimit
    limit: plan.maxRecordings,
    secondsUsed: usage.seconds,
    secondsLimit: plan.secondsLimit,
    bytesUsed: usage.bytes,
    bytesLimit: plan.bytesLimit,
    recordings: usage.count,
    maxRecordings: plan.maxRecordings,
    maxSecondsPerRecording: plan.maxSecondsPerRecording,
    maxBytesPerRecording: plan.maxBytesPerRecording,
    transcription: { secondsUsed: transcribedSeconds, secondsLimit: plan.secondsLimit },
  }
}

/**
 * Seconds charged for one transcription: the declared duration, but never less than what the bytes
 * imply at 48 kbps (6000 B/s). A lying "1 s" for a 20 MB file is charged as ~3333 s.
 */
export function transcribeCharge(declaredSeconds, bytes, bytesPerSecondFloor = 6000) {
  return Math.max(declaredSeconds, Math.ceil(bytes / bytesPerSecondFloor))
}
