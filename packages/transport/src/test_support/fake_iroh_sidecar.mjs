// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// fake_iroh_sidecar.mjs — a stand-in for `trustweb-iroh-sidecar` that speaks the
// host protocol of docs/IROH-SIDECAR.md byte for byte (JSON lines on
// stdin/stdout), but moves payloads between fake instances over UDP on
// 127.0.0.1 instead of iroh/QUIC. Node stdlib only; used by
// iroh_sidecar_endpoint.test.ts.
//
// Identity: nodeId "fake-<udpPort>", directAddrs ["127.0.0.1:<udpPort>"].
// Routing for `send`:
//   relayUrl "fail://…"                 → error unreachable (relay refused)
//   relayUrl "slow://…"                 → never answered (host timeout tests)
//   directAddrs non-empty               → datagram to directAddrs[0], via "direct"
//   relayUrl set, no directAddrs        → datagram to the port in nodeId, via "relay"
//   relayUrl null and no directAddrs    → error unreachable
// `sent` is printed only after the peer fake printed `recv` and acked, like the
// real sidecar. Payloads must fit one UDP datagram (~60 KiB) here; larger ones
// (but ≤ 1 MiB) are answered with `internal`. Payload bytes are never logged.
//
// FAKE_SIDECAR_MODE: "" (normal) | "never-ready" (prints nothing, ignores
// input) | "crash-after-ready" (exits 3 on the first send, unanswered).
import dgram from "node:dgram";
import { randomBytes } from "node:crypto";

const MAX_PAYLOAD = 1024 * 1024;
const MAX_DATAGRAM_PAYLOAD = 60 * 1024;
const ATTEMPT_MS = Number(process.env.FAKE_SIDECAR_ATTEMPT_MS || 3000);
const MODE = process.env.FAKE_SIDECAR_MODE || "";

const args = process.argv.slice(2);
const relayUrls = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--relay-url") relayUrls.push(args[++i]);
  else if (args[i] === "--alpn" || args[i] === "--secret-key-file") i++;
  else if (args[i] === "--n0-relays") {
    /* accepted, meaningless here */
  } else {
    process.stderr.write(`fake sidecar: unknown argument ${args[i]}\n`);
    process.exit(2);
  }
}

const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const error = (id, code, message) => out({ type: "error", id, code, message });

if (MODE === "never-ready") {
  // Print nothing and ignore input; the host must time out and kill us.
  process.stdin.resume();
  setTimeout(() => process.exit(0), 60_000).unref();
} else {
  main();
}

function main() {
  const sock = dgram.createSocket("udp4");
  let nodeId = "";
  /** mid -> { id, via, timer } for sends awaiting a peer ack */
  const inflight = new Map();
  let closing = false;

  const shutdown = () => {
    if (closing) return;
    closing = true;
    for (const { id, timer } of inflight.values()) {
      clearTimeout(timer);
      error(id, "closed", "endpoint shutting down");
    }
    inflight.clear();
    sock.close();
    process.stdout.write("", () => process.exit(0));
  };

  sock.on("message", (msg, rinfo) => {
    let m;
    try {
      m = JSON.parse(msg.toString("utf8"));
    } catch {
      return;
    }
    if (m.k === "data" && typeof m.payload === "string" && typeof m.mid === "string") {
      out({ type: "recv", from: String(m.from), payload: m.payload });
      sock.send(JSON.stringify({ k: "ack", mid: m.mid }), rinfo.port, rinfo.address);
    } else if (m.k === "ack" && inflight.has(m.mid)) {
      const { id, via, timer } = inflight.get(m.mid);
      clearTimeout(timer);
      inflight.delete(m.mid);
      out({ type: "sent", id, via });
    }
  });

  sock.bind(0, "127.0.0.1", () => {
    const port = sock.address().port;
    nodeId = `fake-${port}`;
    out({ type: "ready", v: 1, nodeId, directAddrs: [`127.0.0.1:${port}`], relayUrl: relayUrls[0] ?? null });
    readStdin();
  });

  function handleSend(req) {
    const { id } = req;
    if (typeof req.nodeId !== "string" || typeof req.payload !== "string" ||
        (req.relayUrl !== undefined && req.relayUrl !== null && typeof req.relayUrl !== "string") ||
        (req.directAddrs !== undefined && !(Array.isArray(req.directAddrs) && req.directAddrs.every((a) => typeof a === "string")))) {
      return error(id, "bad_request", "send needs nodeId, payload and well-formed relayUrl/directAddrs");
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(req.payload) || req.payload.length % 4 !== 0) {
      return error(id, "bad_request", "payload is not base64");
    }
    const bytes = Buffer.from(req.payload, "base64");
    if (bytes.length > MAX_PAYLOAD) return error(id, "too_large", `payload of ${bytes.length} bytes exceeds ${MAX_PAYLOAD}`);
    if (MODE === "crash-after-ready") process.exit(3);

    const relayUrl = req.relayUrl ?? null;
    const direct = req.directAddrs ?? [];
    if (relayUrl && relayUrl.startsWith("fail://")) return error(id, "unreachable", "relay refused");
    if (relayUrl && relayUrl.startsWith("slow://")) return; // never answered
    let host, port, via;
    if (direct.length > 0) {
      const at = direct[0].lastIndexOf(":");
      host = direct[0].slice(0, at);
      port = Number(direct[0].slice(at + 1));
      via = "direct";
    } else if (relayUrl) {
      const m = /^fake-(\d+)$/.exec(req.nodeId);
      if (!m) return error(id, "unreachable", "unknown node");
      host = "127.0.0.1";
      port = Number(m[1]);
      via = "relay";
    } else {
      return error(id, "unreachable", "no relay and no direct address");
    }
    if (!(port > 0 && port < 65536)) return error(id, "bad_request", "bad direct address");
    if (bytes.length > MAX_DATAGRAM_PAYLOAD) return error(id, "internal", "fake sidecar: payload too big for one UDP datagram");

    const mid = randomBytes(8).toString("hex");
    const timer = setTimeout(() => {
      inflight.delete(mid);
      error(id, "unreachable", "no ack within the attempt timeout");
    }, ATTEMPT_MS);
    inflight.set(mid, { id, via, timer });
    sock.send(JSON.stringify({ k: "data", mid, from: nodeId, payload: req.payload }), port, host, (err) => {
      if (err && inflight.has(mid)) {
        clearTimeout(timer);
        inflight.delete(mid);
        error(id, "unreachable", "datagram send failed");
      }
    });
  }

  function handleLine(line) {
    if (line.trim() === "") return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return error(null, "bad_request", "line is not JSON");
    }
    if (!req || typeof req !== "object" || Array.isArray(req)) return error(null, "bad_request", "line is not a JSON object");
    const id = typeof req.id === "string" ? req.id : null;
    switch (req.type) {
      case "close":
        return shutdown();
      case "ping":
        if (id === null) return error(null, "bad_request", "ping needs an id");
        return out({ type: "pong", id });
      case "send":
        if (id === null) return error(null, "bad_request", "send needs an id");
        return handleSend(req);
      default:
        return error(id, "bad_request", `unknown type ${JSON.stringify(req.type)}`);
    }
  }

  function readStdin() {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      let i;
      while (!closing && (i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        handleLine(line);
      }
    });
    process.stdin.on("end", shutdown);
  }
}
