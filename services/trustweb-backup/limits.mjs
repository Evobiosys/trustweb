// In-memory limiters for the new routes. They reset when the server restarts (documented):
// the persistent facts (accounts, allowances, files) live on disk in hosted.mjs.

import { utcDay } from './http_util.mjs'

/**
 * The key a per-client limit counts under: an IPv4 address as it is, an IPv6 address by its /64 network
 * (one customer line or VPS gets a whole /64, so per-address limits would be free to dodge).
 * An IPv4-mapped IPv6 address counts as its IPv4 address.
 */
export function ipKey(ip) {
  const v = String(ip ?? '').trim().toLowerCase()
  if (!v.includes(':')) return v
  if (v.startsWith('::ffff:') && v.slice(7).includes('.')) return v.slice(7)
  const [head, tail = ''] = v.split('::')
  const left = head === '' ? [] : head.split(':')
  const right = tail === '' ? [] : tail.split(':')
  const groups = v.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

/**
 * Uploads in flight: at most `total` overall and `perKey` per client key. tryAcquire returns a release
 * function (idempotent) or null when either bound is reached. Keys leave the map when their count drops to 0.
 */
export function createInFlight({ total, perKey }) {
  const byKey = new Map()
  let all = 0
  return {
    tryAcquire(key) {
      const mine = byKey.get(key) ?? 0
      if (all >= total || mine >= perKey) return null
      all += 1
      byKey.set(key, mine + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        all -= 1
        const left = (byKey.get(key) ?? 1) - 1
        if (left <= 0) byKey.delete(key)
        else byKey.set(key, left)
      }
    },
    count: () => all,
  }
}

/**
 * A slot pool with a bounded wait queue (the paid provider calls). acquire(waitMs) resolves a release function once a
 * slot is free, or null when it waited `waitMs` in vain; it returns null at once when every slot is taken and `queue`
 * callers already wait.
 */
export function createSlots({ slots, queue }) {
  let busy = 0
  const waiting = []
  function release() {
    const next = waiting.shift()
    if (next !== undefined) next()
    else busy -= 1
  }
  function grant() {
    let released = false
    return () => {
      if (released) return
      released = true
      release()
    }
  }
  return {
    /** Would acquire() be refused right now? (checked before any audio is read) */
    full: () => busy >= slots && waiting.length >= queue,
    acquire(waitMs = Infinity) {
      if (busy < slots) {
        busy += 1
        return Promise.resolve(grant())
      }
      if (waiting.length >= queue) return null
      return new Promise((resolve) => {
        const entry = () => {
          clearTimeout(timer)
          resolve(grant())
        }
        // setTimeout turns Infinity into 1 ms: only a finite wait gets a timer
        const timer = Number.isFinite(waitMs)
          ? setTimeout(() => {
              const i = waiting.indexOf(entry)
              if (i !== -1) waiting.splice(i, 1)
              resolve(null)
            }, waitMs)
          : undefined
        waiting.push(entry)
      })
    },
  }
}

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
    /** Uses up what is left of today for `key` (nothing more fits until the next UTC midnight). */
    close(key = null) {
      roll()
      used.set(key, Math.max(limit, used.get(key) ?? 0))
    },
    /** Seconds until the next UTC midnight (for Retry-After). */
    secondsToReset() {
      const t = now()
      const next = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1)
      return Math.ceil((next - t) / 1000)
    },
  }
}
