// The stateful half of a signed action: replay protection and abuse limiting.
// Pure unit tests with an injected clock -- no server, no timers, no waiting.

import { describe, expect, it } from 'vitest';
import { NonceRegistry } from '../src/nonces.js';
import { RateLimiter } from '../src/rate_limit.js';

describe('NonceRegistry', () => {
  it('accepts a nonce once and refuses every later sighting', () => {
    const registry = new NonceRegistry();
    const now = 1_000_000;
    expect(registry.claim('nonce-a', now + 60_000, now)).toBe(true);
    expect(registry.claim('nonce-a', now + 60_000, now)).toBe(false);
    expect(registry.claim('nonce-a', now + 60_000, now + 1_000)).toBe(false);
  });

  it('keeps distinct nonces independent', () => {
    const registry = new NonceRegistry();
    const now = 1_000_000;
    expect(registry.claim('nonce-a', now + 60_000, now)).toBe(true);
    expect(registry.claim('nonce-b', now + 60_000, now)).toBe(true);
    expect(registry.size).toBe(2);
  });

  it('forgets a nonce once its signature could no longer be valid anyway', () => {
    const registry = new NonceRegistry();
    const now = 1_000_000;
    registry.claim('nonce-a', now + 10_000, now);
    registry.prune(now + 10_001);
    expect(registry.size).toBe(0);
    // Re-claimable, but only because the signature carrying it has expired and
    // would now be refused by verifySignedAction before this registry is asked.
    expect(registry.claim('nonce-a', now + 70_000, now + 10_001)).toBe(true);
  });

  it('caps retention with its own lifetime, never with the requests claimed expiry', () => {
    // Otherwise a caller could pin memory by claiming expiresAt: 9e15. The
    // signature verifier already refuses a far-future expiry; this is the
    // belt-and-braces half, so the map cannot be grown by a request that got
    // this far through some future refactor.
    const registry = new NonceRegistry(5_000);
    const now = 1_000_000;
    registry.claim('nonce-forever', Number.MAX_SAFE_INTEGER, now);
    registry.prune(now + 5_001);
    expect(registry.size).toBe(0);
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit inside the window, then refuses', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
    const now = 1_000_000;
    expect(limiter.allow('key-a', now)).toBe(true);
    expect(limiter.allow('key-a', now + 1)).toBe(true);
    expect(limiter.allow('key-a', now + 2)).toBe(true);
    expect(limiter.allow('key-a', now + 3)).toBe(false);
  });

  it('does not let a blocked caller extend their own lockout by retrying', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 10_000 });
    const now = 1_000_000;
    expect(limiter.allow('key-a', now)).toBe(true);
    for (let i = 1; i <= 20; i++) expect(limiter.allow('key-a', now + i)).toBe(false);
    // The window is measured from the ACCEPTED hit, not from the last refusal.
    expect(limiter.allow('key-a', now + 10_001)).toBe(true);
  });

  it('keys are independent: one holder cannot exhaust anothers budget', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 1_000_000;
    expect(limiter.allow('key-a', now)).toBe(true);
    expect(limiter.allow('key-a', now)).toBe(false);
    expect(limiter.allow('key-b', now)).toBe(true);
  });

  it('drops keys that have gone quiet rather than growing forever', () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 1_000 });
    const now = 1_000_000;
    limiter.allow('key-a', now);
    limiter.allow('key-b', now);
    expect(limiter.size).toBe(2);
    limiter.prune(now + 1_001);
    expect(limiter.size).toBe(0);
  });
});
