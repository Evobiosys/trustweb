// End-to-end proof of the B-20 option A signing scheme, over real HTTP against
// a server this file starts and stops on an ephemeral port.
//
// The one sentence these tests exist to make true: a holder of a leaked
// authorCommitment can no longer withdraw or clear anything. Every case below
// is one way somebody might try, and the answer they get.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CLEAR_ALL_TARGET } from '@resource-web/wot-policy';
import {
  startTestServer,
  stopTestServer,
  post,
  del,
  get,
  makeFacets,
  makeSigner,
  clearPayload,
  withdrawPayload,
  type TestServer,
  type TestSigner,
  TEST_TIMEOUT_MS,
  LONG_TEST_TIMEOUT_MS,
} from './helpers.js';

async function publishOne(
  t: TestServer,
  signer: TestSigner,
  authorCommitment: string,
  overrides: Partial<{ category: string; regionCode: string }> = {},
): Promise<string> {
  const res = await post(t.baseUrl, '/declarations', {
    facets: makeFacets({ ...overrides, authorCommitment }),
    sealedBody: 'sealed-opaque-signed-actions',
    holderPubKey: signer.publicKeyB64u,
    soleAuthorAck: true,
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return (res.json as { id: string }).id;
}

async function backtraceIds(t: TestServer, authorCommitment: string): Promise<string[]> {
  const res = await get(t.baseUrl, `/declarations?authorCommitment=${encodeURIComponent(authorCommitment)}`);
  expect(res.status).toBe(200);
  return (res.json as { declarations: Array<{ id: string }> }).declarations.map((d) => d.id);
}

describe('publish registers the holder key', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer('at');
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it('refuses a publish with no holderPubKey: no declaration may be unwithdrawable', async () => {
    const res = await post(t.baseUrl, '/declarations', {
      facets: makeFacets({ authorCommitment: 'author-nokey', category: 'cat-nokey', regionCode: 'AT-nokey' }),
      sealedBody: 'sealed-opaque',
      soleAuthorAck: true,
    });
    expect(res.status).toBe(400);
    expect((res.json as { reason: string }).reason).toBe('malformed-request');
  });

  it('refuses a holderPubKey that is not a raw 32-byte Ed25519 key', async () => {
    // The last entry is a NON-CANONICAL spelling of 32 zero bytes: the two
    // unused trailing bits are set. Accepting it would mean four spellings of
    // one key, hence four rate-limit budgets and a silent no-op against the
    // registered holderPubKey.
    const nonCanonical = 'A'.repeat(42) + 'B';
    for (const bad of ['', 'not-base64url!!', 'c2hvcnQ', nonCanonical]) {
      const res = await post(t.baseUrl, '/declarations', {
        facets: makeFacets({ authorCommitment: 'author-badkey', category: 'cat-badkey', regionCode: 'AT-badkey' }),
        sealedBody: 'sealed-opaque',
        holderPubKey: bad,
        soleAuthorAck: true,
      });
      expect(res.status, `holderPubKey=${JSON.stringify(bad)}`).toBe(400);
    }
  });

  it('never echoes the registered key back on the backtrace listing', async () => {
    const signer = await makeSigner();
    await publishOne(t, signer, 'author-key-not-echoed', { category: 'cat-echo', regionCode: 'AT-echo' });
    const res = await get(t.baseUrl, '/declarations?authorCommitment=author-key-not-echoed');
    expect(res.text).not.toContain(signer.publicKeyB64u);
  });
});

describe('withdraw requires a signature from the key that published', () => {
  let t: TestServer;
  let holder: TestSigner;
  let stranger: TestSigner;
  const commitment = 'author-signed-withdraw';
  let id = '';

  beforeAll(async () => {
    t = await startTestServer('at');
    holder = await makeSigner();
    stranger = await makeSigner();
    id = await publishOne(t, holder, commitment, { category: 'cat-sw', regionCode: 'AT-sw' });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it('refuses a replay of a signature that already succeeded', async () => {
    const signed = await holder.signAction(withdrawPayload('some-other-id', commitment));
    const first = await del(t.baseUrl, '/declarations/some-other-id', signed);
    expect(first.status).toBe(204);
    const replay = await del(t.baseUrl, '/declarations/some-other-id', signed);
    expect(replay.status).toBe(403);
    expect((replay.json as { reason: string }).reason).toBe('nonce-reused');
  }, LONG_TEST_TIMEOUT_MS);

  it('refuses an expired signature', async () => {
    // Past the clock-skew allowance too: a signature a second stale is
    // accepted on purpose, so a lagging device clock is not a permanent lockout.
    const payload = { ...withdrawPayload(id, commitment), expiresAt: Date.now() - 45_000 };
    const res = await del(t.baseUrl, `/declarations/${id}`, await holder.signAction(payload));
    expect(res.status).toBe(403);
    expect((res.json as { reason: string }).reason).toBe('expired');
  });

  it('refuses a signature claiming a far-future expiry, so it can never become a bearer token', async () => {
    const payload = { ...withdrawPayload(id, commitment), expiresAt: Date.now() + 86_400_000 };
    const res = await del(t.baseUrl, `/declarations/${id}`, await holder.signAction(payload));
    expect(res.status).toBe(403);
    expect((res.json as { reason: string }).reason).toBe('expiry-too-far');
  });

  it('refuses a signature whose target is a different declaration id', async () => {
    const signed = await holder.signAction(withdrawPayload('a-different-id', commitment));
    const res = await del(t.baseUrl, `/declarations/${id}`, signed);
    expect(res.status).toBe(403);
    expect((res.json as { reason: string }).reason).toBe('action-mismatch');
  });

  it('the declaration is still there after every refusal so far', async () => {
    expect(await backtraceIds(t, commitment)).toEqual([id]);
  });

  it('a stranger with a valid signature of their own gets 204 and changes nothing', async () => {
    // The no-existence-oracle rule: a well-formed request from the wrong key
    // must not be distinguishable from a well-formed request for an id that
    // does not exist. Both are 204. What separates them is that only the
    // registered key's request actually erases anything.
    const res = await del(
      t.baseUrl,
      `/declarations/${id}`,
      await stranger.signAction(withdrawPayload(id, commitment)),
    );
    expect(res.status).toBe(204);
    expect(await backtraceIds(t, commitment)).toEqual([id]);
  }, LONG_TEST_TIMEOUT_MS);

  it('the registered key withdraws it', async () => {
    const res = await del(
      t.baseUrl,
      `/declarations/${id}`,
      await holder.signAction(withdrawPayload(id, commitment)),
    );
    expect(res.status).toBe(204);
    expect(await backtraceIds(t, commitment)).toEqual([]);
  }, LONG_TEST_TIMEOUT_MS);
});

describe('clear is scoped to the key that signed it', () => {
  let t: TestServer;
  let holder: TestSigner;
  let other: TestSigner;
  const mine = 'author-clear-scope-mine';
  const theirs = 'author-clear-scope-theirs';

  beforeAll(async () => {
    t = await startTestServer('at');
    holder = await makeSigner();
    other = await makeSigner();
    await publishOne(t, holder, mine, { category: 'cat-cs-1', regionCode: 'AT-cs1' });
    await publishOne(t, holder, mine, { category: 'cat-cs-2', regionCode: 'AT-cs2' });
    await publishOne(t, other, theirs, { category: 'cat-cs-3', regionCode: 'AT-cs3' });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it('a clear signed by the wrong key over my commitment removes nothing of mine', async () => {
    const res = await post(t.baseUrl, '/clear', await other.signAction(clearPayload(mine)));
    expect(res.status).toBe(204); // no oracle: the caller learns nothing either way
    expect(await backtraceIds(t, mine)).toHaveLength(2);
  }, LONG_TEST_TIMEOUT_MS);

  it('a clear signed by my key removes exactly mine, and leaves the other holder untouched', async () => {
    const res = await post(t.baseUrl, '/clear', await holder.signAction(clearPayload(mine)));
    expect(res.status).toBe(204);
    expect(await backtraceIds(t, mine)).toEqual([]);
    expect(await backtraceIds(t, theirs)).toHaveLength(1);
  }, LONG_TEST_TIMEOUT_MS);

  it('a withdraw signature cannot be replayed against the clear endpoint', async () => {
    const payload = { ...withdrawPayload(CLEAR_ALL_TARGET, theirs), action: 'withdraw' as const };
    const res = await post(t.baseUrl, '/clear', await other.signAction(payload));
    expect(res.status).toBe(403);
    expect((res.json as { reason: string }).reason).toBe('action-mismatch');
    expect(await backtraceIds(t, theirs)).toHaveLength(1);
  }, LONG_TEST_TIMEOUT_MS);
});

describe('withdraw and clear are rate limited per holder key', () => {
  let t: TestServer;
  let holder: TestSigner;
  let other: TestSigner;

  beforeAll(async () => {
    // limit 2 per minute, so the third signed action from one key is refused
    // without this suite having to wait out a realistic window.
    t = await startTestServer('at', { rateLimit: { limit: 2, windowMs: 60_000 } });
    holder = await makeSigner();
    other = await makeSigner();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it('refuses 429 past the limit, and the limit is per key, not per instance', async () => {
    const target = 'rate-limit-target';
    for (let i = 0; i < 2; i++) {
      const res = await del(
        t.baseUrl,
        `/declarations/${target}`,
        await holder.signAction(withdrawPayload(target, 'author-rl')),
      );
      expect(res.status, `attempt ${i}`).toBe(204);
    }
    const blocked = await del(
      t.baseUrl,
      `/declarations/${target}`,
      await holder.signAction(withdrawPayload(target, 'author-rl')),
    );
    expect(blocked.status).toBe(429);
    expect((blocked.json as { reason: string }).reason).toBe('rate-limited');

    // A second holder is unaffected: the limiter must not become a way to lock
    // somebody else out of clearing their own records.
    const unaffected = await del(
      t.baseUrl,
      `/declarations/${target}`,
      await other.signAction(withdrawPayload(target, 'author-rl-other')),
    );
    expect(unaffected.status).toBe(204);
  }, LONG_TEST_TIMEOUT_MS);
});
