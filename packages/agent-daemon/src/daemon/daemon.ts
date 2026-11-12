// Daemon — one persona's whole agent: owner-side request lifecycle (I3),
// asker-side fan-out + aggregation (I2), room chat, and the REST/WS surface's
// backing logic. This class is deliberately the single place lifecycle state
// changes happen so the two invariants at the heart of this package have one
// call site each to audit:
//   - I3: `dispatchOwnerStatus` is the ONLY place a STATUS envelope is sent,
//     and it always computes PASS-vs-PENDING from the card's state AT FIRE
//     TIME — never from whatever triggered the schedule.
//   - I2: asker-facing reads never happen here directly; callers go through
//     api/sanitize.ts, and every audit entry about an ask this persona SENT
//     goes through audit/audit.ts's `logAsker`, which refuses to persist a
//     peer id or a PENDING-vs-PASS distinction.
import { randomUUID } from "node:crypto";
import {
  evaluatePolicy,
  ItemSchema,
  statusDispatchAt,
  TrustEdgeSchema,
  transitionAskerState,
  transitionOwnerState,
  type Envelope,
  type Item,
  type TransportAdapter,
  type TrustEdge,
  type TrustLevel,
  type WithdrawnReason,
} from "@resource-web/protocol";
import type { Clock, Scheduler } from "../clock.js";
import { hasRoomMessaging, type RoomMessage } from "../transport/in_memory_transport.js";
import type { Store } from "../store/store.js";
import type { AskPeerRecord, AskRecord, ConnectRecord, IncomingKind, IncomingRecord, ListingRecord, LoanRecord, RelayLinkRecord } from "../store/types.js";
import { matchRequestToItems, type MatcherConfig } from "../matcher/matcher.js";
import type { ChatClient, EmbedClient } from "../matcher/clients.js";
import { logAsker, logOwner } from "../audit/audit.js";
import { connectAckEnvelope, connectEnvelope, consentEnvelope, introEnvelope, requestEnvelope, statusEnvelope, withdrawnEnvelope } from "./envelopes.js";
import { classifyAndRespond, type StewardDeps } from "../steward/steward.js";
import {
  approveLoan,
  checkInLoanCompletion,
  declineLoan,
  markLent,
  markReturned,
  publishListing,
  receiveDm,
  receiveListing,
  receiveLoan,
  requestBorrow,
  sendDm,
  withdrawListing,
  type ListingsDeps,
  type PublishListingInput,
} from "./listings.js";
import { buildAuditApiView, buildStateSnapshot } from "../api/sanitize.js";
import type { AuditApiEntry, StateSnapshot } from "../api/types.js";

export interface DaemonConfig {
  personaName: string;
  peerId: string;
  accent: string;
  statusDelayMs: number;
  defaultAskTtlMs: number;
  matcher: MatcherConfig;
}

export interface DaemonDeps {
  config: DaemonConfig;
  store: Store;
  transport: TransportAdapter;
  scheduler: Scheduler;
  clock: Clock;
  embedClient: EmbedClient;
  chatClient: ChatClient;
  /** Called after any state mutation — server.ts uses this to fan out the WS `state_changed` event. */
  onChange?: () => void;
}

export class Daemon {
  constructor(private readonly deps: DaemonDeps) {}

  private get store(): Store {
    return this.deps.store;
  }
  private get transport(): TransportAdapter {
    return this.deps.transport;
  }
  private get scheduler(): Scheduler {
    return this.deps.scheduler;
  }
  private get clock(): Clock {
    return this.deps.clock;
  }
  private get cfg(): DaemonConfig {
    return this.deps.config;
  }
  private get matcherDeps() {
    return { store: this.store, embedClient: this.deps.embedClient, chatClient: this.deps.chatClient, config: this.cfg.matcher };
  }
  private get listingsDeps(): ListingsDeps {
    return { store: this.store, clock: this.clock, transport: this.transport, peerId: this.cfg.peerId, personaName: this.cfg.personaName };
  }

  async init(): Promise<void> {
    await this.transport.init({ self: this.cfg.peerId, display: this.cfg.personaName });
    // Returning the promise (not `void`-ing it) lets InMemoryTransport await
    // full receiver-side processing before `send()` resolves — see
    // in_memory_transport.ts's RegisteredPeer note. TS's void-return leniency
    // allows this assignment even though TransportAdapter's onEnvelope type
    // says the callback returns void.
    this.transport.onEnvelope((from, env) => this.handleEnvelope(from, env));
    if (hasRoomMessaging(this.transport)) {
      this.transport.onRoomMessage((msg) => this.onRoomMessage(msg));
    }
  }

  // ---------------------------------------------------------------- state --

  getStateSnapshot(): StateSnapshot {
    return buildStateSnapshot({ name: this.cfg.personaName, peer_id: this.cfg.peerId, accent: this.cfg.accent }, this.store, this.clock.now());
  }

  getAudit(): AuditApiEntry[] {
    return buildAuditApiView(this.store.getAudit());
  }

  /**
   * Task 5: exposes the store read-only-by-convention so server.ts can build
   * additive views (guest listings, thread messages) through api/sanitize.ts
   * without daemon.ts growing a thin passthrough method per view. Every
   * caller outside this class still goes through sanitize.ts's chokepoint
   * (I2) for anything asker-facing — this getter itself performs no
   * filtering.
   */
  getStore(): Store {
    return this.store;
  }

  private notifyChange(): void {
    this.deps.onChange?.();
  }

  /** server.ts wires this to broadcast the WS `state_changed` event. */
  setOnChange(cb: () => void): void {
    this.deps.onChange = cb;
  }

  // ---------------------------------------------------------- asker side --

