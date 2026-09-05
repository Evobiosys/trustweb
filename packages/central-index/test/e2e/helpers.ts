// Shared HTTP + server-lifecycle helpers for the U5 end-to-end suite.
// Every test file in this directory starts its own server on an ephemeral
// port (listen(0)) against its own mkdtempSync data dir, and tears both
// down in afterAll/afterEach. Nothing here is imported by, or exported to,
// any file outside test/e2e/**.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCentralServer, type CentralServer } from '../../src/server.js';

export const TEST_TIMEOUT_MS = 20_000;
export const LONG_TEST_TIMEOUT_MS = 30_000;

export interface TestServer {
  server: CentralServer;
  dataDir: string;
  baseUrl: string;
}

/** Starts a fresh server on an ephemeral port with a fresh temp data dir. Caller must
 *  await stopTestServer() on it, always, including on a failed setup. */
export async function startTestServer(jurisdiction?: string): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'wot-central-index-e2e-'));
  const server = createCentralServer({ dataDir, jurisdiction });
  const port = await server.listen(0);
  return { server, dataDir, baseUrl: `http://127.0.0.1:${port}` };
}

export async function stopTestServer(t: TestServer | undefined): Promise<void> {
  if (!t) return;
  await t.server.close();
  rmSync(t.dataDir, { recursive: true, force: true });
}

export interface RawResponse {
  status: number;
  bytes: Buffer;
  contentLength: string | null;
  json: unknown;
  text: string;
}

async function toRaw(res: Response): Promise<RawResponse> {
  const bytes = Buffer.from(await res.arrayBuffer());
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf-8'));
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    bytes,
    contentLength: res.headers.get('content-length'),
    json,
    text: bytes.toString('utf-8'),
  };
}

export async function post(baseUrl: string, path: string, body: unknown): Promise<RawResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return toRaw(res);
}

export async function del(baseUrl: string, path: string, body?: unknown): Promise<RawResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return toRaw(res);
}

export async function get(baseUrl: string, path: string): Promise<RawResponse> {
  const res = await fetch(`${baseUrl}${path}`);
  return toRaw(res);
}

export function makeFacets(overrides: Partial<{
  category: string;
  regionCode: string;
  authorCommitment: string;
  sensitive: boolean;
}> = {}): { category: string; regionCode: string; authorCommitment: string; sensitive: boolean } {
  return {
    category: 'accommodation.sublet',
    regionCode: 'AT-9',
    authorCommitment: 'author-a',
    sensitive: false,
    ...overrides,
  };
}

/** Publishes `count` declarations under `count` distinct authorCommitments, all sharing the
 *  given category/regionCode, concurrently (each request's CENTRAL_BUDGET_MS padding is
 *  per-request, not a server-wide lock, so this collapses wall time to ~one budget window
 *  instead of count * budget). Every publish sends soleAuthorAck: true so the first one in
 *  the series (which structurally is the sole author for that facet pair at that instant)
 *  is never refused with 409 regardless of publish ordering under concurrency. */
export async function publishDistinctAuthors(
  baseUrl: string,
  count: number,
  facetOverrides: Partial<{ category: string; regionCode: string; sensitive: boolean }> = {},
  sealedBodyPrefix = 'sealed-opaque',
): Promise<RawResponse[]> {
  const requests = Array.from({ length: count }, (_, i) =>
    post(baseUrl, '/declarations', {
      facets: makeFacets({ ...facetOverrides, authorCommitment: `author-${i}` }),
      sealedBody: `${sealedBodyPrefix}-${i}`,
      soleAuthorAck: true,
    }),
  );
  return Promise.all(requests);
}
