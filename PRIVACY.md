# PRIVACY.md — the privacy ladder

v0 is **honestly labeled NOT zero-knowledge** (invariant I7). Its protection is *protocol-shaped*, not cryptographic. This file states exactly who can learn what, and what each next rung fixes. **The next version commits to climbing to zero knowledge** (rungs 1–2); cryptography review is owned by Markus (DECISIONS.md D1.3, D2).

## Rung 0 — this sprint (implemented)

Mechanism: unlinkability by protocol — uniform STATUS schedule (default 30 s, no jitter), indistinguishable PASS (declined vs no-match byte-identical), E2EE-capable agent DMs, UI-enforced asker blindness, consent-gated identity.

| Party | Learns |
|---|---|
| Asker (human, via UI/API) | Request status + anonymous aggregate only; owner identity only post-consent |
| Asker's own agent process | Technically sees which peer sent PENDING (UI hides it; logs redact it) — **residual** |
| Queried peers' devices | The request text itself — necessary for local matching — **residual** |
| Owner | Asker identity + request text (deliberate, I4 — consent requires context) |
| Homeserver admin | Metadata: who talks to whom, when. Not payloads if E2EE is on — **residual** (Matrix only; see below) |
| Network observer | Traffic patterns between homeservers/devices — **residual** |

### Transport-metadata note — OpenVTC / DIDComm pillar (Task 11, D12)

The primary transport is the **peer-to-peer OpenVTC pillar**
(`DidCommTransport`). Messages are sign-then-encrypted and the wire is opaque:
the payload is never in cleartext and the sender DID is **not** in the
cleartext wire (it rides inside the authenticated ciphertext), so even an
observer of a single message body cannot read it or attribute who sent it.
Payload confidentiality + sender-authenticity are cryptographic here (X25519
ECDH-ES + XChaCha20-Poly1305 + Ed25519).

**Delivery involves a mediator (honest correction).** Earlier drafts of this
note claimed there is *"no mediator"* and *"no third party sees who talks to
whom"*. That is **no longer accurate** and has been removed. The alpha delivers
over a **ladder**: it first tries a **trust-graph relay/mediator** (a
store-and-forward node a trusted friend runs, so an *offline* recipient still
receives mail — this is delivery rung 0), and falls back to a **direct POST**
to the recipient's own `http://host:port/didcomm` endpoint (resolved locally
from their `did:peer:2`) only if the relay rung fails.

| Party | Learns |
|---|---|
| **Relay/mediator** (when the relay rung is used) | **Metadata only:** the recipient DID (the outer wire's cleartext routing header), the submitter's network address, and message timing. **Never the payload** (it never decrypts — reads only the outer `to`), and **never a `from`** on the outer wire, so it cannot attribute the sender. A single submit's ingress response is a uniform `accepted` and reveals no presence; a residual, expensive presence signal remains only at the queue-cap boundary (a full-queue rejection differs from `accepted`, costing an attacker ~1000 queued messages for one noisy bit) — **residual: metadata + a costly cap-boundary presence bit** |
| **Direct POST** (fallback rung) | No third party — sender contacts the recipient's endpoint host directly — **residual: a network observer still sees two IPs exchange traffic** (no onion routing / mixnet in alpha) |

The **honesty caveat** remains that this is DIDComm-v2-*shaped*, not
RFC-interoperable, and VRC trust edges are **self-asserted pairwise** (no
witness) — see `docs/TRANSPORT.md §10.5`. Matrix stays available as a fallback
transport and carries the homeserver-metadata residual it always did.

> **Not the same as the "semantic relay."** This transport-layer
> relay/mediator only *forwards opaque wires* for delivery. It is a **different
> thing** from the application-layer **second-brain "semantic relay"** (I8,
> README, D1.5/D1.6 below) — a *consented two-hop of resource knowledge*
> between people. Do not conflate the two.

### v0.1 alpha surfaces — listings, loans, DMs (who learns what)

The alpha (D17) adds owner-*published* surfaces on top of the ask/consent core. They keep the rung-0 posture:

| Surface | Who learns what |
|---|---|
| **Listing (offer/gathering)** | Owner-published to *tier-eligible* trust edges only. `private` is never sent (local-only); `close` reaches only `close`-level edges; `trusted` reaches `friend`/`close`; `wot_commons`/`public` reach every edge. A withdrawal re-propagates to flip the receiver's copy `withdrawn`. |
| **Guest view (`GET /api/listings?public=1`)** | `public`-tier active listings only, with `where_gated` **stripped server-side** (absent from the JSON, not merely `undefined`); a guest gets `where_public` only. `wot_commons` is *not* guest-visible. |
| **Loan (borrow lifecycle)** | Connected-only (a trust edge is required). Only the coarse state (`requested…complete`) crosses the wire; a "not yet" check-in note is a local-only annotation, never sent. |
| **DM thread** | Connected-only on both send and receive (`sendDm`/`receiveDm` require a trust edge — defense in depth). |

**No-auth caveat (alpha only):** `pnpm alpha` binds every daemon to `0.0.0.0` with **no authentication by default** — anyone on the same WiFi who can reach `http://<ip>:410N` can call the REST API directly, and `?public=1`'s strip is *client-cooperation only* (no auth boundary enforces it). This is a deliberate closed-room opt-in; see [ALPHA.md](ALPHA.md)'s security box, including the opt-in bearer-token/CORS-allowlist env vars added 2026-09-06. It does not change the protocol-level residuals above.

## Rung 1 — next version [S1 spike exists behind a feature flag, if built]

Anonymous aggregate via **secure aggregation** (peers exchange additive masks; the asker learns only "≥ 1") and/or **PSI-CA** (private set intersection cardinality — [OpenMined/PSI](https://github.com/OpenMined/PSI), ECDH + Bloom filters). Fixes: the asker — even reading their own agent's raw logs — provably learns only the count.

## Rung 2 — research target (Anton's crew / Markus)

**Private matching:** peers learn the query only on match (OPRF/PSI over canonical tags — [mpc4j](https://github.com/alibaba-edu/mpc4j), [volepsi](https://github.com/Visa-Research/volepsi)); ZK predicates for coarse area claims. Fixes: non-matching peers learn nothing about the request. Transport metadata: DIDComm/P2P reduces homeserver visibility.

## Second-brain notes (I8, D1.5/D1.6)

Notes about *other people's* resources live only on the note-taker's device. The noted person is **not** notified that a note exists (individual agency — the same as human memory). They **are** consent-pinged before the knowledge is relayed to anyone else — at first relay attempt — and may attach conditions for giving the item out. No hop reveals more than a direct request would. Exclusion stays individual: downgrading a peer edits *my* trust graph, needs no appeals process, and sends no notification.
