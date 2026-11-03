// relay_only.ts — standalone mediator relay entrypoint (core-transport-plan.md
// Task 10's "one node runs relay_server" deployment shape), for hosting a
// single RelayServer as its own process on a server that is NOT also running
// an agent-daemon persona (unlike scripts/alpha_server.ts, which mounts a
// RelayServer onto one persona's own HTTP server via the additive
// `relayServer` extras hook).
//
// This is the process a reverse proxy (Caddy, nginx, ...) sits in front of.
// It intentionally binds to 127.0.0.1 only — the standalone deployment shape
// assumes a TLS-terminating proxy in front, never direct internet exposure of
// the raw HTTP+WS port. Ingress is sender-authenticated only as far as
// RELAY_SENDER_AUTH says: in the default "optional" mode unsigned sends still
// pass, and even a signed send only proves WHO sent (anyone can mint a DID),
// so the size/queue caps enforced inside RelayServer remain the main thing
// standing between an open port and abuse — keep this behind a proxy that at
// minimum provides TLS and (ideally) rate limiting.
//
// Config via env vars (kept to env, not CLI flags, so a systemd unit's
// `Environment=` lines are the single source of truth):
//   RELAY_PORT      - TCP port to listen on (default 4177).
//   RELAY_HOST      - bind address (default 127.0.0.1 — see above).
//   RELAY_SENDER_AUTH - optional (default today, the transition) | required | off: per-DID v2 signature on
//                       POST /relay/send (relay_send_auth.ts). "optional": unsigned sends pass, signed ones must
//                       verify. Switch to "required" once every client signs.
//   RELAY_SENDER_AUTH_AUDIENCES - comma-separated origins clients post to (e.g. "https://relay.example"). Set
//                       this behind the proxy: the signed `aud` must be one of them. Unset: `aud`'s host must
//                       equal the Host header the proxy forwards (relay_env.ts parses both).
//   RELAY_SENDER_AUTH_ALLOW_V1  - true | false: accept legacy audience-unbound v1 signatures. Unset: true in
//                       "optional", false in "required".
//   RELAY_KEY_REGISTRY - "off" disables key rotation / revocation / device keys. Default on: a SQLite
//                       DidKeyRegistry in the queue db, fed by POST /relay/keys (self-signed records from
//                       did_key_records.ts) and consulted by both send and drain auth.
//   RELAY_QUEUE_DB  - path to the SQLite queue file (default
//                     "<cwd>/queue.db"; pass an absolute path in production). The send-auth nonce store
//                     (replay protection that survives a restart) and the key registry live in the same file.
//   RELAY_VAPID_FILE    - wave 11: the VAPID key file for Web Push wake-ups (web_push.ts). Created on first start
//                         (mode 0600) when absent. Default: "vapid.json" next to the queue db. Set to "off" to never push.
//   RELAY_VAPID_SUBJECT - the mailto:/https: contact in every VAPID token (default mailto:hello@trustintheweb.org).
//   RELAY_APNS_FILE     - wave 12 (iPhone app): Apple push credentials, JSON {keyId, teamId, topic, privateKey (the .p8 PEM),
//                         sandbox?} (apns_push.ts loadApnsConfig). Default: "apns.json" next to the queue db; absent = iPhones
//                         are not woken (their token is refused on the drain). Mode 0600, never in git.
//
// Routes: POST /relay/send (ingress), WS /relay/drain (drain), POST /relay/keys
// (key records; 503 when RELAY_KEY_REGISTRY=off), GET /relay/push/key.
//
// Deliberately uses RelayServer's DEFAULT ingress/drain paths (/relay/send,
// /relay/drain) rather than any custom prefix: alpha_server.ts's meet-card
// wiring (`relay_url: new URL(mediatorEndpoint).origin`) and mobile-ui's
// connect-flow (`relay=<mediator base origin>`, see
// apps/mobile-ui/src/screens/connect_flow.js) both resolve a relay to just
// its base ORIGIN and always append the default paths themselves — a relay
// mounted under a URL path prefix would be unreachable to any card/QR
// discovered peer even if a hand-configured RelayChannel could be pointed at
// it via custom ingressPath/drainPath. So the proxy in front of this process
// MUST map the relay's origin root (or at least handle
// "/relay/*" unprefixed) straight to this port — not a sub-path that strips
// or rewrites away from "/relay/send" + "/relay/drain".
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RelayServer, type RelayPushOptions } from "./relay_server.js";
import { parseSenderAuthEnv } from "./relay_env.js";
import { SqliteRelayQueueStore } from "./relay_queue_store.js";
import { SqliteSendNonceStore } from "./send_nonce_store.js";
import { SqliteDidKeyStore } from "./did_key_store.js";
import { DidKeyRegistry } from "./did_key_registry.js";
import { SqlitePushSubscriptionStore } from "./push_store.js";
import { generateVapidKeys, loadVapidKeys, type VapidKeys } from "./web_push.js";
import { loadApnsConfig } from "./apns_push.js";

