// U5 end-to-end assertion 7: a structurally single-author publish without soleAuthorAck is
// refused 409; with soleAuthorAck: true it succeeds.
//
// Uses a facet pair (category, regionCode) touched by no other test in this file, and by
// nothing earlier in the same server's lifetime -- the corpus for this pair must be genuinely
// empty so requiresSoleAuthorAck's "at most one distinct author for this pair" condition holds
// for the very first publish.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, stopTestServer, post, makeFacets, makeSigner, type TestServer, TEST_TIMEOUT_MS, type TestSigner } from './helpers.js';

describe('e2e: sole-author-ack gate on publish', () => {
  let t: TestServer;
  // One holder key for the whole file: this suite is about the sole-author gate,
  // not about key management, and every publish now has to register a key.
  let holder: TestSigner;
  const facetOverrides = { category: 'accommodation.sublet-e2e-sole-author', regionCode: 'AT-sole' };

  beforeAll(async () => {
    t = await startTestServer('at');
    holder = await makeSigner();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it('a sole-author-shaped publish without soleAuthorAck is refused 409', async () => {
    const res = await post(t.baseUrl, '/declarations', {
      facets: makeFacets({ ...facetOverrides, authorCommitment: 'author-solo-refused' }),
      sealedBody: 'sealed-opaque-solo-1',
      holderPubKey: holder.publicKeyB64u,
    });
    expect(res.status).toBe(409);
    expect((res.json as { reason: string }).reason).toBe('sole-author-ack-required');
  });

  it('the same shape with soleAuthorAck: true succeeds', async () => {
    const res = await post(t.baseUrl, '/declarations', {
      facets: makeFacets({ ...facetOverrides, authorCommitment: 'author-solo-refused' }),
      sealedBody: 'sealed-opaque-solo-2',
      holderPubKey: holder.publicKeyB64u,
      soleAuthorAck: true,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const body = res.json as { id: string; instanceId: string; residency: string };
    expect(typeof body.id).toBe('string');
    expect(body.residency).toBe('AT');
  });

  it('explicit soleAuthorAck: false on a fresh sole-author pair is still refused, not treated as consent', async () => {
    const freshPair = { category: 'accommodation.sublet-e2e-sole-author-false', regionCode: 'AT-sole-false' };
    const res = await post(t.baseUrl, '/declarations', {
      facets: makeFacets({ ...freshPair, authorCommitment: 'author-solo-explicit-false' }),
      sealedBody: 'sealed-opaque-solo-3',
      holderPubKey: holder.publicKeyB64u,
      soleAuthorAck: false,
    });
    expect(res.status).toBe(409);
    expect((res.json as { reason: string }).reason).toBe('sole-author-ack-required');
  });
});
