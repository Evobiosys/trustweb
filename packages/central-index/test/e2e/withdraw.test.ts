// U5 end-to-end assertion 4: withdraw removes the record; a later query for it returns the
// byte-identical no.
//
// Publishes exactly CENTRAL_K_FLOOR (7) distinct authors on one facet pair so the pair starts
// above the floor and a query returns hits including every published id. Withdrawing one of
// those declarations drops the pair to 6 distinct authors, below the floor, so the very next
// query for the same facets must now return indistinguishableNo() rather than a smaller hit
// list -- proving both that the withdrawn record is gone from the index (it cannot be counted
// as a distinct author any more) and that the no-response path is taken, not merely a shorter
// hits array.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { indistinguishableNo } from '@resource-web/wot-policy';
import {
  startTestServer,
  stopTestServer,
  post,
  del,
  makeFacets,
  publishDistinctAuthors,
  type TestServer,
  TEST_TIMEOUT_MS,
  LONG_TEST_TIMEOUT_MS,
} from './helpers.js';

describe('e2e: withdraw removes the record', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer('at');
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it(
    'withdrawing one of 7 distinct-author declarations drops the pair below floor; ' +
      'the next query returns the byte-identical no',
    async () => {
      const facetOverrides = { category: 'accommodation.sublet-e2e-withdraw', regionCode: 'AT-w' };
      const publishes = await publishDistinctAuthors(t.baseUrl, 7, facetOverrides);
      for (const p of publishes) {
        expect(p.status, JSON.stringify(p.json)).toBe(201);
      }
      const ids = publishes.map((p) => (p.json as { id: string }).id);
      expect(new Set(ids).size).toBe(7);

      const above = await post(t.baseUrl, '/query', { facets: makeFacets(facetOverrides) });
      expect(above.status).toBe(200);
      expect((above.json as { hits: unknown[] }).hits.length).toBe(7);

      const idToWithdraw = ids[0];
      const withdrawRes = await del(t.baseUrl, `/declarations/${encodeURIComponent(idToWithdraw)}`, {
        proof: 'placeholder-signed-withdrawal-proof',
      });
      expect(withdrawRes.status).toBe(204);

      const after = await post(t.baseUrl, '/query', { facets: makeFacets(facetOverrides) });
      expect(after.status).toBe(200);
      expect(after.bytes.equals(Buffer.from(indistinguishableNo()))).toBe(true);
    },
    LONG_TEST_TIMEOUT_MS,
  );

  it('withdraw is idempotent: withdrawing an unknown id returns 204, not 404', async () => {
    const res = await del(t.baseUrl, '/declarations/never-existed-e2e', { proof: 'x' });
    expect(res.status).toBe(204);
  });
});
