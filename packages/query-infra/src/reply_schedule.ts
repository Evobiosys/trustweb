// Uniform reply scheduling (I3 timing-leak fix, D19/D20 known-debt, roadmap
// 2d slice). Manual gate operation means an approve can land 2s after a
// query while a decline lands 90s later — an attentive requester can read
// that latency gap as a signal ("fast = auto-approved, slow = a human
// deliberated"). Releasing every outward response only on a shared,
// fixed-cadence tick (default 30s) collapses that gap: whichever tick window
// a decision becomes ready in, release happens at that window's boundary,
// identically for a 2s decision and a 28s decision in the same window.
//
// Pure core only — no timers, no real clock. The host (demo/server.ts) owns
// the setInterval and the wall-clock `now`.

/** Given the wall-clock time a decision became ready, returns the next tick
 * boundary at or after it, relative to `epoch`. Ready-at-the-boundary itself
 * releases on that boundary (not the next one after). */
export function releaseAtForTick(decisionReadyAt: number, tickIntervalMs: number, epoch = 0): number {
  if (tickIntervalMs <= 0) throw new RangeError("tickIntervalMs must be positive");
  const elapsed = decisionReadyAt - epoch;
  const ticksElapsed = Math.ceil(elapsed / tickIntervalMs);
  return epoch + Math.max(ticksElapsed, 0) * tickIntervalMs;
}

export interface ScheduledPayload<T> {
  payload: T;
  releaseAt: number;
}

/** Buckets pending outward payloads by release tick and hands back whatever
 * is due at a given `now`. One instance per outward channel (e.g. the demo's
 * relay push path); payloads are opaque to the scheduler. */
export class ReplySchedule<T> {
  private pending: ScheduledPayload<T>[] = [];

  constructor(
    private readonly tickIntervalMs: number,
    private readonly epoch = 0,
  ) {}

  /** Enqueues a payload whose decision became ready at `decisionReadyAt`.
   * Returns the tick boundary it will release at. */
  enqueue(payload: T, decisionReadyAt: number): number {
    const releaseAt = releaseAtForTick(decisionReadyAt, this.tickIntervalMs, this.epoch);
    this.pending.push({ payload, releaseAt });
    return releaseAt;
  }

  /** Removes and returns every payload whose release tick has arrived by
   * `now` (inclusive). Order among simultaneously-due payloads is not
   * meaningful (deliberately — order can itself leak sequencing). */
  due(now: number): T[] {
    const due: T[] = [];
    const rest: ScheduledPayload<T>[] = [];
    for (const p of this.pending) {
      if (p.releaseAt <= now) due.push(p.payload);
      else rest.push(p);
    }
    this.pending = rest;
    return due;
  }

  get size(): number {
    return this.pending.length;
  }
}
