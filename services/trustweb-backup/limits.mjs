// In-memory limiters for the new routes. They reset when the server restarts (documented):
// the persistent facts (accounts, allowances, files) live on disk in hosted.mjs.

import { utcDay } from './http_util.mjs'

/** Sliding-window request counter per key. hit() counts the call and says whether it is over the limit. */
export function createWindowLimiter({ limit, windowMs, maxKeys = 10000, now = Date.now }) {
  const hits = new Map()
  function prune(t) {
    for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k)
    if (hits.size > maxKeys) hits.clear()
  }
  return {
    hit(key) {
      const t = now()
      if (hits.size > maxKeys) prune(t)
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs)
      recent.push(t)
      hits.set(key, recent)
      const limited = recent.length > limit
      return { limited, retryAfter: limited ? Math.ceil((recent[0] + windowMs - t) / 1000) : 0 }
    },
  }
}

/** Per-key counter that starts again at every UTC midnight. Key null = one global counter. */
export function createDailyMeter({ limit, maxKeys = 10000, now = Date.now }) {
  let day = utcDay(now())
  const used = new Map()
  function roll() {
    const today = utcDay(now())
    if (today !== day) {
      day = today
      used.clear()
    }
    if (used.size > maxKeys) used.clear()
  }
  return {
    limit,
    used(key = null) {
      roll()
      return used.get(key) ?? 0
    },
    /** True when `amount` more would still fit under the limit. */
    fits(key, amount) {
      roll()
      return (used.get(key) ?? 0) + amount <= limit
    },
    add(key, amount) {
      roll()
      used.set(key, Math.max(0, (used.get(key) ?? 0) + amount))
    },
    /** Seconds until the next UTC midnight (for Retry-After). */
    secondsToReset() {
      const t = now()
      const next = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1)
      return Math.ceil((next - t) / 1000)
    },
  }
}
