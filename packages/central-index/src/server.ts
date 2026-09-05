// Central-index HTTP server, node:http only, no framework. Implements
// handover §4's API. The floor and asker protection are applied here,
// server-side, using @resource-web/wot-policy's own functions — the
// server can never be more permissive than the device, because it is
// running the same code the device runs.
//
// I3 (indistinguishable no): below-k, declined (malformed/invalid input on
// /query) and no-match all resolve through the single sendNo() below, which
// writes indistinguishableNo()'s exact bytes with an explicit content-length
// derived from those bytes. There is exactly one call site that constructs
// that response body; nothing reformats or re-serializes it.
//
// I3 (timing): every /query and every /declarations response (including the
// jurisdiction/health JSON surface, per §4's "all responses padded to
// CENTRAL_BUDGET_MS") is padded via settleAt(t0, CENTRAL_BUDGET_MS), with t0
// captured as the first statement of the request handler, before the body
// is even read. GET / (the static status page) is the one exception: it is
// not part of the JSON API table and padding a human loading a status page
// by 900ms buys no privacy.
//
// Sealed sender: protectAsker() runs immediately after the query body is
// parsed and validated, before anything else touches the payload. Nothing
// in this file logs a request body, and no query is ever persisted — only
// publish and tombstone records reach the store.

import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateFloor,
  requiresSoleAuthorAck,
  protectAsker,
  indistinguishableNo,
  settleAt,
  CENTRAL_BUDGET_MS,
} from '@resource-web/wot-policy';
import { loadJurisdiction, type JurisdictionConfig } from './jurisdiction.js';
import { DeclarationStore } from './store.js';
import type { DeclarationFacets, DeclarationHit, PublishedDeclaration } from './types.js';

const MAX_BODY_BYTES = 2_000_000;

export interface CentralServer {
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  readonly port: number;
}

export interface CentralServerOptions {
  dataDir: string;
  jurisdiction?: string;
  host?: string;
  publicDir?: string;
}

/** Loopback addresses this server is allowed to bind while withdrawal proofs are unverified. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Withdrawal and clear currently act on a plain `id` / `authorCommitment` with no signature
 * check (see README "Known gap" and docs/central-rag.md). An `authorCommitment` is a
 * deterministic hash, not a secret, so on a reachable network anyone who learns one could
 * wipe that holder's declarations. That is a capability the local-first path grants to
 * nobody, and this layer must never widen exposure beyond the local-first policy model.
 *
 * Until a signature scheme lands, binding anything other than loopback is refused outright
 * rather than left to deployment discipline. `WOT_CENTRAL_UNSAFE_BIND=1` exists only so the
 * refusal can be exercised in a test; it is not a supported deployment option and says so.
 */
function assertBindAllowed(host: string): void {
  if (LOOPBACK_HOSTS.has(host)) return;
  if (process.env.WOT_CENTRAL_UNSAFE_BIND === '1') return;
  throw new Error(
    `wot-central-index refuses to bind ${host}: withdrawal and clear are not signature-verified ` +
      'yet, so a reachable instance would let anyone who learns an authorCommitment wipe that ' +
      "holder's declarations. Bind loopback only until the signing scheme lands.",
  );
}

