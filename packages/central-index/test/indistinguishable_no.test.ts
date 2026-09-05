// I3: below-k, declined (malformed input) and no-match must all return HTTP 200 with the exact
// same body bytes, the same content-length, and no faster response for the "cheap" cases.
// This is the server's own responsibility (server.ts's single sendNo() call site), so it is
// exercised over a real, ephemeral-port HTTP server rather than mocked — the alternative would
// only prove the mock agrees with itself. Full request/response integration otherwise (publish
// then query above floor, withdraw, /clear, /jurisdiction) is unit U5's end-to-end suite in
// test/e2e/**; this file covers only the one invariant this package is required to self-test.
//
// CENTRAL_BUDGET_MS (900ms) padding means each request below takes ~900ms — tests here get a
// longer-than-default timeout accordingly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indistinguishableNo } from '@resource-web/wot-policy';
import { createCentralServer, type CentralServer } from '../src/server.js';

const TEST_TIMEOUT_MS = 15_000;

describe('I3 indistinguishable no', () => {
  let server: CentralServer;
  let dataDir: string;
  let baseUrl: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'wot-central-index-no-test-'));
    server = createCentralServer({ dataDir, jurisdiction: 'at' });
    const port = await server.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function query(body: unknown): Promise<{ status: number; bytes: Buffer; contentLength: string | null }> {
    const res = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes, contentLength: res.headers.get('content-length') };
  }

  const facets = { category: 'accommodation.sublet', regionCode: 'AT-9', authorCommitment: 'irrelevant', sensitive: false };

  it(
    'a no-match query returns exactly indistinguishableNo() bytes with a 200',
    async () => {
      const result = await query({ facets });
      expect(result.status).toBe(200);
      expect(result.bytes.equals(Buffer.from(indistinguishableNo()))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a below-floor query (few candidates, one author) returns byte-identical bytes to the no-match case',
    async () => {
      // Publish fewer than K_FLOOR_DEFAULT (7) declarations, all from one author, so
      // evaluateFloor reports 'below' rather than 'above'.
      for (let i = 0; i < 3; i++) {
        await fetch(`${baseUrl}/declarations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            facets: { ...facets, authorCommitment: 'same-author' },
            sealedBody: 'x',
            soleAuthorAck: true,
          }),
        });
      }

      const noMatch = await query({ facets: { ...facets, category: 'no-such-category' } });
      const belowFloor = await query({ facets });

      expect(belowFloor.status).toBe(200);
      expect(belowFloor.contentLength).toBe(noMatch.contentLength);
      expect(belowFloor.bytes.equals(noMatch.bytes)).toBe(true);
      expect(belowFloor.bytes.equals(Buffer.from(indistinguishableNo()))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a declined (malformed) query returns byte-identical bytes to the no-match case',
    async () => {
      const malformed = await query({ nonsense: true });
      const noMatch = await query({ facets: { ...facets, category: 'still-no-such-category' } });

      expect(malformed.status).toBe(200);
      expect(malformed.contentLength).toBe(noMatch.contentLength);
      expect(malformed.bytes.equals(noMatch.bytes)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'all three cases settle within one CENTRAL_BUDGET_MS window of each other (no timing oracle)',
    async () => {
      const timed = async (body: unknown): Promise<number> => {
        const t0 = Date.now();
        await query(body);
        return Date.now() - t0;
      };

      const durations = [
        await timed({ facets: { ...facets, category: 'timing-no-match' } }),
        await timed({ facets }), // below floor, from the previous test's publishes
        await timed({ garbage: 'input' }),
      ];

      const spread = Math.max(...durations) - Math.min(...durations);
      // Generous window: real budget is 900ms; scheduler jitter under test load is the only
      // expected variance, never a fast-path skip.
      expect(spread).toBeLessThan(400);
    },
    TEST_TIMEOUT_MS,
  );
});
