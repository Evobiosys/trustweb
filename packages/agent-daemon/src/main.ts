#!/usr/bin/env node
// Boot entry point for one persona's agent-daemon process. Reads env config
// (docs/API.md's table), wires the transport factory (TRANSPORT=mock|matrix
// — the ONLY place @resource-web/transport may be imported, per the brief),
// loads trusted_peers.json + optional fixtures, and starts the REST/WS server.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TrustEdgeSchema, ItemSchema, type TransportAdapter } from "@resource-web/protocol";
import {
  DidCommTransport,
  createIdentity,
  serializeIdentity,
  deserializeIdentity,
  getCardPayload,
  issueVrc,
  type Identity,
  type VerifiableRelationshipCredential,
} from "@resource-web/transport";
import { loadConfig, type EnvConfig } from "./config.js";
import { SqliteStore } from "./store/sqlite_store.js";
import { SystemClock, RealScheduler } from "./clock.js";
import { InMemoryBus, InMemoryTransport } from "./transport/in_memory_transport.js";
import { OllamaChatClient, OllamaEmbedClient } from "./matcher/clients.js";
import { Daemon, type DaemonConfig } from "./daemon/daemon.js";
import { startServer } from "./api/server.js";
import { createVrcDiService, FileRelationshipKeyStore } from "./api/vrc_di_service.js";

/**
 * Transport factory (brief §"Transport"): TRANSPORT=mock -> our own
 * InMemoryTransport (I5's swap-seam proof; also what tests/headless_demo use
 * directly). TRANSPORT=matrix -> @resource-web/transport's MatrixTransport —
 * import ONLY happens here. As of this worktree, @resource-web/transport is
 * still a stub (`export const PACKAGE = "transport"`, no MatrixTransport
 * export yet — a sibling worktree owns it), so the matrix arm cannot resolve
 * a real class yet. Rather than guess at its shape, this throws a clear,
 * actionable error; integration happens at merge (see docs/DAEMON.md).
 */
/**
 * Loads the did:peer:2 identity from `path`, minting + persisting a fresh one
 * if the file does not exist. Alpha: secret keys are stored as plaintext JSON
 * (documented in docs/TRANSPORT.md); a production build must use a keystore.
 */
function loadOrCreateIdentity(path: string, endpoint: string): Identity {
  if (existsSync(path)) {
    return deserializeIdentity(readFileSync(path, "utf8"));
  }
  const identity = createIdentity(endpoint);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeIdentity(identity), { encoding: "utf8", mode: 0o600 });
  return identity;
}

/**
 * Transport factory. TRANSPORT=mock -> in-process InMemoryTransport (I5 proof).
 * TRANSPORT=didcomm -> DidCommTransport (OpenVTC pillar): loads/creates the
 * DID identity, advertises this daemon's own http://host:port/didcomm inbound
 * endpoint, and returns the identity so main() can (a) use the DID as the peer
 * id and (b) mount the inbound handler + VRC export on the API server.
 * TRANSPORT=matrix remains a sibling worktree's wiring (unchanged).
 */