/** Reads the VAPID keys, minting them on the first start. */
export function vapidKeysAt(file: string, subject: string): VapidKeys {
  if (existsSync(file)) return loadVapidKeys(JSON.parse(readFileSync(file, "utf8")));
  const keys = generateVapidKeys(subject);
  writeFileSync(file, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
  return keys;
}

async function main(): Promise<void> {
  const port = Number(process.env.RELAY_PORT ?? "4177");
  const host = process.env.RELAY_HOST ?? "127.0.0.1";
  const dbPath = process.env.RELAY_QUEUE_DB ?? "queue.db";
  const dataDir = path.dirname(path.resolve(dbPath));
  const vapidFile = process.env.RELAY_VAPID_FILE ?? path.join(dataDir, "vapid.json");
  const apnsFile = process.env.RELAY_APNS_FILE ?? path.join(dataDir, "apns.json");

  const queueStore = new SqliteRelayQueueStore(dbPath);
  let push: RelayPushOptions | undefined;
  if (vapidFile !== "off") {
    const vapid = vapidKeysAt(vapidFile, process.env.RELAY_VAPID_SUBJECT ?? "mailto:hello@trustintheweb.org");
    const apns = existsSync(apnsFile) ? loadApnsConfig(JSON.parse(readFileSync(apnsFile, "utf8"))) : undefined;
    push = { store: new SqlitePushSubscriptionStore(dbPath), vapid, ...(apns ? { apns } : {}) };
  }
  const senderAuthEnv = parseSenderAuthEnv(process.env);
  const nonceStore = new SqliteSendNonceStore(dbPath);
  const keyStore = process.env.RELAY_KEY_REGISTRY === "off" ? null : new SqliteDidKeyStore(dbPath);
  const relay = new RelayServer({
    queueStore,
    push,
    ...senderAuthEnv,
    senderNonceStore: nonceStore,
    ...(keyStore ? { keyRegistry: new DidKeyRegistry({ store: keyStore }) } : {}),
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[relay_only] received ${signal}, closing...`);
    await relay.close();
    queueStore.close();
    nonceStore.close();
    keyStore?.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const { port: boundPort } = await relay.listen(port, host);
  console.log(
    `[relay_only] listening on http://${host}:${boundPort} ` +
      `(ingress POST /relay/send, drain WS /relay/drain, key records POST /relay/keys: ${keyStore ? "on" : "off"}, ` +
      `sender auth: ${senderAuthEnv.senderAuth}, queue db: ${dbPath}, ` +
      (push ? `push: on, ${push.store.count()} subscribed, key ${vapidFile}, apns: ${push.apns ? "on" : "off"})` : "push: off)"),
  );
}

void main().catch((err: unknown) => {
  console.error("[relay_only] fatal:", err);
  process.exit(1);
});
