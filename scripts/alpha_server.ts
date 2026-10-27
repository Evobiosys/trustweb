#!/usr/bin/env -S node --experimental-strip-types
// alpha_server.ts — Task 8: boots N agent-daemon personas IN ONE PROCESS for
// the one-command LAN alpha (`pnpm alpha`). Each persona gets its own DID
// identity + SQLite store + REST/WS server bound on 0.0.0.0, wired to a real
// DidCommTransport (Task 11's OpenVTC pillar — same mechanism the two-daemon
// integration test in
// packages/agent-daemon/src/api/didcomm_lifecycle.integration.test.ts proves
// works over real HTTP).
//
// Task 10 (core-transport-plan.md §0 mediator-only core): each persona's
// DidCommTransport now delivers over a `LadderChannel([relay, lan_http])`
// instead of a bare HttpPostChannel. Exactly ONE persona (`mediatorKey`,
// defaults to the first persona) also runs a `RelayServer` — the trust-graph
// mediator ("this computer") every persona's `RelayChannel` targets, mounted
// onto that persona's own HTTP server via server.ts's additive `relayServer`
// extras hook (attachDrainWss + POST /relay/send). The LAN-HTTP `POST
// /didcomm` floor (rung "lan_http") keeps working exactly as before — the
// ladder falls back to it if the relay rung fails.
//
// `bootPersonas` is the reusable core: the CLI entry point below calls it with
// personas read from alpha/personas.json + the detected LAN IP, and
// scripts/alpha_server.smoke.test.ts calls it directly with 2 ephemeral-port
// personas on 127.0.0.1 — so the smoke test exercises this exact boot code,
// not a reimplementation.
//
// Coordination note (Task 8 brief): this script touches only
// packages/agent-daemon's *public class surface* via relative src imports
// (the same pattern packages/agent-daemon/src/main.ts and its own integration
// test already use) — no daemon internals are modified.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DidCommTransport,
  createIdentity,
  serializeIdentity,
  deserializeIdentity,
  getCardPayload,
  issueVrc,
  LadderChannel,
  RelayChannel,
  RelayServer,
  parseSenderAuthMode,
  SqliteRelayQueueStore,
  HttpPostChannel,
  SqliteDedupStore,
  type Identity,
  type VerifiableRelationshipCredential,
} from "@resource-web/transport";
import { SqliteStore } from "../packages/agent-daemon/src/store/sqlite_store.js";
import { SystemClock, RealScheduler } from "../packages/agent-daemon/src/clock.js";
import { OllamaChatClient, OllamaEmbedClient } from "../packages/agent-daemon/src/matcher/clients.js";
import { DEFAULT_MATCH_THRESHOLD } from "../packages/agent-daemon/src/matcher/matcher.js";
import { Daemon, type DaemonConfig } from "../packages/agent-daemon/src/daemon/daemon.js";
import { startServer, type StartedServer } from "../packages/agent-daemon/src/api/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

export interface PersonaConfig {
  key: string;
  name: string;
  port: number;
  app: string;
}

export interface BootedPersona {
  key: string;
  name: string;
  port: number;
  app: string;
  did: string;
  daemon: Daemon;
  store: SqliteStore;
  server: StartedServer;
  /** This persona's delivery ladder (Task 10) — closed by shutdownAll (closes its RelayChannel drain connection to the mediator). */
  channel: LadderChannel;
  /** This persona's replay-protection store (Task 2/10) — closed by shutdownAll to release its SQLite handle. */
  dedup: SqliteDedupStore;
  /** Present ONLY on the persona hosting the mediator (Task 10's `mediatorKey`) — closed by shutdownAll. */
  relayServer?: RelayServer;
  /** The mediator's durable relay queue (finding 4) — present only on the mediator persona; its SQLite handle is closed by shutdownAll. */
  relayQueueStore?: SqliteRelayQueueStore;
}

