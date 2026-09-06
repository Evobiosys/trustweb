// U5 end-to-end assertion 3: timing. Below-k, declined and no-match response durations must
// all fall within one CENTRAL_BUDGET_MS window of each other -- none may return markedly
// faster than the others, which would let a network observer distinguish the three cases by
// latency alone even though the bytes are identical (I3's timing half).
//
// These three requests are timed strictly sequentially and one at a time, deliberately not
// concurrently: concurrent requests share the same Node event loop and each other's I/O
// scheduling, which inflates the measured spread with contention noise unrelated to the
// server's own behaviour and would make this test flaky. The seed publishes that create the
// below-k condition run beforehand and are not part of the timed window.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

// Generous slack for CI noise. The real budget is 900ms; scheduler jitter is the only expected
// variance. A markedly faster path (a genuine fast-path skip, not jitter) would show as a
// spread on the order of the budget itself, not a fraction of it -- 500ms leaves wide margin
// above typical jitter while still catching a real fast-path regression.
const SPREAD_BUDGET_MS = 500;

describe('e2e: below-k, declined and no-match all settle within one budget window', () => {
  let t: TestServer;
  const facetOverrides = { category: 'accommodation.sublet-e2e-timing', regionCode: 'AT-timing' };

  beforeAll(async () => {
    t = await startTestServer('at');
    // 2 distinct authors: below K_FLOOR_DEFAULT (7), so a matching query is the below-k case.
    const publishes = await publishDistinctAuthors(t.baseUrl, 2, facetOverrides);
    for (const p of publishes) {
      expect(p.status, JSON.stringify(p.json)).toBe(201);
    }
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it(
    'below-k, declined (malformed) and no-match durations are within one budget window',
    async () => {
      const timed = async (body: unknown): Promise<number> => {
        const t0 = Date.now();
        const res = await post(t.baseUrl, '/query', body);
        expect(res.status).toBe(200);
        return Date.now() - t0;
      };

      // Sequential, on purpose -- see file header.
      const belowKMs = await timed({ facets: makeFacets(facetOverrides) });
      const declinedMs = await timed({ this: 'is not a valid query request' });
      const noMatchMs = await timed({
        facets: makeFacets({ category: 'no-such-category-e2e-timing', regionCode: 'AT-0' }),
      });

      const durations = [belowKMs, declinedMs, noMatchMs];
      const spread = Math.max(...durations) - Math.min(...durations);
      expect(spread, `durations were ${JSON.stringify(durations)}`).toBeLessThan(SPREAD_BUDGET_MS);

      // None of the three may return markedly faster than the others -- i.e. none may skip the
      // settleAt padding. A near-zero duration would prove exactly that fast-path leak.
      for (const d of durations) {
        expect(d, `durations were ${JSON.stringify(durations)}`).toBeGreaterThan(300);
      }
    },
    LONG_TEST_TIMEOUT_MS,
  );
});