  async sendAsk(text: string, opts: { ttlMs?: number; lang?: string; area?: string } = {}): Promise<AskRecord> {
    const requestId = randomUUID();
    const createdAt = this.clock.now();
    const ttlMs = opts.ttlMs ?? this.cfg.defaultAskTtlMs;

    let embedding: number[] | undefined;
    try {
      const [vector] = await this.deps.embedClient.embed(this.cfg.matcher.embedModel, [text]);
      embedding = vector;
    } catch {
      embedding = undefined;
    }

    const edges = this.store.getTrustEdges().filter((e) => new Date(e.expires_at).getTime() > createdAt.getTime());
    const peers: AskPeerRecord[] = edges.map((e) => ({ peer: e.peer, state: "queried" }));
    const ask: AskRecord = {
      request_id: requestId,
      text,
      lang: opts.lang,
      area: opts.area,
      created_at: createdAt.toISOString(),
      ttl_ms: ttlMs,
      internal_state: "open",
      queried_count: edges.length,
      peers,
    };
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "sent_request",
      `Fanned out REQUEST to ${edges.length} trusted peer(s).`,
      edges.map((e) => e.peer)
    );

    for (const edge of edges) {
      await this.transport.send(edge.peer, requestEnvelope(requestId, createdAt, { text, lang: opts.lang, embedding, area: opts.area, ttl: ttlMs }));
    }

    this.checkAskAllIn(requestId);
    this.scheduler.scheduleAt(new Date(createdAt.getTime() + ttlMs).toISOString(), () => this.resolveAskOnTtl(requestId));

