// web_push.ts — the relay's only way to reach a phone that has no drain open: a Web Push WAKE with no payload
// (RFC 8030 + RFC 8292 VAPID). Nothing about the message travels here: the push service (the browser vendor's)
// learns that SOME wire waits for SOME subscription, and the phone's service worker then opens the drain itself
// and reads the wire there, under the pair key the relay never had. TrustWeb wave 11 (APK + notifications).
//
// No dependency: a VAPID token is an ES256 JWT, which node:crypto signs; a payload-free push needs no content
// encryption at all (RFC 8291 applies only when a body is sent).
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { parseApnsTarget, type ApnsTarget } from "./apns_push.js";

/** node:crypto's JWK shape (older @types/node export it under a different name). */
export type JsonWebKey = Record<string, string | string[] | boolean | undefined> & { kty?: string; crv?: string; x?: string; y?: string; d?: string };

/** The browser's PushSubscription.toJSON() shape, as the phone hands it over the drain. */
export interface PushSubscriptionJson {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
  expirationTime?: number | null;
}

/** What the relay keeps per DID to wake its device: a Web Push subscription (Android, browsers) or an APNs token (wave 12, iPhone). */
export type PushTarget = PushSubscriptionJson | ApnsTarget;

export const isApnsTarget = (t: PushTarget): t is ApnsTarget => "apns" in t;

export interface VapidKeys {
  /** EC P-256 private key as a JWK (the only secret of this file; kept in the relay's data directory, mode 0600). */
  privateJwk: JsonWebKey;
  /** The uncompressed public point, base64url (65 bytes): what the phone passes as `applicationServerKey`. */
  publicKey: string;
  /** `mailto:` or `https:` contact a push service may use to reach the operator (RFC 8292 §2.1). */
  subject: string;
}

function b64u(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** Mints a fresh VAPID key pair. Run once per relay; the public key is then baked into every phone's subscription. */
export function generateVapidKeys(subject: string): VapidKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateJwk: privateKey.export({ format: "jwk" }) as JsonWebKey, publicKey: uncompressedPoint(publicKey), subject };
}

function uncompressedPoint(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as JsonWebKey;
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("web_push: not a P-256 public key");
  return b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
}

/** Reads keys back from what generateVapidKeys() produced (and re-derives the public point, so a wrong file fails loudly). */
export function loadVapidKeys(raw: unknown): VapidKeys {
  const o = raw as Partial<VapidKeys>;
  if (!o || typeof o !== "object" || !o.privateJwk || typeof o.subject !== "string") throw new Error("web_push: malformed VAPID key file");
  const priv = createPrivateKey({ key: o.privateJwk as JsonWebKey, format: "jwk" });
  const publicKey = uncompressedPoint(createPublicKey({ key: priv.export({ format: "jwk" }), format: "jwk" } as never));
  if (o.publicKey && o.publicKey !== publicKey) throw new Error("web_push: VAPID public key does not match its private key");
  return { privateJwk: o.privateJwk, publicKey, subject: o.subject };
}

/** Valid for 12 hours, as RFC 8292 §2 allows at most 24. */
const TOKEN_LIFETIME_S = 12 * 3600;

/** The `Authorization: vapid t=<jwt>, k=<key>` value for one push-service origin (RFC 8292 §3). */
export function vapidAuthorization(keys: VapidKeys, endpoint: string, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + TOKEN_LIFETIME_S, sub: keys.subject })));
  const signingInput = `${header}.${claims}`;
  const key = createPrivateKey({ key: keys.privateJwk as JsonWebKey, format: "jwk" });
  const sig = cryptoSign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${signingInput}.${b64u(sig)}, k=${keys.publicKey}`;
}

export type WakeOutcome = "sent" | "gone" | "failed";

/** How long the push service may hold the wake for a phone that is offline right now. */
const WAKE_TTL_S = 24 * 3600;

/**
 * One payload-free push to a subscription. "gone" (404 or 410): the subscription is dead and the caller drops it;
 * "failed": keep it, try again next time. Never throws.
 */
export async function sendWake(sub: PushSubscriptionJson, keys: VapidKeys, fetchImpl: typeof fetch = fetch): Promise<WakeOutcome> {
  let auth: string;
  try {
    auth = vapidAuthorization(keys, sub.endpoint);
  } catch {
    return "gone";
  }
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: { TTL: String(WAKE_TTL_S), Urgency: "high", Authorization: auth, "Content-Length": "0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** A subscription a phone hands over is kept only when it has the shape a push service accepts (or it is an APNs token). */
export function parsePushSubscription(raw: unknown): PushTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const apns = parseApnsTarget(raw);
  if (apns) return apns;
  const o = raw as Record<string, unknown>;
  if (typeof o.endpoint !== "string") return null;
  let endpoint: URL;
  try {
    endpoint = new URL(o.endpoint);
  } catch {
    return null;
  }
  if (endpoint.protocol !== "https:") return null;
  const keys = o.keys && typeof o.keys === "object" ? (o.keys as Record<string, unknown>) : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : undefined;
  const authKey = typeof keys.auth === "string" ? keys.auth : undefined;
  return { endpoint: endpoint.toString(), ...(p256dh || authKey ? { keys: { ...(p256dh ? { p256dh } : {}), ...(authKey ? { auth: authKey } : {}) } } : {}) };
}