export interface BootOptions {
  /** LAN IP (or hostname) advertised in each persona's DID service endpoint + printed join URLs. */
  hostIp: string;
  /** Directory holding `<key>/identity.json` + `<key>/state.db` per persona. */
  stateDir: string;
  /** Bind address for each daemon's HTTP server. Default "0.0.0.0" (LAN-open — see ALPHA.md's security box). */
  apiHost?: string;
  /** Skip seeding all-to-all trust edges (used by callers that want to seed differently, e.g. tests). Default false. */
  skipTrustSeed?: boolean;
  ollamaUrl?: string;
  /**
   * Which persona (by `key`) hosts the single trust-graph mediator
   * (RelayServer, Task 10, core-transport-plan.md §0 mediator-only core).
   * Defaults to `personas[0].key`. Every persona's `RelayChannel` targets
   * this one node — single-mediator alpha, so sender and recipient always
   * share a mediator and store-and-forward works.
   */
  mediatorKey?: string;
  /**
   * Base ORIGIN of an EXTERNAL mediator relay (e.g. `https://questhub.eco`,
   * the questhub deployment). When set (also readable from
   * `MEDIATOR_RELAY_URL`), every persona's RelayChannel + advertised
   * `relay_url` point at this public relay and NO local RelayServer is hosted —
   * this is what makes the alpha work cross-network / off the churning LAN IP.
   * Unset ⇒ the mediator persona co-hosts a local relay on its own HTTP server.
   */
  mediatorRelayUrl?: string;
}

/**
 * Loads a persona's did:peer:2 identity from `path`, minting + persisting a
 * fresh one if the file does not exist. Mirrors main.ts's
 * `loadOrCreateIdentity` exactly (duplicated rather than imported: that
 * function is private to main.ts and this script must not modify daemon
 * internals).
 *
 * NOTE: a did:peer:2 bakes its service endpoint into the DID string itself,
 * so an existing identity is loaded as-is even if `hostIp` changed since it
 * was minted (e.g. a new WiFi network/DHCP lease) — the DID is also this
 * persona's trust-edge peer id, so silently reminting would orphan every
 * trust edge that references it. If join URLs stop working after a network
 * change, delete `alpha/state/` and let the next `pnpm alpha` remint fresh
 * identities (see ALPHA.md's troubleshooting section).
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
 * Boots every persona in `personas` in this one process: identity -> store ->
 * DidCommTransport -> Daemon -> REST/WS server, in that order for ALL
 * personas (identities first) before seeding trust, because trust edges are
 * keyed by DID and DIDs only exist after `loadOrCreateIdentity`.
 */
