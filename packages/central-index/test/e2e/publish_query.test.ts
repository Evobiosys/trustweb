// U5 end-to-end assertion 1: publish then query above the anonymity floor returns hits.
// U5 end-to-end assertion 2: publish then query below the floor returns the byte-identical
// no, same content-length and same bytes as an unrelated no-match query, both HTTP 200.
//
// Note on overlap: packages/central-index/test/indistinguishable_no.test.ts (U2's own unit
// self-test) already covers the below-floor-equals-no-match byte comparison. The test below is
// written independently anyway, per the handover's explicit assertion list, but it is
// deliberately structured differently: it seeds a below-floor record via a real publish (not a
// query-only probe) and compares it against a same-server no-match query, so it is not merely a
// duplicate of U2's suite even though the invariant under test is the same one.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { indistinguishableNo } from '@resource-web/wot-policy';
import {
  startTestServer,
  stopTestServer,
  post,
  makeFacets,
  publishDistinctAuthors,
  type TestServer,
  TEST_TIMEOUT_MS,
  LONG_TEST_TIMEOUT_MS,
} from './helpers.js';

describe('e2e: publish then query, above and below the floor', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer('at');
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it(
    'above floor: 7 distinct authors on one facet pair, a matching query returns hits',
    async () => {
      const facetOverrides = { category: 'accommodation.sublet-e2e-above', regionCode: 'AT-9' };
      const publishes = await publishDistinctAuthors(t.baseUrl, 7, facetOverrides);
      for (const p of publishes) {
        expect(p.status, JSON.stringify(p.json)).toBe(201);
      }

      const result = await post(t.baseUrl, '/query', { facets: makeFacets(facetOverrides) });
      expect(result.status).toBe(200);
      expect(Array.isArray((result.json as { hits?: unknown }).hits)).toBe(true);
      const hits = (result.json as { hits: unknown[] }).hits;
      expect(hits.length).toBe(7);
    },
    LONG_TEST_TIMEOUT_MS,
  );

  it(
    'below floor: fewer than 7 distinct authors returns the byte-identical no, ' +
      'same length and bytes as an unrelated no-match query, both 200',
    async () => {
      const facetOverrides = { category: 'accommodation.sublet-e2e-below', regionCode: 'AT-3' };
      // 3 distinct authors: below CENTRAL_K_FLOOR (7).
      const publishes = await publishDistinctAuthors(t.baseUrl, 3, facetOverrides);
      for (const p of publishes) {
        expect(p.status, JSON.stringify(p.json)).toBe(201);
      }

      const belowFloor = await post(t.baseUrl, '/query', { facets: makeFacets(facetOverrides) });
      const noMatch = await post(t.baseUrl, '/query', {
        facets: makeFacets({ category: 'no-such-category-e2e', regionCode: 'AT-0' }),
      });

      expect(belowFloor.status).toBe(200);
      expect(noMatch.status).toBe(200);
      expect(belowFloor.status).not.toBe(404);
      expect(noMatch.status).not.toBe(404);

      expect(belowFloor.contentLength).toBe(noMatch.contentLength);
      expect(belowFloor.bytes.equals(noMatch.bytes)).toBe(true);
      expect(belowFloor.bytes.equals(Buffer.from(indistinguishableNo()))).toBe(true);
    },
    LONG_TEST_TIMEOUT_MS,
  );
});
