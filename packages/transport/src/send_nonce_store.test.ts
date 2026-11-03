// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// send_nonce_store.test.ts — the relay's send-replay memory: the in-memory and
// SQLite stores behave identically, and the SQLite one keeps a consumed nonce
// across a close + reopen (a relay restart must not reopen the replay window).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySendNonceStore, SqliteSendNonceStore, type SendNonceStore } from "./send_nonce_store.js";

const T = 1_800_000_000_000;
const DID_A = "did:peer:2.alice-example";
const DID_B = "did:peer:2.bob-example";

const dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "tw-send-nonce-"));
  dirs.push(dir);
  return join(dir, "relay.db");
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const impls: Array<[string, () => SendNonceStore & { close?: () => void }]> = [
  ["InMemorySendNonceStore", () => new InMemorySendNonceStore()],
  ["SqliteSendNonceStore", () => new SqliteSendNonceStore(tempDb())],
];

for (const [name, make] of impls) {
  describe(name, () => {
    it("has/add/countFor/total track (did, nonce) pairs", () => {
      const store = make();
      expect(store.has(DID_A, "n1")).toBe(false);
      expect(store.total()).toBe(0);
      store.add(DID_A, "n1", T + 1_000);
      store.add(DID_A, "n2", T + 2_000);
      store.add(DID_B, "n1", T + 3_000);
      expect(store.has(DID_A, "n1")).toBe(true);
      expect(store.has(DID_B, "n1")).toBe(true);
      expect(store.has(DID_B, "n2")).toBe(false); // nonces are scoped per DID
      expect(store.countFor(DID_A)).toBe(2);
      expect(store.countFor(DID_B)).toBe(1);
      expect(store.countFor("did:peer:2.nobody")).toBe(0);
      expect(store.total()).toBe(3);
      store.close?.();
    });

    it("adding the same (did, nonce) twice keeps one entry with the later expiry", () => {
      const store = make();
      store.add(DID_A, "n1", T + 5_000);
      store.add(DID_A, "n1", T + 1_000);
      expect(store.countFor(DID_A)).toBe(1);
      expect(store.total()).toBe(1);
      store.prune(T + 2_000);
      expect(store.has(DID_A, "n1")).toBe(true);
      store.close?.();
    });

    it("prune removes only rows that expired strictly before `now`", () => {
      const store = make();
      store.add(DID_A, "old", T - 1);
      store.add(DID_A, "edge", T);
      store.add(DID_B, "live", T + 1);
      store.prune(T);
      expect(store.has(DID_A, "old")).toBe(false);
      expect(store.has(DID_A, "edge")).toBe(true);
      expect(store.has(DID_B, "live")).toBe(true);
      expect(store.countFor(DID_A)).toBe(1);
      expect(store.total()).toBe(2);
      store.prune(T + 10);
      expect(store.total()).toBe(0);
      expect(store.countFor(DID_A)).toBe(0);
      store.close?.();
    });
  });
}

describe("SqliteSendNonceStore across a restart", () => {
  it("a consumed nonce survives close + reopen on the same path, so the replay is still refused", () => {
    const path = tempDb();
    const first = new SqliteSendNonceStore(path);
    first.add(DID_A, "consumed-before-restart", T + 60_000);
    first.close();

    const second = new SqliteSendNonceStore(path);
    expect(second.has(DID_A, "consumed-before-restart")).toBe(true);
    expect(second.countFor(DID_A)).toBe(1);
    expect(second.total()).toBe(1);
    second.prune(T + 60_001);
    expect(second.has(DID_A, "consumed-before-restart")).toBe(false);
    second.close();
  });

  it("two handles on the same file (e.g. alongside the relay's queue db) see the same rows", () => {
    const path = tempDb();
    const a = new SqliteSendNonceStore(path);
    const b = new SqliteSendNonceStore(path); // e.g. a second handle on the relay's queue db
    a.add(DID_A, "n1", T);
    expect(b.has(DID_A, "n1")).toBe(true);
    a.close();
    b.close();
  });
});