export function createCentralServer(opts: CentralServerOptions): CentralServer {
  const store = new DeclarationStore(opts.dataDir);
  const jurisdiction = loadJurisdiction(opts.jurisdiction);
  const host = opts.host ?? '127.0.0.1';
  assertBindAllowed(host);
  const publicDir = opts.publicDir;

  let boundPort = 0;

  const httpServer: HttpServer = createHttpServer((req, res) => {
    void handleRequest(req, res, store, jurisdiction, publicDir);
  });

  return {
    get port(): number {
      return boundPort;
    },
    listen(port = 0): Promise<number> {
      return new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          const addr = httpServer.address();
          boundPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve(boundPort);
        });
      });
    },
    async close(): Promise<void> {
      // Node 22+/26: drops any lingering keep-alive sockets so close()'s
      // callback actually fires. Without this, a client that opened a
      // connection and never sent another request holds the server open
      // and an in-process test suite that starts/stops many servers hangs.
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: DeclarationStore,
  jurisdiction: JurisdictionConfig,
  publicDir: string | undefined,
): Promise<void> {
  const t0 = Date.now();
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/health') {
      await respondJson(res, t0, 200, { ok: true, instanceId: jurisdiction.instanceId });
      return;
    }

    if (method === 'GET' && url.pathname === '/jurisdiction') {
      await respondJson(res, t0, 200, jurisdiction);
      return;
    }

    if (method === 'GET' && url.pathname === '/') {
      serveStatusPage(res, publicDir); // not padded: static asset, not the JSON API surface
      return;
    }

    if (method === 'POST' && url.pathname === '/declarations') {
      await handlePublish(req, res, t0, store, jurisdiction);
      return;
    }

    const withdrawMatch = method === 'DELETE' ? /^\/declarations\/([^/]+)$/.exec(url.pathname) : null;
    if (withdrawMatch) {
      await drainBody(req); // the signed withdrawal proof; see README for verification status
      const id = decodeURIComponent(withdrawMatch[1]);
      store.withdraw(id);
      // 204 for unknown ids too: a 404 here would leak whether an id ever existed.
      await respondEmpty(res, t0, 204);
      return;
    }

    if (method === 'GET' && url.pathname === '/declarations') {
      const authorCommitment = url.searchParams.get('authorCommitment');
      if (!authorCommitment) {
        await respondJson(res, t0, 400, { reason: 'authorCommitment-required' });
        return;
      }
      const declarations = store.listByAuthor(authorCommitment).map((d) => ({
        id: d.id,
        publishedAt: d.publishedAt,
        residency: d.residency,
      }));
      await respondJson(res, t0, 200, { declarations });
      return;
    }

    if (method === 'POST' && url.pathname === '/query') {
      await handleQuery(req, res, t0, store);
      return;
    }

    if (method === 'POST' && url.pathname === '/clear') {
      await handleClear(req, res, t0, store);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handlePublish(
  req: IncomingMessage,
  res: ServerResponse,
  t0: number,
  store: DeclarationStore,
  jurisdiction: JurisdictionConfig,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = await readJsonBody(req);
  } catch {
    await respondJson(res, t0, 400, { reason: 'malformed-request' });
    return;
  }
  const request = validatePublishRequest(parsed);
  if (!request) {
    await respondJson(res, t0, 400, { reason: 'malformed-request' });
    return;
  }

  // Server-side, using the same corpus wot-policy's own callers use: a declaration whose
  // facets can only ever have one author does not get real k-anonymity from a higher constant.
  const corpus = store.allFacets();
  if (requiresSoleAuthorAck(request.facets, corpus) && request.soleAuthorAck !== true) {
    await respondJson(res, t0, 409, { reason: 'sole-author-ack-required' });
    return;
  }

  const declaration: PublishedDeclaration = {
    id: randomUUID(),
    facets: request.facets,
    sealedBody: request.sealedBody, // opaque; never decoded, never inspected
    publishedAt: new Date().toISOString(),
    instanceId: jurisdiction.instanceId,
    residency: jurisdiction.residency,
  };
  store.publish(declaration);

  await respondJson(res, t0, 201, {
    id: declaration.id,
    publishedAt: declaration.publishedAt,
    instanceId: declaration.instanceId,
    residency: declaration.residency,
  });
}

async function handleQuery(req: IncomingMessage, res: ServerResponse, t0: number, store: DeclarationStore): Promise<void> {
  let parsed: unknown;
  try {
    parsed = await readJsonBody(req);
  } catch {
    // Malformed input on /query must not be distinguishable from a genuine no: a well-formed
    // attacker probing for parser leniency gets exactly the same bytes as a real no-match.
    await sendNo(res, t0);
    return;
  }
  const request = validateQueryRequest(parsed);
  if (!request) {
    await sendNo(res, t0);
    return;
  }

  // Strip asker identity before anything else touches the payload — sealed sender.
  const protectedRequest = protectAsker(request, request.facets.sensitive);
  const { facets } = protectedRequest;

  const matches = store.matching(facets.category, facets.regionCode);
  // Zero matches naturally evaluates as 'below' (0 distinct authors < any positive floor), so
  // below-k and no-match already share one code path here; nothing separate is needed for either.
  const verdict = evaluateFloor({ candidates: matches.map((m) => m.facets) });
  if (verdict.kind === 'below') {
    await sendNo(res, t0);
    return;
  }

  const hits: DeclarationHit[] = matches.map((m) => ({
    id: m.id,
    category: m.facets.category,
    regionCode: m.facets.regionCode,
    publishedAt: m.publishedAt,
    sealedBody: m.sealedBody,
  }));
  await respondJson(res, t0, 200, { hits });
}

