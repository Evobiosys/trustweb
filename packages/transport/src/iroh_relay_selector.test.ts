// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// iroh_relay_selector.test.ts — IrohRelaySelector with an injected clock. No
// network, no timers: relay urls are synthetic (*.example).
import { describe, it, expect } from "vitest";
import { IrohRelaySelector } from "./iroh_relay_selector.js";

const A = "https://relay-a.example";
const B = "https://relay-b.example";
const C = "https://relay-c.example";

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

describe("IrohRelaySelector", () => {
  it("keeps the given order and de-duplicates when everything is healthy", () => {
    const s = new IrohRelaySelector({ now: clock().now });
    expect(s.order([A, B, A, C, B])).toEqual([A, B, C]);
    expect(s.order([])).toEqual([]);
  });

  it("moves a cooling-down relay after the healthy ones, but still offers it", () => {
    const s = new IrohRelaySelector({ now: clock().now });
    s.reportFailure(A);
    expect(s.isCoolingDown(A)).toBe(true);
    expect(s.order([A, B, C])).toEqual([B, C, A]);
  });

  it("orders a fully degraded set in the given order (still tried, last)", () => {
    const s = new IrohRelaySelector({ now: clock().now });
    s.reportFailure(B);
    s.reportFailure(A);
    expect(s.order([A, B])).toEqual([A, B]);
    expect(s.order([C, A, B])).toEqual([C, A, B]);
  });

  it("cooldown doubles per consecutive failure and is capped", () => {
    const c = clock();
    const s = new IrohRelaySelector({ now: c.now, cooldownMs: 100, maxCooldownMs: 300 });
    s.reportFailure(A);
    expect(s.snapshot()).toEqual([{ url: A, failures: 1, cooledUntil: c.t + 100 }]);
    s.reportFailure(A);
    expect(s.snapshot()[0]).toEqual({ url: A, failures: 2, cooledUntil: c.t + 200 });
    s.reportFailure(A);
    expect(s.snapshot()[0]).toEqual({ url: A, failures: 3, cooledUntil: c.t + 300 });
    s.reportFailure(A);
    expect(s.snapshot()[0].cooledUntil).toBe(c.t + 300);
  });

  it("uses the documented defaults (60 s, capped at 15 min)", () => {
    const c = clock();
    const s = new IrohRelaySelector({ now: c.now });
    s.reportFailure(A);
    expect(s.snapshot()[0].cooledUntil).toBe(c.t + 60_000);
    for (let i = 0; i < 10; i++) s.reportFailure(A);
    expect(s.snapshot()[0].cooledUntil).toBe(c.t + 15 * 60_000);
  });

  it("a relay becomes healthy again once its cooldown elapses", () => {
    const c = clock();
    const s = new IrohRelaySelector({ now: c.now, cooldownMs: 100 });
    s.reportFailure(A);
    c.t += 99;
    expect(s.isCoolingDown(A)).toBe(true);
    c.t += 1;
    expect(s.isCoolingDown(A)).toBe(false);
    expect(s.order([A, B])).toEqual([A, B]);
    expect(s.snapshot()[0]).toEqual({ url: A, failures: 1, cooledUntil: null });
  });

  it("reportSuccess clears failures and cooldown", () => {
    const c = clock();
    const s = new IrohRelaySelector({ now: c.now, cooldownMs: 100 });
    s.reportFailure(A);
    s.reportFailure(A);
    s.reportSuccess(A);
    expect(s.isCoolingDown(A)).toBe(false);
    expect(s.snapshot()).toEqual([]);
    s.reportFailure(A);
    expect(s.snapshot()[0]).toEqual({ url: A, failures: 1, cooledUntil: c.t + 100 });
  });

  it("isCoolingDown is false for unknown relays and snapshot lists only known ones", () => {
    const s = new IrohRelaySelector({ now: clock().now });
    expect(s.isCoolingDown(C)).toBe(false);
    s.reportFailure(B);
    s.reportFailure(A);
    expect(s.snapshot().map((e) => e.url)).toEqual([B, A]);
  });

  it("falls back to Date.now when no clock is injected", () => {
    const s = new IrohRelaySelector();
    const before = Date.now();
    s.reportFailure(A);
    const until = s.snapshot()[0].cooledUntil!;
    expect(until).toBeGreaterThanOrEqual(before + 60_000);
  });
});
