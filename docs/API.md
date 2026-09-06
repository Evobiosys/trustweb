# Agent-daemon ↔ Device-UI contract (v0.1, frozen by integrator at M1→M2 boundary)

The UI is a thin client of **its own agent only** (localhost REST + WS). It never talks Matrix.
Asker-facing surfaces obey **I2**: no per-peer identity, inventory, or per-peer response state pre-consent.

Base URL: `http://localhost:<AGENT_PORT>` (anna 4101, ben 4102, timo 4103). WS at `/ws`.

## REST

### GET /api/state → 200
```jsonc
{
  "persona": { "name": "Anna", "peer_id": "@anna-agent:wot.local", "accent": "warm" },
  "items": [ Item ],                       // full items incl. provenance + policy (owner's own view)
  "trust_edges": [ TrustEdge ],
  "asks": [ {                              // requests I sent (asker side — SANITIZED, I2)
    "request_id": "…", "text": "…", "created_at": iso,
    "state": "open" | "waiting" | "someone_can_help" | "no_one_this_time" | "room_open" | "withdrawn",
    "queried_count": 1,                    // aggregate only — never which peers, never per-peer state
    "room_id": "…?"                        // only post-consent
  } ],
  "consent_cards": [ {                     // requests others sent me (owner side — full context, I4)
    "card_id": "…", "request_id": "…",
    "requester": { "peer_id": "…", "display": "Anna" },
    "text": "Hat wer einen Akkuschrauber?",
    "matched_item": Item,
    "kind": "direct" | "relay",            // relay = second_brain match, consent to forward (I8)
    "state": "pending" | "consented" | "declined" | "inactive",   // inactive after WITHDRAWN
    "created_at": iso
  } ],
  "connect_cards": [ {                     // D18: consent-gated CONNECT handshakes (both directions)
    "card_id": "…",
    "direction": "inbound" | "outbound",   // inbound = a new peer wants in (owner decides); outbound = a CONNECT I sent
    "peer": { "peer_id": "…", "display": "Anna" },   // the counterparty (I4 owner-side; the origin I chose new-peer-side)
    "requested_level": "contact" | "friend" | "close" | undefined,  // the level the CONNECT wished for (advisory only)
    "state": "pending" | "accepted" | "declined",
    "created_at": iso
  } ],
  "rooms": [ { "room_id": "…", "peers": [{peer_id, display}], "messages": [{from, text, ts}], "context": "…" } ],
  "steward_log": [ { "role": "user" | "agent", "text": "…", "ts": iso } ]
}
```

### POST /api/steward `{ "text": string }` → `{ "reply": string }`
Natural-language entry point. The daemon classifies intent:
- inventory capture ("I have a Bosch cordless screwdriver…") → replies with a structured proposal and stores it **only after** a confirming follow-up ("yes"/"ja") — confirm-before-save;
- ask ("Hat wer …?") → fans out REQUEST, replies "Asked N trusted people nearby. You'll hear back.";
- anything else → helpful steward reply.
State changes also arrive via WS.

### POST /api/consent `{ "card_id": string, "conditions"?: string }` → `{ "ok": true }`
### POST /api/decline `{ "card_id": string }` → `{ "ok": true }`   (wire-indistinguishable from no-match, I3)
### POST /api/withdraw `{ "request_id": string, "reason"?: "fulfilled" | "cancelled" }` → `{ "ok": true }`
### POST /api/rooms/:room_id/message `{ "text": string }` → `{ "ok": true }`
### GET /api/audit → `{ "entries": [ { ts, decision, detail } ] }`  (human-readable, I6)

