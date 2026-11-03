// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// ladder_rung_audit.test.ts — LadderChannel's onRungResult audit hook (I6),
// with stub DeliveryChannels only (no crypto, no network). Recipient ids are
// synthetic ("did:peer:test-…").
import { describe, it, expect } from "vitest";
import { LadderChannel, type LadderRungResult } from "./ladder_channel.js";
import type { DeliveryChannel } from "./delivery_channel.js";

const PEER = "did:peer:test-ben";

const ok = (got: string[] = []): DeliveryChannel => ({ deliver: async (_d, w) => void got.push(w), onInbound: () => undefined });
const failing = (msg: string): DeliveryChannel => ({
  deliver: async () => {
    throw new Error(msg);
  },
  onInbound: () => undefined,
});
// Never settles; the ref'd timer only keeps the event loop alive meanwhile (the ladder's own budget timer is unref'd).
const hanging = (): DeliveryChannel => ({
  deliver: () => new Promise<void>(() => void setTimeout(() => undefined, 100)),
  onInbound: () => undefined,
});

describe("LadderChannel onRungResult", () => {
  it("reports a single ok result when the first rung succeeds", async () => {
    const results: LadderRungResult[] = [];
    const ladder = new LadderChannel({ dataRungs: [{ name: "relay", channel: ok() }], onRungResult: (e) => results.push(e) });
    await ladder.deliver(PEER, "w");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ rung: "relay", ok: true, recipientDid: PEER });
    expect(results[0].error).toBeUndefined();
    expect(typeof results[0].ms).toBe("number");
  });

  it("reports every failure, with its error, when all rungs fail", async () => {
    const results: LadderRungResult[] = [];
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: failing("relay down") },
        { name: "lan_http", channel: failing("post 503") },
      ],
      onRungResult: (e) => results.push(e),
    });
    await expect(ladder.deliver(PEER, "w")).rejects.toThrow(/all rungs failed/);
    expect(results.map((r) => [r.rung, r.ok, r.error])).toEqual([
      ["relay", false, "relay down"],
      ["lan_http", false, "post 503"],
    ]);
  });

  it("reports a budget timeout as a failed rung", async () => {
    const results: LadderRungResult[] = [];
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "iroh", channel: hanging() },
        { name: "lan_http", channel: ok() },
      ],
      budgets: { irohMs: 20 },
      onRungResult: (e) => results.push(e),
    });
    await ladder.deliver(PEER, "w");
    expect(results.map((r) => [r.rung, r.ok])).toEqual([
      ["iroh", false],
      ["lan_http", true],
    ]);
    expect(results[0].error).toMatch(/timed out after 20ms/);
    expect(results[0].ms).toBeGreaterThanOrEqual(15);
  });

  it("reports iroh then lan_http in fall-through order, and still delivers", async () => {
    const got: string[] = [];
    const results: LadderRungResult[] = [];
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "iroh", channel: failing("all 1 relay attempts failed") },
        { name: "lan_http", channel: ok(got) },
      ],
      onRungResult: (e) => results.push(e),
    });
    await ladder.deliver(PEER, "w");
    expect(got).toEqual(["w"]);
    expect(results.map((r) => r.rung)).toEqual(["iroh", "lan_http"]);
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(results.every((r) => r.recipientDid === PEER)).toBe(true);
  });

  it("a throwing hook does not change delivery", async () => {
    const got: string[] = [];
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "iroh", channel: failing("down") },
        { name: "lan_http", channel: ok(got) },
      ],
      onRungResult: () => {
        throw new Error("sink broke");
      },
    });
    await ladder.deliver(PEER, "w");
    expect(got).toEqual(["w"]);
  });

  it("works unchanged without a hook", async () => {
    const got: string[] = [];
    const ladder = new LadderChannel({ dataRungs: [{ name: "lan_http", channel: ok(got) }] });
    await ladder.deliver(PEER, "w");
    expect(got).toEqual(["w"]);
  });
});