export async function bootPersonas(personas: PersonaConfig[], opts: BootOptions): Promise<BootedPersona[]> {
  if (personas.length === 0) throw new Error("bootPersonas: personas must not be empty");
  const apiHost = opts.apiHost ?? "0.0.0.0";
  const ollamaUrl = opts.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  const mediatorKey = opts.mediatorKey ?? personas[0].key;

  // Pass 1: identities (needed up front — a persona's DID is its peer id AND
  // the value every OTHER persona's trust edge points at).
  const identities = new Map<string, Identity>();
  for (const persona of personas) {
    const personaDir = join(opts.stateDir, persona.key);
    mkdirSync(personaDir, { recursive: true });
    const endpoint = `http://${opts.hostIp}:${persona.port}/didcomm`;
    identities.set(persona.key, loadOrCreateIdentity(join(personaDir, "identity.json"), endpoint));
  }

  const mediatorIdentity = identities.get(mediatorKey);
  if (!mediatorIdentity) throw new Error(`bootPersonas: mediatorKey "${mediatorKey}" is not a configured persona`);
  // Task 10 (core-transport-plan.md §0 mediator-only core): every persona's
  // RelayChannel targets this ONE node ("this computer") as the trust-graph
  // mediator. Reuse the mediator's own DIDComm service endpoint as the relay
  // base URL — RelayChannel resolves its ingress ("/relay/send") and drain
  // ("/relay/drain") paths as ABSOLUTE paths off that URL's origin (see
  // relay_channel.ts's `new URL(ingressPath, endpoint)` / `u.pathname =
  // drainPath`), so no second endpoint format is needed: a relay is just
  // another did:peer:2 whose service block resolves to a URL (did_identity.ts's
  // CardPayload doc comment).
  // When an external relay is configured (MEDIATOR_RELAY_URL / opts), delegate
  // store-and-forward to it (e.g. the internet-reachable questhub deployment) —
  // this is what lets the alpha work cross-network, off the churning LAN IP.
  // Every persona's RelayChannel + advertised relay_url then point at that
  // public origin. Otherwise the mediator persona co-hosts a local RelayServer
  // on its own HTTP server, with a DURABLE SQLite queue (finding 4) so held
  // mail for an offline recipient survives a relay restart. Closed by
  // shutdownAll below.
  const externalRelayUrl = opts.mediatorRelayUrl ?? process.env.MEDIATOR_RELAY_URL;
  const mediatorEndpoint = externalRelayUrl ?? mediatorIdentity.serviceEndpoint;

  let relayQueueStore: SqliteRelayQueueStore | undefined;
  let relayServer: RelayServer | undefined;
  if (!externalRelayUrl) {
    relayQueueStore = new SqliteRelayQueueStore(join(opts.stateDir, mediatorKey, "relay_queue.db"));
    relayServer = new RelayServer({ queueStore: relayQueueStore, senderAuth: parseSenderAuthMode(process.env.RELAY_SENDER_AUTH) });
  }

  // Pass 2: store + transport + daemon + server, per persona.
  const booted: BootedPersona[] = [];
  for (const persona of personas) {
    const identity = identities.get(persona.key)!;
    const personaDir = join(opts.stateDir, persona.key);
    const store = new SqliteStore(join(personaDir, "state.db"));
    const dedup = new SqliteDedupStore(join(personaDir, "dedup.db"));
    const channel = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: new RelayChannel(identity, { relayEndpoints: [mediatorEndpoint] }) },
        { name: "lan_http", channel: new HttpPostChannel(identity) },
      ],
    });
    const transport = new DidCommTransport(identity, { channel, dedup });
    const clock = new SystemClock();

    const config: DaemonConfig = {
      personaName: persona.name,
      peerId: identity.did,
      accent: "neutral",
      statusDelayMs: 30_000, // I3: uniform PASS/PENDING delay, no jitter.
      defaultAskTtlMs: 86_400_000,
      matcher: { embedModel: "qwen3-embedding:8b", chatModel: "qwen3:4b", threshold: DEFAULT_MATCH_THRESHOLD },
    };

    const daemon = new Daemon({
      config,
      store,
      transport,
      scheduler: new RealScheduler(clock),
      clock,
      embedClient: new OllamaEmbedClient({ baseUrl: ollamaUrl }),
      chatClient: new OllamaChatClient({ baseUrl: ollamaUrl }),
    });
    await daemon.init();

    const isMediator = persona.key === mediatorKey;
    const server = await startServer(daemon, persona.port, {
      host: apiHost,
      didcommInbound: (rawBody: string) => transport.receiveInbound(rawBody),
      trustExport: (): VerifiableRelationshipCredential[] => {
        const now = Date.now();
        return store
          .getTrustEdges()
          .filter((edge) => new Date(edge.expires_at).getTime() > now)
          .map((edge) => issueVrc(identity, { peerDid: edge.peer, relationship: "trusted" }));
      },
      // Every persona's card advertises the shared mediator's DID (Task 10) —
      // a peer resolves it via resolveDidPeer, exactly like any other DID.
      // `relay_url` (Task 5) additionally exposes the mediator's HTTP base
      // ORIGIN so a daemonless browser peer scanning this card's connect URL
      // can point its RelayClient straight at it (browsers can't resolve a
      // did:peer service block, and relays[] carries DIDs, not URLs). Derived
      // from the same `mediatorEndpoint` the RelayChannel above targets — its
      // origin, since relay_client (like RelayChannel) resolves the absolute
      // `/relay/send` + `/relay/drain` paths off the URL's origin.
      cardExtra: { ...getCardPayload(identity, persona.name, { relays: [mediatorIdentity.did] }), relay_url: new URL(mediatorEndpoint).origin },
      ...(isMediator && relayServer ? { relayServer } : {}),
    });

    booted.push({
      key: persona.key,
      name: persona.name,
      port: persona.port,
      app: persona.app,
      did: identity.did,
      daemon,
      store,
      server,
      channel,
      dedup,
      relayServer: isMediator ? relayServer : undefined,
      relayQueueStore: isMediator ? relayQueueStore : undefined,
    });
  }

  if (!opts.skipTrustSeed) seedAllToAllTrust(booted);

  return booted;
}