Errors: 4xx `{ "error": string }`. CORS (`Access-Control-Allow-Origin: *`, `-Headers: content-type`,
`-Methods: GET,POST,DELETE,OPTIONS`) is set on **every** response including 4xx/5xx; `OPTIONS` on any
path returns `204` with no body. Bind host defaults to `127.0.0.1`; set `API_HOST=0.0.0.0` (or a LAN IP)
to opt into LAN exposure (Task 5/8's alpha-test mode) — **there is no auth by default**, so this is a
deliberate, explicit opt-in, never the default.

**Opt-in auth + CORS allowlist (Finding 4, 2026-09-06 UH-findings handover, docs/k-parameters.md's
sibling security note):** two env vars, both read once at `startServer` startup, both unset by
default so every existing demo/deployment is byte-identical unless an operator opts in.
- `AGENT_DAEMON_AUTH_TOKEN` — when set, every request except the `OPTIONS` preflight must carry
  `Authorization: Bearer <token>` matching exactly, or the daemon returns `401` (still with the
  correct CORS headers, so a browser can read the rejection body). A preflight never carries
  `Authorization` by construction, so it is never gated on this.
- `AGENT_DAEMON_CORS_ALLOWED_ORIGINS` — `"localhost"` allows only `http(s)://localhost[:port]` and
  `http(s)://127.0.0.1[:port]`; a comma-separated origin list (or `"*"`, the default) allows exactly
  those origins (or the wildcard). A disallowed origin gets a response with no
  `Access-Control-Allow-Origin` header at all, which browsers block. If restricting this by default
  would break a deployment whose demo UI runs from a non-localhost origin against a local/LAN daemon
  (e.g. a browser page served from an https origin calling a `127.0.0.1`/LAN-IP daemon), this stays
  strictly opt-in for exactly that reason.

Both extras are also settable programmatically via `ServerExtras.authToken` / `.corsAllowedOrigins` in
`packages/agent-daemon/src/api/server.ts` for embedding contexts (tests, `scripts/alpha_server.ts`)
that do not want to go through process env.

### Task 5 — trust management

#### GET /api/trust → `{ "trust_edges": [ TrustEdge ] }`
#### POST /api/trust `{ "peer": string, "display": string, "level"?: "contact"|"friend"|"close", "vouched_by"?: string }` → `{ "trust_edge": TrustEdge }`
Upsert by `peer`. Adding a new peer creates the edge (`created_at` = now, `expires_at` defaults +1y,
I9); posting again for an existing peer updates `display`/`level`/`vouched_by` **in place** —
`created_at` (and therefore the default expiry) is preserved, not reset. `400` on missing
`peer`/`display` or an invalid `level`.
#### DELETE /api/trust `?peer=<peer_id>` (or JSON body `{ "peer": string }`) → `{ "ok": true }`
Removes the edge from *this persona's own* trust graph only (D1 §5: individual-scale exclusion, no
notification to the removed peer, no appeals process). `400` if `peer` is missing.

### Task 4 (D18) — consent-gated inbound CONNECT (origin-node onboarding)

A brand-new self-sovereign peer (a browser that generated its own DID, holding **no** prior trust edge)
sends a `CONNECT` envelope to an origin it scanned — the ONE inbound envelope the daemon accepts from an
edge-less peer. The origin daemon surfaces a **pending inbound connect card** in `/api/state`'s
`connect_cards[]` (I4: requester DID + display) and forms **no** edge until the OWNER decides. On accept,
a reciprocal trust edge is formed on **both** sides and a `CONNECT_ACK` is returned. These endpoints are
distinct from Task 8's `POST /api/connect` (that is the QR direct-trust-add; these gate an inbound
request).

#### POST /api/connect/accept `{ "card_id": string, "level"?: "contact"|"friend"|"close" }` → `{ "ok": true }`
Forms a `TrustEdge` to the new peer and sends `CONNECT_ACK{accepted:true, display}`. `level` is the
owner's **explicit** sovereign choice (I4); omitted, the daemon uses the CONNECT's requested level
clamped conservatively (`contact`→`contact`, else `friend` — never auto-escalates to `close`, I9).
`expires_at` defaults +1y (I9). `400` on missing `card_id`, invalid `level`, or a card that is not a
pending inbound request.

#### POST /api/connect/decline `{ "card_id": string }` → `{ "ok": true }`
Forms no edge and returns `CONNECT_ACK{accepted:false}` — a gentle, minimal "not accepted" that reveals
nothing further (origin-node model: the owner simply decided). `400` on missing `card_id` or a
non-pending/outbound card.

### Task 5 — second-brain notes

#### POST /api/notes `{ "labels": string[], "description": string, "tags"?: string[], "owner": string, "location_area"?: string, "availability"?: string }` → `{ "item_id": string }`
Creates an `Item` with `provenance: { kind: "second_brain", owner, noted_at }` — "I know `owner` has
this," without `owner` owning it themselves. **Sends nothing over the wire** (D1.6/I8): the noted
owner is *not* notified that the note exists; they are pinged only at first relay attempt, via the
normal REQUEST→consent-card→relay flow once someone else's ask matches this item (see
`daemon/listings.ts`'s `forwardRelay`). `400` on missing `labels`/`description`/`owner`.

### Task 5 — listings (offers/gatherings)

