// LadderChannel — ordered fallback composition of DeliveryChannel rungs
// (core-transport-plan.md §0 SCOPE REVISION + Task 3, simplified to "T3'").
//
// SCOPE: per §0, WebRTC / mediator-less direct P2P is DEFERRED. There is no
// "webrtc" rung and no signaling plane here — this ladder has exactly one
// data plane with two rungs, tried in the order the caller supplies them:
//
//   (b) relay      — RelayChannel, a trust-graph mediator (Task 7).
//   (b') iroh      — IrohRelayChannel, an alternative to (b) over
//                    interchangeable iroh relays (docs/IROH-RELAY.md).
//   (c) lan_http    — HttpPostChannel, the LAN HTTP floor (Task 1).
//
// LadderChannel is itself just another DeliveryChannel (composable, and in
// particular usable as DidCommTransport's `opts.channel`): `deliver()` tries
// each configured rung in order, advancing to the next on that rung's
// failure or timeout, and rejects only once every rung has failed.
// `onInbound(cb)` registers the SAME callback on every rung, so inbound wires
// from any rung funnel into the one shared sink DidCommTransport wires to its
// (unchanged) receiveInbound() — this file never decrypts or dispatches
// anything itself (core-transport-plan.md §1 rule 1).
//
// Failure detection per rung (documented + tested in ladder_channel.test.ts):
//   - relay:    the rung's own channel.deliver() rejects (relay unreachable,
//               every configured relay endpoint rejected the wire, or no
//               relay node known for the peer — see relay_channel.ts), OR
//               the rung does not settle within `budgets.relayAckMs` (when
//               configured) — LadderChannel races the call against that
//               budget itself, on top of whatever internal ack-timeout the
//               RelayChannel already applies per endpoint.
//   - lan_http: the rung's own channel.deliver() rejects (POST non-2xx, or a
//               socket-level failure — see delivery_channel.ts's
//               defaultHttpPost), OR it does not settle within
//               `budgets.httpMs` (when configured).
//
// Cross-rung duplicate delivery of the same signed message id (e.g. a sender
// whose relay rung succeeded but who also happens to be reachable directly)
// is intentionally NOT deduped here — DidCommTransport's DedupStore (Task 2)
// is the single place that absorbs any resulting duplicate, keyed on the
// cryptographically-authenticated message id. This file only ever fans the
// same wire to the same sink; it never inspects wire contents.
import type { DeliveryChannel } from "./delivery_channel.js";

/** T3' scope: exactly these two data-plane rungs. No "webrtc" — see file header. */
export type LadderRungName = "relay" | "iroh" | "lan_http";

export interface LadderRung {
  name: LadderRungName;
  channel: DeliveryChannel;
}

export interface LadderBudgets {
  /** Per-attempt budget for the "relay" rung. Unset = no LadderChannel-level timeout (the rung's own internal timeout, if any, still applies). */
  relayAckMs?: number;
  /** Per-attempt budget for the "iroh" rung (IrohRelayChannel). Unset = no LadderChannel-level timeout. */
  irohMs?: number;
  /** Per-attempt budget for the "lan_http" rung. Unset = no LadderChannel-level timeout. */
  httpMs?: number;
}

export interface LadderOptions {
  /** Ordered rungs; deliver() tries them in this exact order. Must not be empty. */
  dataRungs: LadderRung[];
  budgets?: LadderBudgets;
}

function budgetFor(name: LadderRungName, budgets: LadderBudgets): number | undefined {
  if (name === "relay") return budgets.relayAckMs;
  if (name === "iroh") return budgets.irohMs;
  return budgets.httpMs;
}

/** Races `fn()` against `ms` (when defined); a timeout counts as that rung failing, exactly like a rejection. */
async function withBudget<T>(ms: number | undefined, fn: () => Promise<T>): Promise<T> {
  if (ms === undefined) return fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  const work = fn();
  // Promise.race never cancels the loser: if the timeout wins, `work` keeps
  // running and may reject later with no other handler attached, which would
  // otherwise surface as an unhandled rejection (the same class of hazard
  // documented in ladder_channel.test.ts's frozen-code finding, except this
  // one would be ours to fix). Attaching a no-op catch here is a pure
  // loser-guard: when `work` wins the race, this branch is a harmless
  // dead-end — the real value/rejection already propagated through the
  // `Promise.race` result below.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class LadderChannel implements DeliveryChannel {
  private readonly dataRungs: LadderRung[];
  private readonly budgets: LadderBudgets;

  constructor(opts: LadderOptions) {
    if (opts.dataRungs.length === 0) {
      throw new Error("LadderChannel: dataRungs must not be empty");
    }
    this.dataRungs = opts.dataRungs;
    this.budgets = opts.budgets ?? {};
  }

  /**
   * Try each configured rung in order; the first to succeed wins. A rung
   * that rejects OR exceeds its configured budget is treated identically —
   * advance to the next rung. Rejects only once every rung has failed, with
   * every rung's failure reason collected (so a LadderChannel-as-top-rung
   * caller, e.g. a future outer ladder, gets a complete picture).
   */
  async deliver(recipientDid: string, wire: string): Promise<void> {
    const errors: string[] = [];
    for (const rung of this.dataRungs) {
      try {
        await withBudget(budgetFor(rung.name, this.budgets), () => rung.channel.deliver(recipientDid, wire));
        return;
      } catch (err) {
        errors.push(`${rung.name}: ${(err as Error).message}`);
      }
    }
    throw new Error(
      `LadderChannel.deliver: all rungs failed for ${recipientDid} (${errors.join("; ")})`
    );
  }

  /**
   * Register the SAME callback on every configured rung's onInbound, so
   * inbound wires from any rung funnel into the one shared sink. Rungs whose
   * onInbound is a no-op (e.g. HttpPostChannel — HTTP inbound is mounted
   * separately at POST /didcomm) are unaffected by this call, exactly as if
   * addressed directly.
   */
  onInbound(cb: (wire: string) => void): void {
    for (const rung of this.dataRungs) {
      rung.channel.onInbound(cb);
    }
  }

  /**
   * True if at least one rung is available. A rung with no `isAvailable`
   * probe is assumed available (mirrors HttpPostChannel, which has none —
   * the LAN HTTP floor has no native-module gate to probe).
   */
  async isAvailable(): Promise<boolean> {
    const results = await Promise.all(
      this.dataRungs.map(async (rung) => {
        if (!rung.channel.isAvailable) return true;
        try {
          return await rung.channel.isAvailable();
        } catch {
          return false;
        }
      })
    );
    return results.some(Boolean);
  }

  async close(): Promise<void> {
    await Promise.all(this.dataRungs.map((rung) => rung.channel.close?.()));
  }
}
