// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// iroh_sidecar.integration.test.ts — two REAL iroh nodes (trustweb-iroh-sidecar,
// docs/IROH-SIDECAR.md) behind IrohSidecarEndpoint + IrohRelayChannel, one wire
// each way. Skipped cleanly when no sidecar binary is found
// (TRUSTWEB_IROH_SIDECAR or trustweb-iroh-sidecar on PATH). Direct addresses
// only by default (no relay, no network beyond the host); with
// TRUSTWEB_IROH_TEST_RELAY_URL set, a second case goes through that relay.
// Synthetic DIDs and random payloads only.
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { IrohRelayChannel, type IrohPeerAddr } from "./iroh_relay_channel.js";
import { IrohSidecarEndpoint, findIrohSidecar } from "./iroh_sidecar_endpoint.js";

const bin = findIrohSidecar();
const RELAY = process.env.TRUSTWEB_IROH_TEST_RELAY_URL;
const ANNA = "did:peer:test-anna";
const BEN = "did:peer:test-ben";
const ARRIVAL_MS = 20_000;
const CASE_MS = 30_000;

function nextInbound(ch: IrohRelayChannel): () => Promise<string> {
  const got: string[] = [];
  const waiters: ((w: string) => void)[] = [];
  ch.onInbound((w) => {
    const next = waiters.shift();
    if (next) next(w);
    else got.push(w);
  });
  return () => {
    const queued = got.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no wire arrived within ${ARRIVAL_MS} ms`)), ARRIVAL_MS);
      waiters.push((w) => {
        clearTimeout(t);
        resolve(w);
      });
    });
  };
}

/** A synthetic wire: JSON-ish, non-ASCII, random — never real data. */
const wire = (tag: string) => JSON.stringify({ tag, note: "é ✓ 🌱", nonce: randomBytes(48).toString("base64") });

async function roundTrip(opts: { relayUrl?: string }): Promise<void> {
  const relayUrls = opts.relayUrl ? [opts.relayUrl] : undefined;
  const epAnna = new IrohSidecarEndpoint({ binaryPath: bin, relayUrls });
  const epBen = new IrohSidecarEndpoint({ binaryPath: bin, relayUrls });
  try {
    const [anna, ben] = await Promise.all([epAnna.start(), epBen.start()]);
    const addrOf = (r: { nodeId: string; directAddrs: string[] }): IrohPeerAddr =>
      opts.relayUrl ? { nodeId: r.nodeId, relayUrls: [opts.relayUrl] } : { nodeId: r.nodeId, directAddrs: r.directAddrs };
    const book = new Map<string, IrohPeerAddr>([
      [ANNA, addrOf(anna)],
      [BEN, addrOf(ben)],
    ]);
    const resolvePeer = (did: string) => book.get(did);
    const chAnna = new IrohRelayChannel({ endpoint: epAnna, resolvePeer });
    const chBen = new IrohRelayChannel({ endpoint: epBen, resolvePeer });
    const annaInbox = nextInbound(chAnna);
    const benInbox = nextInbound(chBen);

    const toBen = wire("anna-to-ben");
    await chAnna.deliver(BEN, toBen);
    expect(await benInbox()).toBe(toBen);

    const toAnna = wire("ben-to-anna");
    await chBen.deliver(ANNA, toAnna);
    expect(await annaInbox()).toBe(toAnna);
  } finally {
    await Promise.all([epAnna.close(), epBen.close()]);
  }
}

describe.skipIf(!bin)("iroh sidecar (real node)", () => {
  it("starts one node and reports a node id", async () => {
    const ep = new IrohSidecarEndpoint({ binaryPath: bin });
    try {
      const ready = await ep.start();
      expect(typeof ready.nodeId).toBe("string");
      expect(ready.nodeId.length).toBeGreaterThan(0);
      expect(ep.nodeId).toBe(ready.nodeId);
      expect(ready.relayUrl).toBeNull(); // no relay unless configured (I9)
      await expect(ep.isAvailable()).resolves.toBe(true);
    } finally {
      await ep.close();
    }
  }, CASE_MS);

  it("delivers one wire each way over direct addresses (no relay)", async () => {
    await roundTrip({});
  }, CASE_MS);

  it.skipIf(!RELAY)("delivers one wire each way through TRUSTWEB_IROH_TEST_RELAY_URL", async () => {
    await roundTrip({ relayUrl: RELAY });
  }, CASE_MS);
});