#### GET /api/listings → `{ "mine": [ Listing ], "received": [ ReceivedListing ] }`
Authenticated owner view — full records (incl. `where_gated`) for everything this persona published
or received. Add `?public=1` for the **guest/unauthenticated view**:
`{ "mine": [ GuestListing ], "received": [] }` where `GuestListing` is `mine`'s **`tier: "public"`,
`state: "active"` listings only**, with `where_gated` entirely absent from the object (not merely
`undefined`) — guests get `where_public` only. `wot_commons`-tier listings reach every trust edge at
the daemon layer but are **not** guest-visible; only `public` is (schemas.ts's tier semantics).
```jsonc
// Listing (mine) / ReceivedListing (received, adds via/from_peer/received_at)
{ "listing_id": "…", "kind": "offer" | "gathering", "title": "…", "description": "…",
  "when"?: "…", "where_public"?: "…", "where_gated"?: "…",
  "tier": "private" | "close" | "trusted" | "wot_commons" | "public", "steps": 1 | 2 | 3,
  "state": "active" | "withdrawn", "owner_display": "…", "created_at": iso }
```
#### POST /api/listings `{ "kind": "offer"|"gathering", "title": string, "description": string, "when"?: string, "where_public"?: string, "where_gated"?: string, "tier": ListingTier, "steps"?: 1|2|3 }` → `{ "listing_id": string }`
Publishes and broadcasts to eligible trust edges by tier (see `daemon/listings.ts`). WS: `listing`.
#### POST /api/listings/:id/withdraw → `{ "ok": true }`
Flips state to `withdrawn` and re-propagates. `400` on an unknown `listing_id`. WS: `listing`.

### Task 5 — loans (borrow lifecycle)

#### POST /api/borrow `{ "listing_id": string, "note"?: string }` → `{ "loan_id": string }`
Borrows a *received* listing (alpha: direct connections only — a forwarded/via-chain listing 400s).
WS: `loan`.
#### POST /api/loans/:loan_id `{ "state": "approved"|"declined"|"lent"|"returned"|"complete"|"not_yet", "note"?: string }` → `{ "ok": true }`
Owner-side: `approved`/`declined` (from `requested`), `lent` (from `approved`). Borrower-side:
`returned` (from `lent`). Either side: `complete`/`not_yet` completion check-in (from `returned`, or
re-entrant from `complete`/`not_yet` — see `checkInLoanCompletion`'s doc comment). `note` for
`complete`/`not_yet` is the local-only "not yet" explanation (mockup RES-5) — **never placed on the
wire** for either outcome. `400` on an invalid `state` or an illegal transition. WS: `loan`.

### Task 5 — DM threads

#### GET /api/threads → `{ "threads": [ { "peer_id": string, "display": string, "messages": [ { "from": string, "text": string, "ts": iso } ] } ] }`
`from` is `"self"` for outgoing messages, the peer's id for incoming — distinct from `/api/state`'s
`threads` view, which keeps its original `{direction, text, ts}` shape unchanged.
#### POST /api/threads/:peer_id/message `{ "text": string }` → `{ "ok": true }`
Connected peers only (any trust level) — `400` if there is no trust edge to `peer_id`. WS: `dm`.

### Task 5 — meet card

#### GET /api/card → `{ "peer_id": string, "display": string, "level_offer_default": "friend", "did"?: string, "endpoint"?: string, "relay_url"?: string }`
The "my QR card" payload. `level_offer_default` is a UI hint only (I9's conservative default), not
persisted. `did`/`endpoint` are present only when `TRANSPORT=didcomm` (Task 11's `getCardPayload`).
`relay_url` (Task 5) is the HTTP base **origin** of the trust-graph mediator (Task 10) this daemon's
`RelayChannel` targets — a daemonless browser peer scanning this card's connect URL uses it as its
`createRelayClient({ relayUrl })` base (appends `/relay/send` + `/relay/drain`). Present only when the
boot layer wires a mediator (`scripts/alpha_server.ts`); absent for mock/matrix.

## WS `/ws`
Server → client JSON events, each `{ "type": …, …payload }`:
`state_changed` (no payload — client refetches /api/state) · `steward_reply { text }` · `consent_card { card_id }` · `ask_update { request_id, state }` · `room_message { room_id, from, text, ts }` ·
`listing { listing_id }` · `loan { loan_id }` · `dm { peer_id }`.
`state_changed` is the only event the UI strictly needs; the rest are hints. (D18 connect cards
surface via `state_changed` + `connect_cards[]` — the same way resource consent cards do; the
`consent_card` hint is declared but not currently broadcast for any card kind.)

## Daemon config (per persona)
Env: `PERSONA_NAME`, `PEER_ID`, `AGENT_PORT`, `DB_PATH`, `TRUSTED_PEERS_PATH`, `FIXTURES_PATH?`,
`MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN` or (`MATRIX_REGISTRATION_SECRET` + auto-provision),
`OLLAMA_URL`, `CHAT_MODEL`, `EMBED_MODEL`, `STATUS_DELAY_MS` (default 30000 — uniform, no jitter, I3),
`TRANSPORT` = `matrix` | `mock` | `didcomm`, `API_HOST` (Task 5, default `127.0.0.1` — LAN exposure is
opt-in only), `AGENT_DAEMON_AUTH_TOKEN?` (Finding 4, opt-in bearer-token auth), `AGENT_DAEMON_CORS_ALLOWED_ORIGINS?`
(Finding 4, opt-in CORS allowlist — `"localhost"` or a comma-separated origin list; unset/`"*"` keeps
the wildcard default).
