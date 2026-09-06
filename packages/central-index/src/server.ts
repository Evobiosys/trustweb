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
//
// Signed withdraw and clear (B-20 option A, 2026-09-06): a holder registers an
// Ed25519 verification key WITH each declaration at publish time, and every
// later DELETE /declarations/:id and POST /clear must carry a signature over
// the canonical message {action, target, authorCommitment, nonce, expiresAt}.
// The canonicalisation and the verify live in @resource-web/wot-policy, shared
// with the device; the single-use nonce registry and the per-key rate limiter
// are server state and live next door in nonces.ts and rate_limit.ts. Old,
// unsigned requests are refused with 403 { reason: 'signature-required' }, out
// loud rather than silently, because a holder whose clear did not happen has to
// find out. This is what makes the non-loopback bind below defensible at all.

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
  verifySignedAction,
  CENTRAL_BUDGET_MS,
  CLEAR_ALL_TARGET,
  fromB64u,
} from '@resource-web/wot-policy';
import { loadJurisdiction, type JurisdictionConfig } from './jurisdiction.js';
import { NonceRegistry } from './nonces.js';
import { RateLimiter, DEFAULT_RATE_LIMIT, type RateLimitConfig } from './rate_limit.js';
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
  /**
   * Overrides the jurisdiction config's `allowPublicBind` for in-process
   * callers. `src/bin.ts` deliberately never passes it, so the ONLY way a real
   * deployment reaches a non-loopback address is the residency config file --
   * an operator writing it down, in the same file that declares the residency
   * and the lawful basis, not a flag someone typed once on a command line.
   */
  allowPublicBind?: boolean;
  /** Withdraw/clear rate limit per holder public key. Defaults to DEFAULT_RATE_LIMIT. */
  rateLimit?: RateLimitConfig;
}

/** Loopback addresses, always allowed. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Bind policy, in three layers that must stay separate.
 *
 * 1. Loopback is always allowed. It is the default and the development shape.
 * 2. `WOT_CENTRAL_UNSAFE_BIND=1` is a TEST-ONLY escape hatch, unchanged from
 *    the pre-signing build, kept separate on purpose so the residency-config
 *    route below can never be tested through it or confused with it. It is not
 *    a supported deployment option and never was.
 * 3. `allowPublicBind: true` in the jurisdiction (residency) config is the
 *    supported route to a reachable instance. It became defensible only once
 *    withdraw and clear started verifying a holder signature (B-20 option A):
 *    before that, an `authorCommitment` -- a deterministic hash, not a secret --
 *    was enough for any passer-by to wipe a holder's declarations, a capability
 *    the local-first path grants to nobody. That hole is closed; what remains
 *    on a reachable instance is the ordinary transport-security work named in
 *    DEPLOY.md (TLS terminated at the jurisdiction host).
 *
 * Anything else still refuses to start, rather than being left to deployment
 * discipline.
 */
function assertBindAllowed(host: string, allowPublicBind: boolean): void {
  if (LOOPBACK_HOSTS.has(host)) return;
  if (process.env.WOT_CENTRAL_UNSAFE_BIND === '1') return;
  if (allowPublicBind) return;
  throw new Error(
    `wot-central-index refuses to bind ${host}: this instance's jurisdiction config does not set ` +
      'allowPublicBind. Withdraw and clear are signature-verified, so a reachable bind is ' +
      'supported, but an operator has to declare it in the residency config rather than reach it ' +
      'by accident. Set "allowPublicBind": true in the jurisdiction file, or bind loopback.',
  );
}

