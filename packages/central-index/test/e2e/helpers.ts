// Shared HTTP + server-lifecycle helpers for the U5 end-to-end suite.
// Every test file in this directory starts its own server on an ephemeral
// port (listen(0)) against its own mkdtempSync data dir, and tears both
// down in afterAll/afterEach. Nothing here is imported by, or exported to,
// any file outside test/e2e/**.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLEAR_ALL_TARGET,
  canonicalActionMessage,
  toB64u,
  type SignedActionPayload,
  type SignedActionRequest,
} from '@resource-web/wot-policy';
import { createCentralServer, type CentralServer, type CentralServerOptions } from '../../src/server.js';

export const TEST_TIMEOUT_MS = 20_000;
export const LONG_TEST_TIMEOUT_MS = 30_000;

export interface TestServer {
  server: CentralServer;
  dataDir: string;
  baseUrl: string;
}

/** Starts a fresh server on an ephemeral port with a fresh temp data dir. Caller must
 *  await stopTestServer() on it, always, including on a failed setup. */
export async function startTestServer(
  jurisdiction?: string,
  extra: Partial<CentralServerOptions> = {},
): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'wot-central-index-e2e-'));
  const server = createCentralServer({ dataDir, jurisdiction, ...extra });
  const port = await server.listen(0);
  return { server, dataDir, baseUrl: `http://127.0.0.1:${port}` };
}

// ---------------------------------------------------------------------------
// Holder signing keys (B-20 option A)
// ---------------------------------------------------------------------------
// Every publish now registers an Ed25519 verification key with the declaration,
// and every withdraw/clear must be signed by the matching private key. These
// helpers keep that plumbing out of the assertions: a test that is about the
// floor should not be about key management.

export interface TestSigner {
  publicKeyB64u: string;
  signAction(payload: SignedActionPayload): Promise<SignedActionRequest>;
}

export async function makeSigner(): Promise<TestSigner> {
  const pair = (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey));
  const publicKeyB64u = toB64u(raw);
  return {
    publicKeyB64u,
    async signAction(payload: SignedActionPayload): Promise<SignedActionRequest> {
      const message = canonicalActionMessage(payload);
      const sig = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message);
      return { payload, signature: toB64u(new Uint8Array(sig)), publicKey: publicKeyB64u };
    },
  };
}

/** A nonce is only ever accepted once per server, so every call must be unique. */
export function testNonce(): string {
  return toB64u(globalThis.crypto.getRandomValues(new Uint8Array(18)));
}

export function withdrawPayload(id: string, authorCommitment: string): SignedActionPayload {
  return {
    action: 'withdraw',
    target: id,
    authorCommitment,
    nonce: testNonce(),
    expiresAt: Date.now() + 60_000,
  };
}

export function clearPayload(authorCommitment: string): SignedActionPayload {
  return {
    action: 'clear',
    target: CLEAR_ALL_TARGET,
    authorCommitment,
    nonce: testNonce(),
    expiresAt: Date.now() + 60_000,
  };
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
 *  is never refused with 409 regardless of publish ordering under concurrency.
 *
 *  Each author gets its OWN signing key, mirroring reality (one key per device) and making
 *  the clear-scope assertions meaningful: a clear signed by author 0's key must not touch
 *  author 1's records. `signer` overrides that when a test wants one key across several
 *  publishes, e.g. one holder publishing in two different facet pairs. */
export async function publishDistinctAuthors(
  baseUrl: string,
  count: number,
  facetOverrides: Partial<{ category: string; regionCode: string; sensitive: boolean }> = {},
  sealedBodyPrefix = 'sealed-opaque',
  signer?: TestSigner,
): Promise<Array<RawResponse & { signer: TestSigner }>> {
  const signers = await Promise.all(
    Array.from({ length: count }, () => (signer ? Promise.resolve(signer) : makeSigner())),
  );
  const requests = signers.map((s, i) =>
    post(baseUrl, '/declarations', {
      facets: makeFacets({ ...facetOverrides, authorCommitment: `author-${i}` }),
      sealedBody: `${sealedBodyPrefix}-${i}`,
      holderPubKey: s.publicKeyB64u,
      soleAuthorAck: true,
    }).then((res) => ({ ...res, signer: s })),
  );
  return Promise.all(requests);
}
