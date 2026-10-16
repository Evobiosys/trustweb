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
// the raw HTTP+WS port. See relay_server.ts's `listen()` doc comment: ingress
// is unauthenticated store-and-forward, so the size/queue caps (already
// enforced inside RelayServer) are the only thing standing between an open
// port and abuse — keep this behind a proxy that at minimum provides TLS and
// (ideally) rate limiting.
//
// Config via env vars (kept to env, not CLI flags, so a systemd unit's
// `Environment=` lines are the single source of truth):
//   RELAY_PORT      - TCP port to listen on (default 4177).
//   RELAY_HOST      - bind address (default 127.0.0.1 — see above).
//   RELAY_QUEUE_DB  - path to the SQLite queue file (default
//                     "<cwd>/queue.db"; pass an absolute path in production).
//   RELAY_VAPID_FILE    - wave 11: the VAPID key file for Web Push wake-ups (web_push.ts). Created on first start
//                         (mode 0600) when absent. Default: "vapid.json" next to the queue db. Set to "off" to never push.
//   RELAY_VAPID_SUBJECT - the mailto:/https: contact in every VAPID token (default mailto:hello@trustintheweb.org).
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
import { SqliteRelayQueueStore } from "./relay_queue_store.js";
import { SqlitePushSubscriptionStore } from "./push_store.js";
import { generateVapidKeys, loadVapidKeys, type VapidKeys } from "./web_push.js";

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
  const vapidFile = process.env.RELAY_VAPID_FILE ?? path.join(path.dirname(path.resolve(dbPath)), "vapid.json");

  const queueStore = new SqliteRelayQueueStore(dbPath);
  let push: RelayPushOptions | undefined;
  if (vapidFile !== "off") {
    const vapid = vapidKeysAt(vapidFile, process.env.RELAY_VAPID_SUBJECT ?? "mailto:hello@trustintheweb.org");
    push = { store: new SqlitePushSubscriptionStore(dbPath), vapid };
  }
  const relay = new RelayServer({ queueStore, push });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[relay_only] received ${signal}, closing...`);
    await relay.close();
    queueStore.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const { port: boundPort } = await relay.listen(port, host);
  console.log(
    `[relay_only] listening on http://${host}:${boundPort} ` +
      `(ingress POST /relay/send, drain WS /relay/drain, queue db: ${dbPath}, ` +
      (push ? `push: on, ${push.store.count()} subscribed, key ${vapidFile})` : "push: off)"),
  );
}

void main().catch((err: unknown) => {
  console.error("[relay_only] fatal:", err);
  process.exit(1);
});