/** All-to-all "friend"-level trust edges, idempotent: skips any (persona, peer) pair whose edge already exists. */
function seedAllToAllTrust(booted: BootedPersona[]): void {
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  let seeded = 0;
  for (const a of booted) {
    for (const b of booted) {
      if (a.key === b.key) continue;
      if (a.store.getTrustEdge(b.did)) continue; // already seeded (idempotent re-run)
      a.store.putTrustEdge({ peer: b.did, display: b.name, level: "friend", created_at: nowIso, expires_at: expiresIso });
      seeded += 1;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[alpha_server] seeded ${seeded} trust edge(s) (${booted.length * (booted.length - 1) - seeded} already present)`);
}

/**
 * Closes every booted persona's server + store + ladder + dedup, and the
 * mediator's RelayServer (Task 10). Safe to call once; awaits full shutdown
 * before returning. Also safe if a caller already closed a given persona's
 * `server` itself (e.g. to simulate that persona going offline for a test) —
 * `StartedServer.close()` tolerates being called twice (verified: a second
 * `httpServer.close()`/`wss.close()` resolves rather than throwing).
 */
export async function shutdownAll(booted: BootedPersona[]): Promise<void> {
  await Promise.all(
    booted.map(async (p) => {
      await p.channel.close(); // closes this persona's RelayChannel drain connection to the mediator
      if (p.relayServer) await p.relayServer.close(); // the mediator persona: terminate live drains + its own drain wss
      await p.server.close();
      p.dedup.close();
      p.store.close();
      if (p.relayQueueStore) p.relayQueueStore.close(); // release the durable relay-queue SQLite handle (finding 4)
    })
  );
}

/** `HOST_IP` env override, else `ipconfig getifaddr en0` -> `en1` -> `127.0.0.1` (macOS). */
export function detectHostIp(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HOST_IP) return env.HOST_IP;
  for (const iface of ["en0", "en1"]) {
    try {
      const out = execFileSync("ipconfig", ["getifaddr", iface], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out) return out;
    } catch {
      // interface absent/down — try the next one.
    }
  }
  return "127.0.0.1";
}

export function loadPersonas(path: string): PersonaConfig[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as PersonaConfig[];
  return raw;
}

export function joinUrl(hostIp: string, mobilePort: number, persona: BootedPersona): string {
  return `http://${hostIp}:${mobilePort}/?agent=http://${hostIp}:${persona.port}&app=${persona.app}&persona=${persona.key}`;
}

// --------------------------------------------------------------- CLI entry --

async function cliMain(): Promise<void> {
  const personasPath = process.env.ALPHA_PERSONAS_PATH ?? join(REPO_ROOT, "alpha", "personas.json");
  const stateDir = process.env.ALPHA_STATE_DIR ?? join(REPO_ROOT, "alpha", "state");
  const mobilePort = Number(process.env.ALPHA_MOBILE_PORT ?? 5173);
  const hostIp = detectHostIp();

  const personas = loadPersonas(personasPath);
  // eslint-disable-next-line no-console
  console.log(`[alpha_server] booting ${personas.length} persona(s) on host ${hostIp} (API_HOST=0.0.0.0)...`);

  const booted = await bootPersonas(personas, { hostIp, stateDir, apiHost: "0.0.0.0" });

  // eslint-disable-next-line no-console
  console.log("[alpha_server] ready:");
  for (const p of booted) {
    // eslint-disable-next-line no-console
    console.log(`  ${p.name.padEnd(10)} did=${p.did.slice(0, 24)}...  http://${hostIp}:${p.port}  join=${joinUrl(hostIp, mobilePort, p)}`);
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`\n[alpha_server] received ${signal}, closing ${booted.length} server(s)...`);
    void shutdownAll(booted).then(() => {
      // eslint-disable-next-line no-console
      console.log("[alpha_server] all servers + stores closed.");
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  cliMain().catch((err: unknown) => {
    console.error("[alpha_server] fatal:", err);
    process.exitCode = 1;
  });
}
