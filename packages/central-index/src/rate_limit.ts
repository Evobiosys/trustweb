// Per-key sliding-window rate limiter for withdraw and clear.
//
// KEYED ON THE HOLDER'S PUBLIC KEY, not on an IP and not on an
// authorCommitment. An IP is shared by everyone behind one NAT and rotates
// under a phone, so limiting on it punishes bystanders and stops nobody. An
// authorCommitment is not a secret, so limiting on it would hand any passer-by
// a way to lock a holder out of clearing her own records -- a denial of service
// against exactly the person this layer exists to protect. A public key is
// unforgeable in this position: an entry is only ever created after a
// signature over it verified, so the limiter counts real capability-holders.
//
// The limit exists because verification is not free. Without it, an attacker
// who captured one valid signature could spend the instance's CPU replaying it
// (each replay costs an Ed25519 verify before the nonce registry rejects it).

export interface RateLimitConfig {
  /** Maximum accepted actions per key inside the window. */
  limit: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60_000 };

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly config: RateLimitConfig = DEFAULT_RATE_LIMIT) {}

  /** Records one attempt for `key` and reports whether it is within the limit. */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.config.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.config.limit) {
      // Keep the pruned list so the map does not grow unbounded on a key that
      // is being hammered; do NOT append, or a blocked caller would extend
      // their own lockout indefinitely by retrying.
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Drops keys with no hits left inside the window. */
  prune(now = Date.now()): void {
    const cutoff = now - this.config.windowMs;
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
