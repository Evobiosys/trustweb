// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//
// relay_env — operator env for relay sender authentication, parsed in ONE place so relay_only.ts and
// scripts/alpha_server.ts cannot drift (SPEC F10).
//
//   RELAY_SENDER_AUTH            required | optional | off   (unset -> "optional", see parseSenderAuthMode)
//   RELAY_SENDER_AUTH_AUDIENCES  comma-separated origins this relay answers to, e.g.
//                                "https://relay.example,http://127.0.0.1:4177". Unset -> the relay checks the
//                                signed audience against the request's Host header instead.
//   RELAY_SENDER_AUTH_ALLOW_V1   true | false. Unset -> RelayServer's default (true in "optional", false in "required").
//
// Anything malformed THROWS at startup rather than silently weakening ingress.
import { parseSenderAuthMode, type SenderAuthMode } from "./relay_send_auth.js";

export interface SenderAuthEnv {
  senderAuth: SenderAuthMode;
  senderAuthAudiences?: string[];
  senderAuthAllowV1?: boolean;
}

/** Parses one audience entry into its canonical origin (`new URL(x).origin`); throws on anything with a path, query, fragment or credentials. */
function parseAudience(raw: string): string {
  const entry = raw.trim().toLowerCase();
  let u: URL;
  try {
    u = new URL(entry);
  } catch {
    throw new Error(`RELAY_SENDER_AUTH_AUDIENCES: "${raw}" is not a URL origin`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`RELAY_SENDER_AUTH_AUDIENCES: "${raw}" must be an http(s) origin`);
  }
  if (u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "" || u.pathname !== "/" || /[?#]/.test(entry)) {
    throw new Error(`RELAY_SENDER_AUTH_AUDIENCES: "${raw}" must be a bare origin (scheme://host[:port]) with no path`);
  }
  // A single trailing "/" is tolerated ("https://relay.example/" -> "https://relay.example"); default ports drop.
  return u.origin;
}

export function parseSenderAuthEnv(env: NodeJS.ProcessEnv): SenderAuthEnv {
  const out: SenderAuthEnv = { senderAuth: parseSenderAuthMode(env.RELAY_SENDER_AUTH) };

  const audiences = env.RELAY_SENDER_AUTH_AUDIENCES;
  if (audiences !== undefined && audiences.trim() !== "") {
    const parts: string[] = audiences.split(",").map((s: string) => s.trim());
    if (parts.some((p) => p === "")) {
      throw new Error(`RELAY_SENDER_AUTH_AUDIENCES: empty entry in "${audiences}"`);
    }
    out.senderAuthAudiences = [...new Set(parts.map(parseAudience))];
  }

  const allowV1 = env.RELAY_SENDER_AUTH_ALLOW_V1;
  if (allowV1 !== undefined && allowV1 !== "") {
    if (allowV1 === "true") out.senderAuthAllowV1 = true;
    else if (allowV1 === "false") out.senderAuthAllowV1 = false;
    else throw new Error(`RELAY_SENDER_AUTH_ALLOW_V1 must be true|false, got "${allowV1}"`);
  }

  return out;
}
