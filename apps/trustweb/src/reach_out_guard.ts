/** Flood cap for reach-outs via my public link: a sliding window of the times accepted. Pure; the caller handles "paused". */
export function allowReachOut(log: number[], now: number, limit = 10, windowMs = 3600_000): { ok: boolean; log: number[] } {
  const recent = log.filter((t) => t > now - windowMs)
  return recent.length >= limit ? { ok: false, log: recent } : { ok: true, log: [...recent, now] }
}