export function createCentralServer(opts: CentralServerOptions): CentralServer {
  const store = new DeclarationStore(opts.dataDir);
  const jurisdiction = loadJurisdiction(opts.jurisdiction);
  const host = opts.host ?? '127.0.0.1';
  // `=== true` OUTSIDE the ??, not inside it: an option that arrived as the
  // string 'true' or the number 1 must fall through to refused, the same way
  // the jurisdiction loader treats its own field. Conservative defaults (I9).
  assertBindAllowed(host, (opts.allowPublicBind ?? jurisdiction.allowPublicBind) === true);
  const publicDir = opts.publicDir;
  const guards: ActionGuards = {
    nonces: new NonceRegistry(),
    limiter: new RateLimiter(opts.rateLimit ?? DEFAULT_RATE_LIMIT),
  };

  let boundPort = 0;

  const httpServer: HttpServer = createHttpServer((req, res) => {
    void handleRequest(req, res, store, jurisdiction, publicDir, guards);
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

/** The stateful half of a signed action: replay protection and abuse limiting.
 *  One instance per server, never per request. */
export interface ActionGuards {
  nonces: NonceRegistry;
  limiter: RateLimiter;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: DeclarationStore,
  jurisdiction: JurisdictionConfig,
  publicDir: string | undefined,
  guards: ActionGuards,
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
      await handleWithdraw(req, res, t0, store, guards, decodeURIComponent(withdrawMatch[1]));
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
      await handleClear(req, res, t0, store, guards);
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
    // Registered here and nowhere else: this is the only moment a key is bound
    // to a declaration, and every later withdraw or clear is checked against it.
    holderPubKey: request.holderPubKey,
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

// ---------------------------------------------------------------------------
// Signed actions: withdraw and clear (B-20 option A)
// ---------------------------------------------------------------------------

/**
 * The crypto check (shared with the device, in @resource-web/wot-policy) plus
 * this server's own stateful checks, in the order that fails cheapest first.
 *
 * Rate limiting sits AFTER verification and BEFORE the nonce claim, on purpose:
 * after, so an unsigned flood never creates limiter entries and never lets an
 * attacker fill the table under keys they do not hold; before, so a rejected
 * burst does not burn the holder's own nonce -- a rate-limited request can be
 * retried with the same signature once the window clears.
 */
async function authorizeAction(
  body: unknown,
  expectedAction: 'withdraw' | 'clear',
  expectedTarget: string,
  guards: ActionGuards,
): Promise<{ ok: true; publicKey: string; authorCommitment: string } | { ok: false; status: number; reason: string }> {
  const verdict = await verifySignedAction({ body, expectedAction, expectedTarget });
  if (verdict.kind === 'rejected') return { ok: false, status: 403, reason: verdict.reason };

  const { payload, publicKey } = verdict.request;
  if (!guards.limiter.allow(publicKey)) return { ok: false, status: 429, reason: 'rate-limited' };
  if (!guards.nonces.claim(payload.nonce, payload.expiresAt)) {
    return { ok: false, status: 403, reason: 'nonce-reused' };
  }
  return { ok: true, publicKey, authorCommitment: payload.authorCommitment };
}

/**
 * DELETE /declarations/:id
 *
 * NOT AN EXISTENCE ORACLE. The pre-signing build already answered 204 for
 * unknown ids so a 404 could not confirm that an id had ever existed, and that
 * invariant survives verification intact: a VALID signature always gets 204,
 * whether the id exists, was already withdrawn, or belongs to another holder.
 * Only an unauthorised caller sees anything else, and what they see (403) says
 * nothing about the id -- they would get the identical 403 for an id that does
 * not exist. The erase itself happens only when the record exists AND its
 * registered key is the key that signed.
 */
async function handleWithdraw(
  req: IncomingMessage,
  res: ServerResponse,
  t0: number,
  store: DeclarationStore,
  guards: ActionGuards,
  id: string,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = await readJsonBody(req);
  } catch {
    parsed = undefined; // an unparseable body is an unsigned one; authorizeAction names it
  }
  const auth = await authorizeAction(parsed, 'withdraw', id, guards);
  if (!auth.ok) {
    await respondJson(res, t0, auth.status, { reason: auth.reason });
    return;
  }

  const record = store.get(id);
  if (record && record.holderPubKey === auth.publicKey) store.withdraw(id);
  await respondEmpty(res, t0, 204);
}

/**
 * POST /clear -- the debrief's "direct channel to clear the app".
 *
 * The authorCommitment is read from the SIGNED payload and never from a
 * top-level body field: a value the caller can set outside the signature would
 * re-open the exact hole this scheme closes. Scope is doubly bounded -- the
 * commitment AND the registered key must both match (see store.clearAuthor) --
 * so a valid signature can only ever erase what that key itself published.
 *
 * 204 regardless of how many records were removed, including zero: a count, or
 * a 404 on "no such holder", would turn this endpoint into a probe for whether
 * a given commitment has ever published anything.
 */
async function handleClear(
  req: IncomingMessage,
  res: ServerResponse,
  t0: number,
  store: DeclarationStore,
  guards: ActionGuards,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = await readJsonBody(req);
  } catch {
    parsed = undefined;
  }
  const auth = await authorizeAction(parsed, 'clear', CLEAR_ALL_TARGET, guards);
  if (!auth.ok) {
    await respondJson(res, t0, auth.status, { reason: auth.reason });
    return;
  }

  store.clearAuthor(auth.authorCommitment, auth.publicKey);
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
  holderPubKey: string;
  soleAuthorAck?: boolean;
}

/** A base64url raw Ed25519 verification key: exactly 32 bytes, nothing else. */
function isHolderPubKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const bytes = fromB64u(value);
  return bytes !== null && bytes.length === 32;
}

/**
 * `holderPubKey` is REQUIRED, not optional. An optional key would mean a
 * declaration could exist that nobody can ever prove they published, and the
 * only ways to remove it would be the retention window or the operator -- the
 * irreversible central exposure this layer is forbidden to add. Refusing the
 * publish is the conservative default (I9).
 */
function validatePublishRequest(value: unknown): PublishRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isDeclarationFacets(v.facets)) return null;
  if (typeof v.sealedBody !== 'string') return null;
  if (!isHolderPubKey(v.holderPubKey)) return null;
  if (v.soleAuthorAck !== undefined && typeof v.soleAuthorAck !== 'boolean') return null;
  return {
    facets: v.facets,
    sealedBody: v.sealedBody,
    holderPubKey: v.holderPubKey,
    soleAuthorAck: v.soleAuthorAck,
  };
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
