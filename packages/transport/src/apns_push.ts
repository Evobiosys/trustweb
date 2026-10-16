// apns_push.ts — the relay's way to reach an iPhone that has no drain open (TrustWeb wave 12, the iOS app). Apple allows
// no payload-free wake for a visible notification, so the relay sends the smallest alert there is: fixed words, no sender,
// no kind, no count. Apple's push service learns that SOMETHING waits for THIS device, and when; nothing else. The app
// then opens its drain and reads the wire under the pair key the relay never had, as the Android app does after a Web Push.
//
// No dependency: the provider token is an ES256 JWT (node:crypto signs it), and APNs speaks HTTP/2 (node:http2).
import { createPrivateKey, sign as cryptoSign, type KeyObject } from "node:crypto";
import { connect as http2Connect, constants as h2 } from "node:http2";
import type { WakeOutcome } from "./web_push.js";

/** What an iPhone hands over the drain: `{apns: <device token, hex>}` (apps/trustweb/src/native_push.ts). */
export interface ApnsTarget {
  apns: string;
}

export interface ApnsConfig {
  /** The 10-character key id of the .p8 key from the Apple developer account. */
  keyId: string;
  /** The 10-character team id of that account. */
  teamId: string;
  /** The app's bundle id (apns-topic): one.trustweb.app. */
  topic: string;
  /** The .p8 file's content (PEM, "-----BEGIN PRIVATE KEY-----"). The only secret here; the file is mode 0600. */
  privateKey: string;
  /** Builds installed by Xcode talk to the sandbox; TestFlight and the App Store to production. Default production. */
  sandbox?: boolean;
  /** Tests only: where to POST instead of Apple. */
  endpoint?: string;
}

const PRODUCTION = "https://api.push.apple.com";
const SANDBOX = "https://api.sandbox.push.apple.com";
/** Apple wants a token younger than an hour and not minted more often than every 20 minutes. */
const TOKEN_LIFETIME_MS = 50 * 60_000;
const EXPIRATION_S = 24 * 3600;
/** The whole payload. Constant on purpose: Apple sees the same bytes for every arrival of every person. */
export const APNS_PAYLOAD = JSON.stringify({ aps: { alert: { title: "TrustWeb", body: "Something arrived for you" }, sound: "default", "thread-id": "trustweb" } });

/** A device token as the app reports it: hex, 32 bytes today (Apple reserves the right to make it longer). */
export function parseApnsTarget(raw: unknown): ApnsTarget | null {
  const t = raw && typeof raw === "object" ? (raw as Record<string, unknown>).apns : undefined;
  return typeof t === "string" && /^[0-9a-f]{64,200}$/i.test(t) ? { apns: t.toLowerCase() } : null;
}

/** Reads the config file (relay_only.ts RELAY_APNS_FILE) and fails loudly on a key that cannot sign. */
export function loadApnsConfig(raw: unknown): ApnsConfig {
  const o = raw as Partial<ApnsConfig>;
  if (!o || typeof o !== "object") throw new Error("apns_push: malformed config");
  for (const k of ["keyId", "teamId", "topic", "privateKey"] as const) if (typeof o[k] !== "string" || !o[k]) throw new Error(`apns_push: config lacks ${k}`);
  const key = createPrivateKey(o.privateKey as string);
  if (key.asymmetricKeyType !== "ec") throw new Error("apns_push: the key is not an EC (ES256) key");
  return { keyId: o.keyId!, teamId: o.teamId!, topic: o.topic!, privateKey: o.privateKey!, ...(o.sandbox ? { sandbox: true } : {}), ...(o.endpoint ? { endpoint: o.endpoint } : {}) };
}

const b64u = (s: string | Buffer): string => Buffer.from(s).toString("base64url");

/** The provider token (JWT, ES256) for `cfg`, minted at `now`. */
export function apnsProviderToken(cfg: ApnsConfig, now = Date.now()): string {
  const header = b64u(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64u(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) }));
  const key: KeyObject = createPrivateKey(cfg.privateKey);
  const sig = cryptoSign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64u(sig)}`;
}

// honey: one cached token per process (the relay has one APNs key); keyed by keyId in case that ever changes at runtime.
const tokens = new Map<string, { token: string; at: number }>();
function currentToken(cfg: ApnsConfig, now: number): string {
  const have = tokens.get(cfg.keyId);
  if (have && now - have.at < TOKEN_LIFETIME_MS) return have.token;
  const token = apnsProviderToken(cfg, now);
  tokens.set(cfg.keyId, { token, at: now });
  return token;
}

interface ApnsReply {
  status: number;
  reason: string;
}

/** One HTTP/2 POST; the session is opened and closed per wake (honey: fine at the relay's volume; pool it past ~1 wake/s). */
function post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<ApnsReply> {
  return new Promise((resolve, reject) => {
    const session = http2Connect(origin);
    const fail = (e: Error): void => { session.close(); reject(e); };
    session.on("error", fail);
    const timer = setTimeout(() => fail(new Error("apns: timeout")), 10_000);
    const req = session.request({ [h2.HTTP2_HEADER_METHOD]: "POST", [h2.HTTP2_HEADER_PATH]: path, ...headers });
    let status = 0;
    let text = "";
    req.on("response", (h) => { status = Number(h[h2.HTTP2_HEADER_STATUS] ?? 0); });
    req.setEncoding("utf8");
    req.on("data", (c: string) => { text += c; });
    req.on("error", fail);
    req.on("end", () => {
      clearTimeout(timer);
      session.close();
      let reason = "";
      try { reason = String((JSON.parse(text) as { reason?: unknown }).reason ?? ""); } catch { /* an empty 200 */ }
      resolve({ status, reason });
    });
    req.end(body);
  });
}

/** "gone": Apple says the token is dead (the app was deleted, or the token changed); "failed": keep it and try next time. Never throws. */
export async function sendApns(target: ApnsTarget, cfg: ApnsConfig, now = Date.now()): Promise<WakeOutcome> {
  const headers = {
    authorization: `bearer ${currentToken(cfg, now)}`,
    "apns-topic": cfg.topic,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-expiration": String(Math.floor(now / 1000) + EXPIRATION_S),
    "content-type": "application/json",
  };
  const path = `/3/device/${target.apns}`;
  const origins = cfg.endpoint ? [cfg.endpoint] : cfg.sandbox ? [SANDBOX, PRODUCTION] : [PRODUCTION, SANDBOX];
  try {
    let reply = await post(origins[0], path, headers, APNS_PAYLOAD);
    // A token from the other environment (an Xcode build against a production relay, or the reverse): try there once.
    if (reply.status === 400 && reply.reason === "BadDeviceToken" && origins[1]) reply = await post(origins[1], path, headers, APNS_PAYLOAD);
    if (reply.status === 200) return "sent";
    if (reply.status === 410 || reply.reason === "BadDeviceToken" || reply.reason === "Unregistered" || reply.reason === "DeviceTokenNotForTopic") return "gone";
    return "failed";
  } catch {
    return "failed";
  }
}