function createTransport(cfg: EnvConfig): { transport: TransportAdapter; identity?: Identity } {
  if (cfg.transport === "mock") {
    return { transport: new InMemoryTransport(new InMemoryBus()) };
  }
  if (cfg.transport === "didcomm") {
    if (!cfg.didIdentityPath) {
      throw new Error("TRANSPORT=didcomm requires DID_IDENTITY_PATH (path to the did:peer:2 identity file).");
    }
    const endpoint = `http://${cfg.didcommHost}:${cfg.agentPort}/didcomm`;
    const identity = loadOrCreateIdentity(cfg.didIdentityPath, endpoint);
    return { transport: new DidCommTransport(identity), identity };
  }
  // TODO(merge): import { MatrixTransport } from "@resource-web/transport" and
  // construct it here with the MATRIX_* env vars (sibling worktree owns this).
  throw new Error(
    "TRANSPORT=matrix is not yet wired in this worktree. Use TRANSPORT=mock or TRANSPORT=didcomm " +
      "(see docs/DAEMON.md, 'Transport factory')."
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = new SqliteStore(cfg.dbPath);

  if (cfg.trustedPeersPath && existsSync(cfg.trustedPeersPath)) {
    const raw = JSON.parse(readFileSync(cfg.trustedPeersPath, "utf8")) as unknown[];
    for (const entry of raw) {
      const edge = TrustEdgeSchema.parse(entry);
      if (!store.getTrustEdge(edge.peer)) store.putTrustEdge(edge);
    }
  }
  if (cfg.fixturesPath && existsSync(cfg.fixturesPath)) {
    const raw = JSON.parse(readFileSync(cfg.fixturesPath, "utf8")) as unknown[];
    for (const entry of raw) {
      const item = ItemSchema.parse(entry);
      if (!store.getItem(item.id)) store.putItem(item);
    }
  }

  const { transport, identity } = createTransport(cfg);

  // For didcomm, the DID is the canonical peer id (a DID is a valid PeerId).
  const peerId = cfg.transport === "didcomm" && identity ? identity.did : cfg.peerId;

  const daemonConfig: DaemonConfig = {
    personaName: cfg.personaName,
    peerId,
    accent: cfg.accent,
    statusDelayMs: cfg.statusDelayMs,
    defaultAskTtlMs: cfg.defaultAskTtlMs,
    matcher: { embedModel: cfg.embedModel, chatModel: cfg.chatModel, threshold: cfg.matchThreshold },
  };

  const clock = new SystemClock();
  const daemon = new Daemon({
    config: daemonConfig,
    store,
    transport,
    scheduler: new RealScheduler(clock),
    clock,
    embedClient: new OllamaEmbedClient({ baseUrl: cfg.ollamaUrl }),
    chatClient: new OllamaChatClient({ baseUrl: cfg.ollamaUrl }),
  });

  await daemon.init();

  // DIDComm inbound handler + VRC export, wired without touching daemon.ts
  // (other agents own daemon internals). Both are no-ops for non-didcomm.
  const didcommTransport = transport instanceof DidCommTransport ? transport : undefined;
  const server = await startServer(daemon, cfg.agentPort, {
    didcommInbound: didcommTransport ? (rawBody: string) => didcommTransport.receiveInbound(rawBody) : undefined,
    // VRCs are issued on demand from the CURRENT (non-expired) trust edges at
    // export time — self-asserted, not persisted (issuing+storing on edge
    // creation would require touching daemon.ts/store, owned by other tasks).
    trustExport:
      identity !== undefined
        ? (): VerifiableRelationshipCredential[] => {
            const now = Date.now();
            return store
              .getTrustEdges()
              .filter((edge) => new Date(edge.expires_at).getTime() > now)
              .map((edge) => issueVrc(identity, { peerDid: edge.peer, relationship: "trusted" }));
          }
        : undefined,
    // Keyring-compatible VRCs: one relationship key per edge, beside the device identity file (never the device DID).
    vrcDi:
      identity !== undefined && cfg.didIdentityPath
        ? createVrcDiService({ store, keys: FileRelationshipKeyStore.open(`${cfg.didIdentityPath}.relationships.json`) })
        : undefined,
    // Task 5: LAN exposure is opt-in via API_HOST — startServer reads
    // process.env.API_HOST itself when `host` is omitted here, so main.ts
    // doesn't need its own config plumbing for it.
    // Task 11+5: /api/card's DID fields (did:peer:2 + inbound endpoint),
    // present only when TRANSPORT=didcomm.
    cardExtra: identity !== undefined ? getCardPayload(identity, cfg.personaName) : undefined,
  });
  const boundHost = process.env.API_HOST ?? "127.0.0.1";
  // eslint-disable-next-line no-console
  console.log(`[agent-daemon] ${cfg.personaName} listening on http://${boundHost}:${server.port} (transport=${cfg.transport})`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void server.close().then(() => {
        store.close();
        process.exit(0);
      });
    });
  }
}

main().catch((err: unknown) => {
  console.error("[agent-daemon] fatal:", err);
  process.exitCode = 1;
});
