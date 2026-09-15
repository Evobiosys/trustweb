// U5 end-to-end assertion 5: POST /clear removes every record for that holder; GET
// /declarations?authorCommitment= for that authorCommitment is empty afterwards.
//
// Also exercises the backtrace half of the debrief requirement (handover section 0, item 2):
// GET /declarations lists what a holder published, with ids and timestamps, before clearing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestServer,
  stopTestServer,
  post,
  get,
  makeFacets,
  makeSigner,
  clearPayload,
  type TestServer,
  type TestSigner,
  TEST_TIMEOUT_MS,
} from './helpers.js';

describe('e2e: POST /clear wipes one holder, GET /declarations is the backtrace', () => {
  let t: TestServer;
  let holder: TestSigner;
  const authorCommitment = 'author-e2e-clear';

  beforeAll(async () => {
    t = await startTestServer('at');
    // One holder, one device key, two declarations in different facet pairs:
    // exactly the shape the debrief's "backtrace and clear" path walks.
    holder = await makeSigner();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it('publishes two declarations for one holder across different facet pairs', async () => {
    const p1 = await post(t.baseUrl, '/declarations', {
      facets: makeFacets({ category: 'accommodation.sublet-e2e-clear-1', regionCode: 'AT-c1', authorCommitment }),
      sealedBody: 'sealed-opaque-clear-1',
      holderPubKey: holder.publicKeyB64u,
      soleAuthorAck: true,
    });
    const p2 = await post(t.baseUrl, '/declarations', {
      facets: makeFacets({ category: 'accommodation.sublet-e2e-clear-2', regionCode: 'AT-c2', authorCommitment }),
      sealedBody: 'sealed-opaque-clear-2',
      holderPubKey: holder.publicKeyB64u,
      soleAuthorAck: true,
    });
    expect(p1.status, JSON.stringify(p1.json)).toBe(201);
    expect(p2.status, JSON.stringify(p2.json)).toBe(201);
  });

  it('GET /declarations backtrace lists both, before clearing', async () => {
    const backtrace = await get(t.baseUrl, `/declarations?authorCommitment=${encodeURIComponent(authorCommitment)}`);
    expect(backtrace.status).toBe(200);
    const declarations = (backtrace.json as { declarations: Array<{ id: string; publishedAt: string; residency: string }> }).declarations;
    expect(declarations.length).toBe(2);
    for (const d of declarations) {
      expect(typeof d.id).toBe('string');
      expect(typeof d.publishedAt).toBe('string');
      expect(d.residency).toBe('AT');
    }
  });

  it('POST /clear removes every record for that holder', async () => {
    const clearRes = await post(t.baseUrl, '/clear', await holder.signAction(clearPayload(authorCommitment)));
    expect(clearRes.status, JSON.stringify(clearRes.json)).toBe(204);
  });

  it('GET /declarations for that authorCommitment is empty afterwards', async () => {
    const backtrace = await get(t.baseUrl, `/declarations?authorCommitment=${encodeURIComponent(authorCommitment)}`);
    expect(backtrace.status).toBe(200);
    const declarations = (backtrace.json as { declarations: unknown[] }).declarations;
    expect(declarations).toEqual([]);
  });

  it('GET /declarations without authorCommitment is refused, not silently empty', async () => {
    const res = await get(t.baseUrl, '/declarations');
    expect(res.status).toBe(400);
  });

  it('an unsigned clear is refused 403 and says why', async () => {
    const res = await post(t.baseUrl, '/clear', { authorCommitment });
    expect(res.status).toBe(403);
    expect((res.json as { reason: string }).reason).toBe('signature-required');
  });
});
