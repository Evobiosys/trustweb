// The free allowance as pure arithmetic: no I/O, so every edge is unit-testable.
//
// Plan "free" = the EQUIVALENT of 10 recordings of 1 hour per person:
//   36000 declared seconds in total, 200 MB of ciphertext in total (the app records speech at
//   32 kbps Opus = 4000 B/s = 14.4 MB/h, so 10 h = 144 MB, plus headroom for container overhead,
//   AES-GCM tags and iOS AAC), one recording at most 3600 s and 30 MB, 50 slots (anti-spam only).

/** Why a write stopped; each reason maps to one HTTP status in hosted.mjs. */
export const CapReason = Object.freeze({
  Recording: 'recording', // one recording over its byte cap -> 413
  Sanity: 'sanity', // more bytes than the declared seconds can explain -> 400
  Account: 'account', // the account's byte allowance -> 402
  Global: 'global', // the server's hosted-bytes cap or free-disk floor -> 507
})

export const AllowanceReason = Object.freeze({ Seconds: 'seconds', Bytes: 'bytes', Slots: 'slots' })

export function planFromConfig(cfg) {
  return Object.freeze({
    name: 'free',
    equivalentRecordings: Math.round(cfg.accountSecondsLimit / cfg.maxRecSeconds),
    secondsLimit: cfg.accountSecondsLimit,
    bytesLimit: cfg.accountBytesLimit,
    maxSecondsPerRecording: cfg.maxRecSeconds,
    maxBytesPerRecording: cfg.maxRecBytes,
    maxRecordings: cfg.maxRecordings,
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
 * Pre-stream check with what is already known (the declared seconds, the slot count).
 * Returns null when the write may start, else {reason}. `replaced` = the recording this write
 * replaces ({seconds, bytes}) or null: its seconds, bytes and slot are freed first.
 */
export function checkBeforeWrite(plan, recs, id, seconds) {
  const others = recs.filter((r) => r.id !== id)
  const usage = usageOf(others)
  if (usage.seconds + seconds > plan.secondsLimit) return { reason: AllowanceReason.Seconds }
  if (others.length >= plan.maxRecordings) return { reason: AllowanceReason.Slots }
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
    used: Math.round((usage.seconds / plan.maxSecondsPerRecording) * 100) / 100,
    limit: plan.equivalentRecordings,
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
