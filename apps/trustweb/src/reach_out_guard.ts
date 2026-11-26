/** Flood cap for reach-outs via my public link: a sliding window of the times accepted. Pure; the caller handles "paused". */
export function allowReachOut(log: number[], now: number, limit = 10, windowMs = 3600_000): { ok: boolean; log: number[] } {
  const recent = log.filter((t) => t > now - windowMs)
  return recent.length >= limit ? { ok: false, log: recent } : { ok: true, log: [...recent, now] }
}

/**
 * Event-link joiners (a guest tapping Add on an event link the host shared on purpose) have their own budget, apart from reach-outs:
 * a whole workshop joins within the hour, a leaked link still cannot flood the host. Over it the guest's app retries later.
 */
export const EVENT_JOIN_PER_HOUR = 100
