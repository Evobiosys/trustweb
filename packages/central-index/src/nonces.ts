// Single-use nonce registry for signed withdraw/clear actions (B-20 option A).
//
// The crypto half of a signed action lives in @resource-web/wot-policy, shared
// with the device. This half cannot: "have I seen this nonce before" is server
// state, and it must never enter a browser bundle. Same split as the floor
// (policy) versus the store (here).
//
// IN MEMORY, ON PURPOSE. A nonce only has to outlive its own signature, and a
// signature's expiry is bounded above by SIGNATURE_MAX_TTL_MS (two minutes).
// Persisting nonces would mean a new StoreRecord type, a rebuild path, and an
// append per rejected request -- real complexity to buy a two-minute window.
// The honest cost is stated out loud rather than engineered around: a server
// restart forgets the nonces it had seen, so a captured request whose signature
// has not yet expired could be replayed once across that restart. See the
// central handover's "Signing scheme" section, threat notes.

import { SIGNATURE_MAX_TTL_MS, SIGNATURE_CLOCK_SKEW_MS } from '@resource-web/wot-policy';

export class NonceRegistry {
  /** nonce -> the expiry it was first claimed with. */
  private readonly seen = new Map<string, number>();
  private readonly maxLifetimeMs: number;

  constructor(maxLifetimeMs = SIGNATURE_MAX_TTL_MS + SIGNATURE_CLOCK_SKEW_MS) {
    this.maxLifetimeMs = maxLifetimeMs;
  }

  /**
   * Claims `nonce` for the first and only time. Returns false when it has
   * already been used, which is exactly the replay case.
   *
   * Pruning happens on every claim rather than on a timer: no interval to
   * clear, nothing keeping a test process alive, and the map cannot outgrow
   * the number of signatures issued inside one expiry window.
   */
  claim(nonce: string, expiresAt: number, now = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(nonce)) return false;
    // Never trust the request's own expiry to bound our memory: cap it.
    const retainUntil = Math.min(expiresAt, now + this.maxLifetimeMs);
    this.seen.set(nonce, retainUntil);
    return true;
  }

  prune(now = Date.now()): void {
    for (const [nonce, retainUntil] of this.seen) {
      if (retainUntil <= now) this.seen.delete(nonce);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}
