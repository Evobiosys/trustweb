// Unit tests for RelayQueueStore (core-transport-plan.md Task 6a),
// mirroring dedup_store.test.ts's structure: both implementations exercised
// against the same shared-contract suite via describe.each, plus a
// SQLite-only restart-survival test.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  queueHoldMs,
  InMemoryRelayQueueStore,
  SqliteRelayQueueStore,
  MAX_HOLD_HORIZON_MS,
  type RelayQueueStore,
} from "./relay_queue_store.js";

const tempDirs: string[] = [];
function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-queue-store-test-"));
  tempDirs.push(dir);
  return join(dir, "relay_queue.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.each([
  ["InMemoryRelayQueueStore", () => new InMemoryRelayQueueStore() as RelayQueueStore],
  ["SqliteRelayQueueStore", () => new SqliteRelayQueueStore(makeTempDbPath()) as RelayQueueStore],
])("%s", (_name, makeStore) => {
  it("drain() on an empty queue returns []", () => {
    const store = makeStore();
    expect(store.drain("did:peer:2.unknown")).toEqual([]);
  });

  it("enqueue() then drain() returns the wire byte-identical to what was enqueued", () => {
    const store = makeStore();
    const wire = JSON.stringify({ typ: "application/openvtc-encrypted+json", alg: "ECDH-ES+XC20P", epk: "e", nonce: "n", ciphertext: "c", to: "did:peer:2.ben" });
    const id = store.enqueue("did:peer:2.ben", wire);
    const drained = store.drain("did:peer:2.ben");
    expect(drained).toHaveLength(1);
    expect(drained[0]!.id).toBe(id);
    expect(drained[0]!.wire).toBe(wire); // byte-identical, never mutated
  });

  it("drain() is non-destructive: calling it twice returns the same rows both times", () => {
    const store = makeStore();
    const wire = "opaque-wire-1";
    store.enqueue("did:peer:2.ben", wire);
    const first = store.drain("did:peer:2.ben");
    const second = store.drain("did:peer:2.ben");
    expect(first).toEqual(second);
    expect(second).toHaveLength(1);
  });

  it("drain() only returns wires queued for that DID, not other recipients'", () => {
    const store = makeStore();
    store.enqueue("did:peer:2.ben", "for-ben");
    store.enqueue("did:peer:2.anna", "for-anna");
    expect(store.drain("did:peer:2.ben").map((q) => q.wire)).toEqual(["for-ben"]);
    expect(store.drain("did:peer:2.anna").map((q) => q.wire)).toEqual(["for-anna"]);
  });

  it("ackDelivered() removes only the acked ids; drain() no longer returns them", () => {
    const store = makeStore();
    const id1 = store.enqueue("did:peer:2.ben", "wire-1");
    const id2 = store.enqueue("did:peer:2.ben", "wire-2");
    store.ackDelivered("did:peer:2.ben", [id1]);
    const remaining = store.drain("did:peer:2.ben");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(id2);
  });

  it("ackDelivered() with the wrong toDid does not remove another DID's row (no cross-recipient ack confusion)", () => {
    const store = makeStore();
    const id = store.enqueue("did:peer:2.ben", "wire-1");
    store.ackDelivered("did:peer:2.anna", [id]); // wrong recipient claims the id
    expect(store.drain("did:peer:2.ben")).toHaveLength(1); // still there
  });

  it("prune(now) drops rows older than H, keeps newer ones (unacked wires re-enqueued on disconnect stay put)", () => {
    const store = makeStore();
    const now = Date.now();
    const oldId = store.enqueue("did:peer:2.ben", "stale");
    // Can't backdate enqueuedAt via the public API, so simulate by pruning
    // with a `now` far enough in the future that "stale" (enqueued at real
    // Date.now()) falls outside the horizon relative to that future `now`.
    store.prune(now + MAX_HOLD_HORIZON_MS + 60_000);
    expect(store.drain("did:peer:2.ben").some((q) => q.id === oldId)).toBe(false);
  });

  it("prune(now) keeps a freshly-enqueued row", () => {
    const store = makeStore();
    store.enqueue("did:peer:2.ben", "fresh");
    store.prune(Date.now());
    expect(store.drain("did:peer:2.ben")).toHaveLength(1);
  });
});

it("SqliteRelayQueueStore: an enqueued wire survives a process restart (new instance, same db file)", () => {
  const dbPath = makeTempDbPath();
  const first = new SqliteRelayQueueStore(dbPath);
  const id = first.enqueue("did:peer:2.ben", "survives-restart");
  first.close();

  const second = new SqliteRelayQueueStore(dbPath);
  const drained = second.drain("did:peer:2.ben");
  expect(drained).toEqual([{ id, wire: "survives-restart" }]);
  second.close();
});

it("SqliteRelayQueueStore: an ack survives a process restart (acked row stays gone)", () => {
  const dbPath = makeTempDbPath();
  const first = new SqliteRelayQueueStore(dbPath);
  const id = first.enqueue("did:peer:2.ben", "acked-before-restart");
  first.ackDelivered("did:peer:2.ben", [id]);
  first.close();

  const second = new SqliteRelayQueueStore(dbPath);
  expect(second.drain("did:peer:2.ben")).toEqual([]);
  second.close();
});

describe("queueHoldMs (TrustWeb wave 6h: RELAY_QUEUE_HOLD_MS)", () => {
  it("absent, blank, malformed or not positive: the shared 72 h horizon", () => {
    for (const raw of [undefined, "", "  ", "soon", "0", "-5", "NaN", "Infinity"]) expect(queueHoldMs(raw)).toBe(MAX_HOLD_HORIZON_MS);
  });
  it("a positive number of ms: that hold (3650 days for a relay that keeps wires until they are drained)", () => {
    expect(queueHoldMs("315360000000")).toBe(3650 * 24 * 60 * 60 * 1000);
    expect(queueHoldMs("1000")).toBe(1000);
  });
});