    this.notifyChange();
    return this.store.getAsk(requestId)!;
  }

  async withdraw(requestId: string, reason: WithdrawnReason = "cancelled"): Promise<void> {
    const ask = this.store.getAsk(requestId);
    if (!ask) throw new Error(`withdraw: unknown request ${requestId}`);
    ask.internal_state = transitionAskerState(ask.internal_state, { type: "WITHDRAW", reason });
    ask.withdrawn_reason = reason;
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "withdrawn",
      `Withdrew request (${reason}).`,
      ask.peers.map((p) => p.peer)
    );
    for (const peer of ask.peers) {
      await this.transport.send(peer.peer, withdrawnEnvelope(requestId, this.clock.now(), reason));
    }
    this.notifyChange();
  }

  private checkAskAllIn(requestId: string): void {
    const ask = this.store.getAsk(requestId);
    if (!ask || ask.internal_state !== "open") return;
    const allIn = ask.peers.every((p) => p.state !== "queried");
    if (!allIn) return;
    const anyPending = ask.peers.some((p) => p.state === "pending" || p.state === "consented");
    ask.internal_state = transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending });
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "status_resolved",
      anyPending ? "Aggregate resolved: waiting for someone to help." : "Aggregate resolved: no one this time.",
      ask.peers.map((p) => p.peer)
    );
  }

  /**
   * Fires at the ask's own TTL. Two cases, BOTH must notify (WS
   * `state_changed`) so a WS-only client refetches and sees the right view:
   *   - internal_state still "open" (nobody replied at all, or not everyone
   *     did): forces the STATUS_ALL_IN resolution here, same as if the last
   *     peer's STATUS had just arrived.
   *   - internal_state already "pending" (someone matched + sent PENDING,
   *     but no CONSENT ever arrived — including the I3 decline-after-
   *     dispatch case, which leaves internal_state at "pending" forever by
   *     design, see api/sanitize.ts): nothing to mutate here — the
   *     degradation to "no_one_this_time" happens at the VIEW layer purely
   *     from `now` vs `created_at + ttl_ms` — but a client watching WS only
   *     (never polling) still needs a nudge to go re-fetch /api/state and
   *     observe that degraded view. Without this, such a client would show
   *     stale "waiting" forever once the state machine itself stops
   *     changing.
   */
  private resolveAskOnTtl(requestId: string): void {
    const ask = this.store.getAsk(requestId);
    if (!ask) return;
    if (ask.internal_state !== "open") {
      // Not stuck in "open" — either already resolved to "pending"/"pass"/etc
      // in the normal way, or genuinely withdrawn/consented/roomed. Only the
      // still-"pending" case has a view-layer-only change to announce at
      // this exact moment; the others already notified when they happened.
      if (ask.internal_state === "pending") {
        this.notifyChange();
      }
      return;
    }
    const anyPending = ask.peers.some((p) => p.state === "pending" || p.state === "consented");
    ask.internal_state = transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending });
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "status_resolved",
      `TTL reached: aggregate resolved to ${anyPending ? "waiting for someone to help" : "no one this time"}.`,
      ask.peers.map((p) => p.peer)
    );
    this.notifyChange();
  }

  private askerHandleStatus(from: string, requestId: string, state: "PASS" | "PENDING"): void {
    const ask = this.store.getAsk(requestId);
    if (!ask) return;
    const peer = ask.peers.find((p) => p.peer === from);
    if (!peer) return;
    peer.state = state === "PASS" ? "pass" : "pending";
    this.store.putAsk(ask);
    this.checkAskAllIn(requestId);
  }

  private askerHandleConsent(from: string, requestId: string, conditions?: string): void {
    void conditions;
    const ask = this.store.getAsk(requestId);
    if (!ask) return;
    const peer = ask.peers.find((p) => p.peer === from);
    if (peer) peer.state = "consented";

    if (ask.internal_state === "open") {
      // CONSENT from one peer can outrun another peer's STATUS reply; force
      // the aggregate resolution first (this peer definitely isn't a plain
      // PASS), then apply CONSENT on top.
      ask.internal_state = transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending: true });
    }
    if (ask.internal_state === "pending") {
      ask.internal_state = transitionAskerState("pending", { type: "CONSENT" });
    }
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "consent_received",
      "Someone can help.",
      ask.peers.map((p) => p.peer)
    );
  }

  private askerHandleIntro(from: string, requestId: string, roomId: string): void {
    const ask = this.store.getAsk(requestId);
    if (!ask || ask.internal_state !== "consented") return;
    ask.internal_state = transitionAskerState("consented", { type: "ROOM_CREATED" });
    ask.room_id = roomId;
    this.store.putAsk(ask);
    this.store.putRoom({
      room_id: roomId,
      request_id: requestId,
      peers: [
        { peer_id: this.cfg.peerId, display: this.cfg.personaName },
        { peer_id: from, display: from },
      ],
      context: ask.text,
      created_at: this.clock.now().toISOString(),
    });
    logAsker(this.store, this.clock, requestId, "room_opened", "Room opened.", [from]);
  }

  // ---------------------------------------------------------- owner side --

  private async ownerHandleRequest(from: string, env: Extract<Envelope, { type: "REQUEST" }>): Promise<void> {
    const requestId = env.request_id;
    const receivedAt = this.clock.now();
    const edge = this.store.getTrustEdge(from);
    const items = this.store.getItems();
    const evaluations = new Map(items.map((item) => [item.id, evaluatePolicy(item, env.body, edge, receivedAt)]));
    const eligibleItems = items.filter((item) => evaluations.get(item.id)!.eligible);

    const dispatchAt = statusDispatchAt(receivedAt, this.cfg.statusDelayMs);

    let matched: { item: Item; needsConsent: boolean } | undefined;
    if (eligibleItems.length > 0) {
      const result = await matchRequestToItems(env.body.text, eligibleItems, this.matcherDeps);
      for (const s of result.scores) {
        logOwner(this.store, this.clock, requestId, "match_score", `stage=${s.stage} item=${s.item_id} score=${s.score.toFixed(4)} — ${s.detail}`);
      }
      if (result.matched && result.item_id) {
        const item = this.store.getItem(result.item_id)!;
        matched = { item, needsConsent: evaluations.get(item.id)!.needsConsent };
      }
    } else {
      logOwner(this.store, this.clock, requestId, "no_eligible_items", "No item is policy-eligible for this requester.");
    }

    // D16 / I8 defense-in-depth: a second_brain item is only relay-eligible
    // if its noted owner is still a connected peer (live, unexpired trust
    // edge) — mirrors the D14 "connected-only" guard already applied to
    // sendDm/receiveDm/receiveLoan (listings.ts), which `forwardRelay`
    // predates and never got. Without this, a noted owner with no reachable
    // trust edge (a future local-only Contact, or an edge that has since
    // expired) would reach `forwardRelay` and either throw mid-flight or
    // misroute (docs/research/solo-graph-extension.md §5). Folding this into
    // the SAME `matched === undefined` branch below — rather than a separate
    // early return — is what makes the resulting PASS byte-identical to a
    // genuine no-match on the wire (I3) by construction, not by careful
    // copying; only the local audit action/message differs (I6).
    let relaySkipDetail: string | undefined;
    if (matched && matched.item.provenance.kind === "second_brain") {
      const ownerId = matched.item.provenance.owner;
      const ownerEdge = this.store.getTrustEdge(ownerId);
      const ownerReachable = ownerEdge !== undefined && new Date(ownerEdge.expires_at).getTime() > receivedAt.getTime();
      if (!ownerReachable) {
        relaySkipDetail = `Matched item ${matched.item.id}'s noted owner ${ownerId} has no live trust edge; cannot relay (I8) — treating as no match.`;
        matched = undefined;
      }
    }

    if (!matched) {
      logOwner(
        this.store,
        this.clock,
        requestId,
        relaySkipDetail ? "relay_skipped_unreachable_owner" : "no_match",
        relaySkipDetail ?? "No eligible item matched this request; PASS scheduled at uniform delay."
      );
      this.scheduler.scheduleAt(dispatchAt, async () => {
        await this.transport.send(from, statusEnvelope(requestId, this.clock.now(), "PASS"));
        logOwner(this.store, this.clock, requestId, "status_pass", "Sent PASS (no eligible match).");
        this.notifyChange();
      });
      this.notifyChange();
      return;
    }

    const cardId = randomUUID();
    const kind: IncomingKind = matched.item.provenance.kind === "second_brain" ? "relay" : "direct";
    const autoForward = !matched.needsConsent;

    const record: IncomingRecord = {
      card_id: cardId,
      request_id: requestId,
      requester_peer: from,
      requester_display: edge?.display ?? from,
      text: env.body.text,
      received_at: receivedAt.toISOString(),
      matched_item_id: matched.item.id,
      kind,
      state: autoForward ? "consented" : "pending",
      internal_state: autoForward ? "consented" : "matched",
      status_dispatch_at: dispatchAt,
      status_dispatched: false,
    };
    this.store.putIncoming(record);

    if (autoForward) {
      logOwner(this.store, this.clock, requestId, "auto_forward_consent", `Auto-forwarded (policy mode=auto_forward) for item ${matched.item.id}.`);
    } else {
      logOwner(this.store, this.clock, requestId, "consent_card_created", `Consent card created for item ${matched.item.id}; awaiting owner decision.`);
    }

    this.scheduler.scheduleAt(dispatchAt, () => this.dispatchOwnerStatus(cardId));
    this.notifyChange();
  }

  /**
   * I3 core: the ONLY place a STATUS is sent for a matched request. Content
   * is computed from the card's state AT THIS MOMENT (fire time), never from
   * whatever the state was when this callback was scheduled — that's what
   * makes a decline-before-dispatch produce the exact same PASS as a genuine
   * no-match (see ownerHandleRequest's no-match branch, which builds the
   * byte-identical PASS via the same `statusEnvelope(requestId, ts, "PASS")`).
   */
  private async dispatchOwnerStatus(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId);
    if (!card || card.status_dispatched) return;
    card.status_dispatched = true;
    this.store.putIncoming(card);

    const ts = this.clock.now();
    if (card.state === "declined" || card.state === "inactive") {
      await this.transport.send(card.requester_peer, statusEnvelope(card.request_id, ts, "PASS"));
      card.internal_state = transitionOwnerState("matched", { type: "CONSENT_DECISION", accepted: false });
      this.store.putIncoming(card);
      logOwner(
        this.store,
        this.clock,
        card.request_id,
        "status_pass",
        card.state === "inactive" ? "Sent PASS (request was withdrawn before dispatch)." : "Sent PASS (declined before dispatch — indistinguishable from no-match, I3)."
      );
      this.notifyChange();
      return;
    }

    await this.transport.send(card.requester_peer, statusEnvelope(card.request_id, ts, "PENDING"));
    logOwner(this.store, this.clock, card.request_id, "status_pending", "Sent PENDING at uniform delay.");

    if (card.state === "consented") {
      await this.finalizeConsent(card.card_id);
    }
    this.notifyChange();
  }

  async consent(cardId: string, conditions?: string): Promise<void> {
    const card = this.store.getIncoming(cardId);
    if (!card) throw new Error(`consent: unknown card ${cardId}`);
    if (card.state !== "pending") throw new Error(`consent: card ${cardId} is not pending (state=${card.state})`);
    card.state = "consented";
    card.conditions = conditions;
    this.store.putIncoming(card);
    logOwner(this.store, this.clock, card.request_id, "consented", `Owner consented to share item ${card.matched_item_id}.` + (conditions ? ` Conditions: ${conditions}` : ""));
    if (card.status_dispatched) {
      await this.finalizeConsent(cardId);
    }
    // else: dispatchOwnerStatus (already scheduled) will see state === "consented"
    // once it fires, send PENDING, then call finalizeConsent itself.
    this.notifyChange();
  }

  async decline(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId);
    if (!card) throw new Error(`decline: unknown card ${cardId}`);
    if (card.state !== "pending") throw new Error(`decline: card ${cardId} is not pending (state=${card.state})`);
    card.state = "declined";
    this.store.putIncoming(card);
    logOwner(this.store, this.clock, card.request_id, "declined", `Owner declined to share item ${card.matched_item_id}.`);
    // I3: if status_dispatched is already true, PENDING already went out —
    // decline now sends NOTHING further (silence). If not yet dispatched,
    // dispatchOwnerStatus will see state === "declined" and send PASS.
    this.notifyChange();
  }

  private async completeConsent(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId)!;
    const item = this.store.getItem(card.matched_item_id!)!;
    const contextCard = `${card.text} — matched: ${item.labels[0]}${card.conditions ? ` (conditions: ${card.conditions})` : ""}`;

    const { room_id } = await this.transport.createSharedRoom([this.cfg.peerId, card.requester_peer], {
      request_id: card.request_id,
      context_card: contextCard,
    });
    this.store.putRoom({
      room_id,
      request_id: card.request_id,
      peers: [
        { peer_id: this.cfg.peerId, display: this.cfg.personaName },
        { peer_id: card.requester_peer, display: card.requester_display },
      ],
      context: contextCard,
      created_at: this.clock.now().toISOString(),
    });

    await this.transport.send(card.requester_peer, consentEnvelope(card.request_id, this.clock.now(), card.conditions));
    await this.transport.send(card.requester_peer, introEnvelope(card.request_id, this.clock.now(), room_id));

    card.internal_state = "consented";
    this.store.putIncoming(card);
    logOwner(this.store, this.clock, card.request_id, "room_created", `Room ${room_id} created; CONSENT + INTRO sent.`);
  }

  /**
   * The single fork point between a direct card's consent and a relay card's
   * consent (I8): a direct card opens a room right here; a relay card instead
   * forwards a fresh REQUEST to the noted owner and waits. Called from the
   * exact two sites `completeConsent` used to be called from (consent()'s
   * already-dispatched branch, and dispatchOwnerStatus's post-PENDING branch)
   * — same mutual-exclusion guarantee those two call sites already provide,
   * so a relay card's PENDING is always on the wire before anything relay-
   * related happens, without repeating that gating logic here.
   */
  private async finalizeConsent(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId)!;
    if (card.kind === "relay") {
      await this.forwardRelay(cardId);
    } else {
      await this.completeConsent(cardId);
    }
  }

  /**
   * I8 relay hop 1->2: instead of opening a room with the requester, forward
   * a fresh REQUEST (same protocol v0.1 envelope, no new type) to the noted
   * owner, and remember the link so a later CONSENT/STATUS from them can be
   * routed back here (see `handleEnvelope`'s relay-link lookup).
   *
   * Called from exactly the same two mutually-exclusive sites
   * `completeConsent` always was (`consent()`'s already-dispatched branch,
   * XOR `dispatchOwnerStatus`'s post-PENDING branch) via `finalizeConsent` —
   * that mutual exclusion is what already guarantees this runs at most once
   * per card, the same guarantee the direct-card path has always relied on
   * without an extra idempotency check of its own.
   */
  private async forwardRelay(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId)!;
    const item = this.store.getItem(card.matched_item_id!)!;
    if (item.provenance.kind !== "second_brain") {
      throw new Error(`forwardRelay: item ${item.id} has no second_brain provenance (kind=${item.provenance.kind})`);
    }
    const notedOwner = item.provenance.owner;
    const downstreamRequestId = randomUUID();
    const ts = this.clock.now();

    const link: RelayLinkRecord = {
      upstream_request_id: card.request_id,
      upstream_requester: card.requester_peer,
      downstream_request_id: downstreamRequestId,
      noted_owner: notedOwner,
      state: "awaiting_downstream",
    };
    this.store.putRelayLink(link);

    logOwner(
      this.store,
      this.clock,
      card.request_id,
      "relay_forwarded",
      `Forwarding to noted owner for item ${item.id} (I8); downstream request ${downstreamRequestId}.`
    );

    await this.transport.send(notedOwner, requestEnvelope(downstreamRequestId, ts, { text: card.text, ttl: this.cfg.defaultAskTtlMs }));
  }

  /**
   * Downstream CONSENT arrived from the noted owner (Timo) for a relay link
   * still awaiting resolution: forwards the decision upstream (I8 — every hop
   * consents) and finalizes the chain. Simplification (documented in
   * DECISIONS.md): Timo's own completeConsent already opened a 2-party room
   * (him + this persona) and is about to send its own INTRO — neither
   * InMemoryTransport nor the planned MatrixTransport can invite a third
   * party into an existing room, so that room is discarded unused and this
   * persona mints a fresh 3-party room instead. Finalizing here (on CONSENT)
   * rather than waiting for Timo's matching INTRO is deliberate: this
   * persona never reuses Timo's room id, so that INTRO carries nothing this
   * flow needs — `relayHandleIntro` just no-ops once `state` is no longer
   * "awaiting_downstream".
   */
  private async relayHandleConsent(relay: RelayLinkRecord, conditions: string | undefined): Promise<void> {
    if (relay.state !== "awaiting_downstream") return;
    relay.state = "resolved";
    this.store.putRelayLink(relay);

    const card = this.store.getIncomingByRequestAndPeer(relay.upstream_request_id, relay.upstream_requester)!;
    card.internal_state = "consented";
    this.store.putIncoming(card);

    const item = this.store.getItem(card.matched_item_id!)!;
    const notedOwnerDisplay = this.store.getTrustEdge(relay.noted_owner)?.display ?? relay.noted_owner;
    const contextCard =
      `${card.text} — matched: ${item.labels[0]}${conditions ? ` (conditions: ${conditions})` : ""}` +
      ` — introduced by ${this.cfg.personaName}`;

    const { room_id } = await this.transport.createSharedRoom([relay.upstream_requester, relay.noted_owner, this.cfg.peerId], {
      request_id: relay.upstream_request_id,
      context_card: contextCard,
    });
    this.store.putRoom({
      room_id,
      request_id: relay.upstream_request_id,
      peers: [
        { peer_id: relay.upstream_requester, display: card.requester_display },
        { peer_id: relay.noted_owner, display: notedOwnerDisplay },
        { peer_id: this.cfg.peerId, display: this.cfg.personaName },
      ],
      context: contextCard,
      created_at: this.clock.now().toISOString(),
    });

    await this.transport.send(relay.upstream_requester, consentEnvelope(relay.upstream_request_id, this.clock.now(), conditions));
    await this.transport.send(relay.upstream_requester, introEnvelope(relay.upstream_request_id, this.clock.now(), room_id));
    await this.transport.send(relay.noted_owner, introEnvelope(relay.downstream_request_id, this.clock.now(), room_id));

    logOwner(
      this.store,
      this.clock,
      relay.upstream_request_id,
      "relay_room_created",
      `Room ${room_id} created via relay (I8); CONSENT + INTRO sent upstream, INTRO sent to noted owner.`
    );
  }

  /**
   * Downstream STATUS arrived for a relay link. PENDING is the noted owner's
   * own uniform "still deciding" ping (I3, their side) — nothing to do, the
   * upstream requester already has their own PENDING.
   *
   * PASS means the noted owner declined or had no match. D15 (supersedes the
   * Task 1 brief's literal "sends the uniform PASS upstream"): this hop
   * resolves the relay link and its own consent card internally — card goes
   * `inactive` ("could not help", I6-audited) — and sends NOTHING further
   * upstream. Forwarding the PASS produced a `PENDING -> PASS` wire pattern
   * that occurs ONLY on the relay path: a direct decline-after-dispatch is
   * silence after PENDING (see `decline()`), so a forwarded PASS let an
   * asker infer relaying happened — exactly what I8 forbids ("no hop reveals
   * more than a direct request"). It was also functionally inert:
   * `askerHandleStatus` early-returns once `internal_state` has already left
   * "open", which the earlier PENDING guarantees. The asker's own ask now
   * degrades via its own TTL, identically to a direct decline-after-PENDING.
   */
  private relayHandleStatus(relay: RelayLinkRecord, state: "PASS" | "PENDING"): void {
    if (state === "PENDING") return;
    if (relay.state !== "awaiting_downstream") return;
    relay.state = "failed";
    this.store.putRelayLink(relay);

    const card = this.store.getIncomingByRequestAndPeer(relay.upstream_request_id, relay.upstream_requester)!;
    card.state = "inactive";
    card.internal_state = transitionOwnerState("matched", { type: "CONSENT_DECISION", accepted: false });
    this.store.putIncoming(card);

    logOwner(
      this.store,
      this.clock,
      relay.upstream_request_id,
      "relay_downstream_passed",
      "Noted owner declined or had no match; consent card marked inactive ('could not help') — nothing sent upstream, asker's own TTL degrades the ask (I8, D15)."
    );
  }

  /** See `relayHandleConsent`'s doc comment — the 3-party room is minted on CONSENT, not INTRO. */
  private relayHandleIntro(relay: RelayLinkRecord): void {
    void relay;
  }

  /**
   * I8: the noted owner (e.g. Timo) consented on a "direct" card and so has
   * no `AskRecord` of their own — `askerHandleIntro` early-returns for them
   * (no matching ask), which would otherwise silently drop the INTRO
   * `relayHandleConsent` sends them for the final 3-party room, leaving them
   * with only their own now-discarded 2-party room and no way to actually
   * join the conversation. This is the owner-side counterpart: it looks up
   * the (already-consented) card the INTRO's `request_id`/`from` matches and
   * records the room locally instead.
   *
   * Their local `peers` list still only knows the two peers they've directly
   * exchanged envelopes with (self + the relay hub) — this daemon has no
   * channel to learn a THIRD party's identity from a frozen-body INTRO
   * (`{room_id}` only) or from TransportAdapter (no room-membership query).
   * Posting a real room-chat message (the codebase's own sanctioned
   * additive extension over the frozen envelope set — see
   * in_memory_transport.ts) closes that gap for whoever's listening:
   * `onRoomMessage` learns an unlisted sender's identity the moment a
   * message from them arrives, so the relay hub's other leg (the original
   * requester) discovers this peer as soon as this announcement lands,
   * without waiting on a human to type into the room first.
   */
  private async ownerHandleIntro(from: string, requestId: string, roomId: string): Promise<void> {
    const card = this.store.getIncomingByRequestAndPeer(requestId, from);
    if (!card || card.state !== "consented") return;

    this.store.putRoom({
      room_id: roomId,
      request_id: requestId,
      peers: [
        { peer_id: this.cfg.peerId, display: this.cfg.personaName },
        { peer_id: from, display: card.requester_display },
      ],
      context: card.text,
      created_at: this.clock.now().toISOString(),
    });
    logOwner(this.store, this.clock, requestId, "relay_room_intro", `Learned final relay room ${roomId} via INTRO from ${from}.`);

    if (hasRoomMessaging(this.transport)) {
      const announce: RoomMessage = {
        room_id: roomId,
        from: this.cfg.peerId,
        text: `${this.cfg.personaName} joined the conversation.`,
        ts: this.clock.now().toISOString(),
      };
      this.store.addRoomMessage(announce);
      await this.transport.sendRoomMessage(announce);
    }
  }

  private ownerHandleWithdrawn(from: string, requestId: string): void {
    const card = this.store.getIncomingByRequestAndPeer(requestId, from);
    if (!card) return;
    if (card.state === "pending") {
      card.state = "inactive";
      this.store.putIncoming(card);
      logOwner(this.store, this.clock, requestId, "requester_withdrew", "Requester withdrew; consent card marked inactive.");
    }
  }

  // ---------------------------------------------------- Task 5: trust mgmt --

  /**
   * Add/update a trust edge (POST /api/trust). Upsert by `peer`: an existing
   * edge's `created_at` (and thus its default +1y `expires_at`, I9) is
   * preserved across a level change — this is a level/display update, not a
   * fresh relationship. `store.putTrustEdge` is already an upsert.
   */
  async addTrust(input: { peer: string; display: string; level?: TrustLevel; vouched_by?: string }): Promise<TrustEdge> {
    const existing = this.store.getTrustEdge(input.peer);
    const edge = TrustEdgeSchema.parse({
      peer: input.peer,
      display: input.display,
      level: input.level,
      vouched_by: input.vouched_by ?? existing?.vouched_by,
      created_at: existing?.created_at ?? this.clock.now().toISOString(),
    });
    this.store.putTrustEdge(edge);
    this.notifyChange();
    return edge;
  }

  /**
   * Remove a trust edge (DELETE /api/trust) — I5's "downgrade/remove in *my
   * own* trust graph" (D1.5); no notification to the removed peer, no
   * appeals process.
   */
  removeTrust(peer: string): void {
    this.store.removeTrustEdge(peer);
    this.notifyChange();
  }

  // -------------------------------------- Task 4 (D18): inbound CONNECT --

  /**
   * I9 conservative default: a CONNECT body may WISH for a trust level, but the
   * daemon never auto-escalates to one. "friend" is the cap the daemon grants
   * on its own — it can't know the app skin's per-context default, and the
   * origin-node model puts the escalation decision in the human owner's hands
   * (an explicit level passed to `acceptConnect` is their sovereign I4 choice).
   * `contact` (a looser level) is honoured as requested; `close`/absent clamp
   * down to `friend`.
   */
  private clampConnectLevel(requested?: TrustLevel): TrustLevel {
    return requested === "contact" ? "contact" : "friend";
  }

  /**
   * New-peer side: send a CONNECT ("I scanned your code, let me in") to an
   * origin this persona holds no edge to yet, and record an OUTBOUND pending
   * connect card so a later CONNECT_ACK can be correlated by `request_id` and
   * its transport-authenticated sender verified before any reciprocal edge is
   * formed (`handleConnectAck`). The wire `display` is THIS persona's own name
   * (what the origin owner will see, I4); the record's `display` is a
   * placeholder for the origin's name until the ACK reveals it.
   */
  async sendConnect(peer: string, opts: { display?: string; level?: TrustLevel; relay?: string } = {}): Promise<ConnectRecord> {
    const requestId = randomUUID();
    const now = this.clock.now();
    const myDisplay = opts.display ?? this.cfg.personaName;
    const record: ConnectRecord = {
      card_id: randomUUID(),
      request_id: requestId,
      direction: "outbound",
      peer,
      display: peer, // origin's display unknown until CONNECT_ACK; placeholder
      requested_level: opts.level,
      relay: opts.relay,
      state: "pending",
      created_at: now.toISOString(),
    };
    this.store.putConnect(record);
    // Connect is NOT the I2-blind asker flow — the local user legitimately
    // knows the counterparty (they chose it), so the audit names the peer via
    // logOwner (D14's sanctioned "label-of-convenience" for non-resource-flow
    // actions; logAsker would throw on a peer id, sanitize.ts).
    logOwner(this.store, this.clock, requestId, "connect_sent", `Sent CONNECT to origin ${peer} (requesting to be let in).`);
    await this.transport.send(peer, connectEnvelope(requestId, now, { display: myDisplay, relay: opts.relay, level: opts.level }));
    this.notifyChange();
    return this.store.getConnect(record.card_id)!;
  }

  /**
   * Origin/owner side: a CONNECT arrived — the ONE inbound envelope allowed
   * from a peer with no trust edge (everything else stays connected-only).
   * Surfaces an INBOUND pending connect card (I4: requester DID + display); it
   * NEVER auto-creates an edge. Abuse guard: at most one pending inbound card
   * per requester — a repeat CONNECT from the same DID refreshes the existing
   * card (latest request_id/display) rather than piling up new ones.
   */
  private async handleConnect(from: string, env: Extract<Envelope, { type: "CONNECT" }>): Promise<void> {
    this.recordInboundConnect(from, env.request_id, env.body.display, `${env.body.display} wants to connect (they scanned your code)`, env.body.level, env.body.relay);
  }

  /**
   * A VRC from a Keyring-style wallet verified (vrc_di.ts): surface it as the same pending inbound connect card a
   * scanned code produces. The VRC proves "this relationship key signed this", nothing more, so it only ASKS (I4);
   * the edge forms when the owner accepts. A key-only did:peer:0 has no endpoint, so no CONNECT_ACK is sent for it.
   */
  offerVrcConnect(issuerDid: string, display: string): ConnectRecord {
    // I9: a stranger's VRC asks for the lowest level; the owner can raise it on accept
    return this.recordInboundConnect(issuerDid, randomUUID(), display, `${display} sent a Keyring-compatible VRC (self-asserted, no witness)`, "contact");
  }

  private recordInboundConnect(from: string, requestId: string, display: string, what: string, level?: TrustLevel, relay?: string): ConnectRecord {
    const existing = this.store.getConnectByPeer(from, "inbound");
    const dup = existing !== undefined && existing.state === "pending";
    const record: ConnectRecord = {
      card_id: dup ? existing.card_id : randomUUID(),
      request_id: requestId,
      direction: "inbound",
      peer: from,
      display,
      requested_level: level,
      relay,
      state: "pending",
      created_at: existing?.created_at ?? this.clock.now().toISOString(),
    };
    this.store.putConnect(record);
    logOwner(this.store, this.clock, requestId, dup ? "connect_received_dup" : "connect_received", `${what} — peer ${from}. Awaiting owner decision.`);
    this.notifyChange();
    return record;
  }

  /** CONNECT_ACK to the connecting peer; a key-only relationship DID (did:peer:0) has no endpoint to answer to. */
  private async ackConnect(card: ConnectRecord, accepted: boolean): Promise<void> {
    if (card.peer.startsWith("did:peer:0")) return;
    await this.transport.send(card.peer, connectAckEnvelope(card.request_id, this.clock.now(), accepted ? { accepted, display: this.cfg.personaName } : { accepted }));
  }

  /**
   * Owner accepts an inbound connect card: forms a trust edge to the new peer
   * (level = owner's explicit choice, else the clamped requested level; +1y
   * expiry via addTrust, I9) AND sends CONNECT_ACK{accepted:true} back so the
   * new peer can form ITS edge. `await`s the send so a caller (and the test
   * harness) observes both edges once this resolves.
   */
  async acceptConnect(cardId: string, level?: TrustLevel): Promise<void> {
    const card = this.store.getConnect(cardId);
    if (!card) throw new Error(`acceptConnect: unknown card ${cardId}`);
    if (card.direction !== "inbound") throw new Error(`acceptConnect: card ${cardId} is outbound, not an inbound request`);
    if (card.state !== "pending") throw new Error(`acceptConnect: card ${cardId} is not pending (state=${card.state})`);

    const finalLevel = level ?? this.clampConnectLevel(card.requested_level);
    await this.addTrust({ peer: card.peer, display: card.display, level: finalLevel });
    card.state = "accepted";
    this.store.putConnect(card);
    await this.ackConnect(card, true);
    logOwner(
      this.store,
      this.clock,
      card.request_id,
      "connect_accepted",
      `Accepted connect from ${card.display} (${card.peer}) at level ${finalLevel}; trust edge formed, CONNECT_ACK sent.`
    );
    this.notifyChange();
  }

  /**
   * Owner declines an inbound connect card: no edge is formed and a gentle
   * CONNECT_ACK{accepted:false} is returned. Per the origin-node model the
   * owner simply decided; the decline reveals nothing beyond "not accepted"
   * (no reason, no counter-offer) — the new peer is waiting, so a quiet no is
   * kinder than silence, and this is NOT the I3 resource-flow (a connect is
   * not a PASS), so an explicit `accepted:false` is correct here.
   */
  async declineConnect(cardId: string): Promise<void> {
    const card = this.store.getConnect(cardId);
    if (!card) throw new Error(`declineConnect: unknown card ${cardId}`);
    if (card.direction !== "inbound") throw new Error(`declineConnect: card ${cardId} is outbound, not an inbound request`);
    if (card.state !== "pending") throw new Error(`declineConnect: card ${cardId} is not pending (state=${card.state})`);

    card.state = "declined";
    this.store.putConnect(card);
    await this.ackConnect(card, false);
    logOwner(this.store, this.clock, card.request_id, "connect_declined", `Declined connect from ${card.display} (${card.peer}); no edge formed, gentle CONNECT_ACK sent.`);
    this.notifyChange();
  }

  /**
   * New-peer side: a CONNECT_ACK arrived. It is only actioned if it matches an
   * OUTBOUND connect this persona actually sent (correlated by `request_id`)
   * AND its transport-authenticated sender equals that record's target peer —
   * an unsolicited CONNECT_ACK{accepted:true} can never conjure an edge. On
   * accept, forms the reciprocal edge to the origin (display from the ACK,
   * level at this persona's own conservative default per I9). On decline,
   * marks the outbound card declined; nothing else leaks.
   */
  private async handleConnectAck(from: string, env: Extract<Envelope, { type: "CONNECT_ACK" }>): Promise<void> {
    const record = this.store.getConnectByRequest(env.request_id, "outbound");
    if (!record || record.peer !== from || record.state !== "pending") {
      logOwner(this.store, this.clock, env.request_id, "connect_ack_ignored", `Ignored an unsolicited/mismatched CONNECT_ACK from ${from} (no matching pending outbound connect).`);
      return;
    }
    if (env.body.accepted) {
      const display = env.body.display ?? record.display;
      record.display = display;
      record.state = "accepted";
      this.store.putConnect(record);
      await this.addTrust({ peer: from, display, level: this.clampConnectLevel(record.requested_level) });
      logOwner(this.store, this.clock, env.request_id, "connect_ack_accepted", `Origin ${display} (${from}) accepted our connect; formed reciprocal trust edge.`);
    } else {
      record.state = "declined";
      this.store.putConnect(record);
      logOwner(this.store, this.clock, env.request_id, "connect_ack_declined", `Origin ${from} did not accept our connect; no edge formed.`);
    }
    this.notifyChange();
  }

  // ------------------------------------------------------ Task 5: notes --

  /**
   * POST /api/notes — a second-brain item: "I know <owner> has this" without
   * <owner> owning it themselves. Provenance is always `second_brain`. D1.6 /
   * I8: the noted owner is NOT notified now — only pinged at first relay
   * attempt (see listings.ts's `forwardRelay`, reached via the normal
   * REQUEST/consent-card flow once someone asks and this item matches).
   * Mirrors steward.ts's `handleConfirm` item-construction shape.
   */
  addNote(input: { labels: string[]; description: string; tags?: string[]; owner: string; location_area?: string; availability?: string }): Item {
    const item = ItemSchema.parse({
      id: randomUUID(),
      labels: input.labels,
      description: input.description,
      tags: input.tags ?? [],
      provenance: { kind: "second_brain", owner: input.owner, noted_at: this.clock.now().toISOString() },
      policy: ItemSchema.shape.policy.parse({}),
      location_area: input.location_area,
      availability: input.availability,
    });
    this.store.putItem(item);
    this.notifyChange();
    return item;
  }

  // --------------------------------------------------------- D14: listings --

  async publishListing(input: PublishListingInput): Promise<ListingRecord> {
    const record = await publishListing(this.listingsDeps, input);
    this.notifyChange();
    return record;
  }

  async withdrawListing(listingId: string): Promise<void> {
    await withdrawListing(this.listingsDeps, listingId);
    this.notifyChange();
  }

  // ------------------------------------------------------------ D14: loans --

  async requestBorrow(listingId: string, note?: string): Promise<LoanRecord> {
    const record = await requestBorrow(this.listingsDeps, listingId, note);
    this.notifyChange();
    return record;
  }

  async approveLoan(loanId: string): Promise<LoanRecord> {
    const record = await approveLoan(this.listingsDeps, loanId);
    this.notifyChange();
    return record;
  }

  async declineLoan(loanId: string): Promise<LoanRecord> {
    const record = await declineLoan(this.listingsDeps, loanId);
    this.notifyChange();
    return record;
  }

  async markLent(loanId: string): Promise<LoanRecord> {
    const record = await markLent(this.listingsDeps, loanId);
    this.notifyChange();
    return record;
  }

  async markReturned(loanId: string): Promise<LoanRecord> {
    const record = await markReturned(this.listingsDeps, loanId);
    this.notifyChange();
    return record;
  }

  async checkInLoanCompletion(loanId: string, outcome: "complete" | "not_yet", detail?: string): Promise<LoanRecord> {
    const record = await checkInLoanCompletion(this.listingsDeps, loanId, outcome, detail);
    this.notifyChange();
    return record;
  }

  // -------------------------------------------------------------- D14: DMs --

  async sendDm(peer: string, text: string): Promise<void> {
    await sendDm(this.listingsDeps, peer, text);
    this.notifyChange();
  }

  // ------------------------------------------------------------- rooms --

  async postRoomMessage(roomId: string, text: string): Promise<void> {
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error(`postRoomMessage: unknown room ${roomId}`);
    const ts = this.clock.now().toISOString();
    this.store.addRoomMessage({ room_id: roomId, from: this.cfg.peerId, text, ts });
    if (hasRoomMessaging(this.transport)) {
      await this.transport.sendRoomMessage({ room_id: roomId, from: this.cfg.peerId, text, ts });
    }
    this.notifyChange();
  }

  /**
   * I8 (relay room discovery): a message from a sender not yet in this
   * room's local `peers` list means a third party the wire-level lifecycle
   * (REQUEST/STATUS/CONSENT/INTRO) never named to this persona directly has
   * shown up — the relay hub's other leg (see `ownerHandleIntro`'s doc
   * comment). Recording them here is the only in-scope way this daemon can
   * discover that identity, given INTRO's frozen `{room_id}` body and
   * TransportAdapter's lack of a room-membership query.
   */
  private onRoomMessage(msg: RoomMessage): void {
    const room = this.store.getRoom(msg.room_id);
    if (!room) return;
    if (!room.peers.some((p) => p.peer_id === msg.from)) {
      room.peers = [...room.peers, { peer_id: msg.from, display: msg.from }];
      this.store.putRoom(room);
    }
    this.store.addRoomMessage(msg);
    this.notifyChange();
  }

  // ---------------------------------------------------------------- steward --

  async handleSteward(text: string): Promise<string> {
    const stewardDeps: StewardDeps = {
      store: this.store,
      clock: this.clock,
      chatClient: this.deps.chatClient,
      chatModel: this.cfg.matcher.chatModel,
      sendAsk: (t, opts) => this.sendAsk(t, opts),
    };
    this.store.addStewardLog({ role: "user", text, ts: this.clock.now().toISOString() });
    const reply = await classifyAndRespond(text, stewardDeps);
    this.store.addStewardLog({ role: "agent", text: reply, ts: this.clock.now().toISOString() });
    this.notifyChange();
    return reply;
  }

  // -------------------------------------------------------------- routing --

  /**
   * I8: STATUS/CONSENT/INTRO addressed to a downstream relay request_id never
   * reach the normal asker-side handlers (there is no AskRecord for a relay's
   * downstream leg — this persona isn't "asking" in the sendAsk() sense, it's
   * relaying) — they route to the relay handlers instead, keyed by the same
   * request_id the noted owner replies with.
   */
  private async handleEnvelope(from: string, env: Envelope): Promise<void> {
    switch (env.type) {
      case "REQUEST":
        await this.ownerHandleRequest(from, env);
        break;
      case "STATUS": {
        const relay = this.store.getRelayLinkByDownstream(env.request_id);
        if (relay) {
          this.relayHandleStatus(relay, env.body.state);
        } else {
          this.askerHandleStatus(from, env.request_id, env.body.state);
        }
        break;
      }
      case "CONSENT": {
        const relay = this.store.getRelayLinkByDownstream(env.request_id);
        if (relay) {
          await this.relayHandleConsent(relay, env.body.conditions);
        } else {
          this.askerHandleConsent(from, env.request_id, env.body.conditions);
        }
        break;
      }
      case "INTRO": {
        const relay = this.store.getRelayLinkByDownstream(env.request_id);
        if (relay) {
          this.relayHandleIntro(relay);
        } else if (this.store.getAsk(env.request_id)) {
          this.askerHandleIntro(from, env.request_id, env.body.room_id);
        } else {
          // Not this persona's own ask and not a relay link they're the hub
          // for: this is the noted-owner side of a relay (I8) — see
          // `ownerHandleIntro`'s doc comment.
          await this.ownerHandleIntro(from, env.request_id, env.body.room_id);
        }
        break;
      }
      case "WITHDRAWN":
        this.ownerHandleWithdrawn(from, env.request_id);
        break;
      case "LISTING":
        await receiveListing(this.listingsDeps, from, env.body);
        break;
      case "LOAN":
        receiveLoan(this.listingsDeps, from, env.body);
        break;
      case "DM":
        receiveDm(this.listingsDeps, from, env.body.text);
        break;
      case "CONNECT":
        // The ONE inbound envelope accepted from a peer with NO trust edge
        // (origin-node onboarding). Surfaces a consent card; never auto-edges.
        await this.handleConnect(from, env);
        break;
      case "CONNECT_ACK":
        await this.handleConnectAck(from, env);
        break;
    }
    this.notifyChange();
  }
}