async function handleClear(req: IncomingMessage, res: ServerResponse, t0: number, store: DeclarationStore): Promise<void> {
  let parsed: unknown;
  try {
    parsed = await readJsonBody(req);
  } catch {
    await respondJson(res, t0, 400, { reason: 'malformed-request' });
    return;
  }
  const authorCommitment = validateClearRequest(parsed);
  if (!authorCommitment) {
    await respondJson(res, t0, 400, { reason: 'authorCommitment-required' });
    return;
  }
  store.clearAuthor(authorCommitment);
  await respondEmpty(res, t0, 204);
}

// ---------------------------------------------------------------------------
// I3 response helpers — one construction site each
// ---------------------------------------------------------------------------

/** The one and only place indistinguishableNo()'s bytes are written to a response. Below-k,
 *  declined and no-match all call this, and only this, so the bytes and headers can never drift
 *  between call sites. */
async function sendNo(res: ServerResponse, t0: number): Promise<void> {
  await settleAt(t0, CENTRAL_BUDGET_MS);
  const body = indistinguishableNo();
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': body.byteLength,
  });
  res.end(Buffer.from(body));
}

async function respondJson(res: ServerResponse, t0: number, status: number, body: unknown): Promise<void> {
  await settleAt(t0, CENTRAL_BUDGET_MS);
  const payload = Buffer.from(JSON.stringify(body), 'utf-8');
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': payload.byteLength });
  res.end(payload);
}

async function respondEmpty(res: ServerResponse, t0: number, status: number): Promise<void> {
  await settleAt(t0, CENTRAL_BUDGET_MS);
  res.writeHead(status);
  res.end();
}

function serveStatusPage(res: ServerResponse, publicDir: string | undefined): void {
  if (publicDir) {
    try {
      const html = readFileSync(join(publicDir, 'status.html'), 'utf-8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    } catch {
      // falls through to 404 below — missing status.html is handled gracefully, not a crash
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

// ---------------------------------------------------------------------------
// Body reading and validation
// ---------------------------------------------------------------------------

async function drainBody(req: IncomingMessage): Promise<void> {
  await readBody(req);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString('utf-8'));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    received += buf.length;
    if (received > MAX_BODY_BYTES) {
      req.destroy();
      throw new Error('request body too large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function isDeclarationFacets(value: unknown): value is DeclarationFacets {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.category === 'string' &&
    typeof v.regionCode === 'string' &&
    typeof v.authorCommitment === 'string' &&
    typeof v.sensitive === 'boolean'
  );
}

interface PublishRequest {
  facets: DeclarationFacets;
  sealedBody: string;
  soleAuthorAck?: boolean;
}

function validatePublishRequest(value: unknown): PublishRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isDeclarationFacets(v.facets)) return null;
  if (typeof v.sealedBody !== 'string') return null;
  if (v.soleAuthorAck !== undefined && typeof v.soleAuthorAck !== 'boolean') return null;
  return { facets: v.facets, sealedBody: v.sealedBody, soleAuthorAck: v.soleAuthorAck };
}

interface QueryRequest {
  facets: DeclarationFacets;
  askerDid?: string;
  askerLabel?: string;
}

function validateQueryRequest(value: unknown): QueryRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isDeclarationFacets(v.facets)) return null;
  if (v.askerDid !== undefined && typeof v.askerDid !== 'string') return null;
  if (v.askerLabel !== undefined && typeof v.askerLabel !== 'string') return null;
  return { facets: v.facets, askerDid: v.askerDid, askerLabel: v.askerLabel };
}

function validateClearRequest(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return typeof v.authorCommitment === 'string' ? v.authorCommitment : null;
}
