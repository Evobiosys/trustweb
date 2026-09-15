# Central RAG: the opt-in declaration index

This is the surface built under `feat/central-rag`: a hosted, opt-in retrieval index over
declarations a holder deliberately published, coarsened and consent-recorded, plus a
per-jurisdiction hosting shape. It reads (a) and (c) of the feasibility note's three central-RAG
options, never (b). It never computes over vault, chat, or inventory contents.

## Signed withdraw and clear, and the bind policy (read this before deploying anything)

Superseded 2026-09-06 (decision B-20, option A). This section previously read "loopback only,
and why": withdraw and clear acted on a plain id or `authorCommitment` with no proof of
holdership, and an `authorCommitment` is a deterministic hash rather than a secret, so on a
reachable network anyone who had ever seen one could wipe that holder's declarations. That is
closed.

`DELETE /declarations/:id` and `POST /clear` now require an Ed25519 signature over the canonical
message `{action, target, authorCommitment, nonce, expiresAt}`, verified server-side against the
public key the holder registered WITH the declaration at publish time. Nonces are single-use,
expiry is short (two minutes maximum, one minute in practice), a clear removes only declarations
whose registered key matches the key that signed, and unsigned requests are refused
`403 { reason: 'signature-required' }` out loud rather than silently doing nothing. The
canonicalisation and the verify live in `@resource-web/wot-policy`, shared with the device; the
nonce registry and the per-key rate limiter are server state in `packages/central-index`.

Bind policy, three separate gates:

1. loopback (`127.0.0.1`, `localhost`, `::1`) is always allowed, and stays the default;
2. `WOT_CENTRAL_UNSAFE_BIND=1` is a test-only escape hatch, unchanged, never a deployment option;
3. `"allowPublicBind": true` in the jurisdiction (residency) config is the supported route to a
   reachable instance.

Anything else still refuses to start. Both shipped configs (`at.json`, `eu.json`) keep
`allowPublicBind: false`, so an instance becomes reachable because an operator wrote it down,
never by accident. Pinned by `test/loopback_only.test.ts`.

What a reachable instance still needs, and this file does not provide: TLS terminated at the
jurisdiction host (the existing Caddy pattern), and the operational decisions in `DEPLOY.md`.

## Two stores, two rulings

The Web of Trust project has two server-side stores that must never be confused with one
another, because they carry opposite rulings.

| Store | What it holds | Does it compute over content? | Status |
|---|---|---|---|
| Mode 1 hosted vault backup | Ciphertext of the holder's vault | Never. Stores and relays only. | SPECULATIVE (out of scope for this build, deferred as D-11) |
| Declaration index (this build) | Coarsened, holder-published records | Yes, retrieval over those published records only | SHIPPED |

The declaration index computes: it matches facets, counts distinct authors against the
anonymity floor, and returns hits. The vault backup, wherever it eventually gets built, must
never compute: it holds ciphertext the operator cannot read and only stores and relays it. A
future change that lets the vault backup path do lookups, indexing, or matching over vault
content would invert this ruling and must not happen without a fresh decision, stated as such.

## What is indexed, and what never leaves the device

Indexed centrally: a `PublishedDeclaration`, meaning `category`, `regionCode`, an
`authorCommitment` (a salted hash of the holder DID, equality-comparable, not reversible), a
`sensitive` flag, and a `sealedBody` the server stores and returns but never decodes.

Never leaves the device: the vault, chat threads, inventory item text, contact lists, the
holder's own notes, message authors, and any free text the holder did not explicitly type into
the publish form. A street address is never a `regionCode`.

## API surface

All JSON, `Content-Type: application/json`. Every JSON response is padded to
`CENTRAL_BUDGET_MS` (900ms) before it is written, so a fast decline and a slow lookup take the
same wall-clock time. `GET /` (the static status page) is the one exception: it is not part of
this JSON table, and padding a human loading a status page buys no privacy.

| Method | Path | Body | Response | Status |
|---|---|---|---|---|
| `GET` | `/health` | none | `{ ok: true, instanceId }` | SHIPPED |
| `GET` | `/jurisdiction` | none | the jurisdiction config, verbatim | SHIPPED |
| `POST` | `/declarations` | `{ facets, sealedBody, holderPubKey, soleAuthorAck? }` | `201 { id, publishedAt, instanceId, residency }`, `409 { reason: 'sole-author-ack-required' }`, or `400 { reason: 'malformed-request' }` when `holderPubKey` is missing or is not a raw 32-byte Ed25519 key | SHIPPED. `holderPubKey` is REQUIRED: a declaration nobody can prove they published could never be withdrawn |
| `DELETE` | `/declarations/:id` | `{ payload: {action:'withdraw', target:<id>, authorCommitment, nonce, expiresAt}, signature, publicKey }` | `204` for any valid signature, idempotent (an unknown id, an already-withdrawn id and another holder's id all return `204`, never `404`, so as not to leak whether an id ever existed); `403 { reason }` for an unsigned, malformed, expired, replayed or wrong-key request; `429 { reason: 'rate-limited' }` past the per-key limit | SHIPPED, signature enforced |
| `GET` | `/declarations?authorCommitment=` | none | `{ declarations: [{ id, publishedAt, residency }, ...] }`, the holder's own backtrace list | SHIPPED, and deliberately NOT signature-gated: a leaked `authorCommitment` still enumerates that holder's declaration ids, timestamps and residency here. See the threat notes in the central handover's "Signing scheme" section |
| `POST` | `/query` | `{ facets, askerDid?, askerLabel? }` | `200`, either `{ hits: [...] }` above the floor or the byte-identical no | SHIPPED |
| `POST` | `/clear` | `{ payload: {action:'clear', target:'all', authorCommitment, nonce, expiresAt}, signature, publicKey }` | `204`, withdraws every declaration of that holder THAT THIS KEY PUBLISHED; same `403`/`429` refusals as withdraw | SHIPPED, signature enforced. The `authorCommitment` is read from the signed payload only, never from a top-level field |

## The floor, the sole-author rule, and the indistinguishable no

`@resource-web/wot-policy` is the one implementation of the anonymity floor and asker
protection, imported identically by the client and the server, so the server can never be more
permissive than the device -- it cannot silently accept a lower floor than the device would.
That is not the same as the two floors being equal: the server enforces its own `CENTRAL_K_FLOOR`
(7), deliberately stricter than the device's own k1 floor, `DEFAULT_K` (3, in
`packages/network-access/src/anonymity.ts`) -- see `docs/k-parameters.md`'s k4 section for the
full accounting and the open question of whether that gap stays. `evaluateFloor` counts distinct
`authorCommitment` values, not records, against `CENTRAL_K_FLOOR` (7). `requiresSoleAuthorAck` refuses a publish whose
`(category, regionCode)` pair can structurally only ever have one author, unless the holder set
`soleAuthorAck: true`. All SHIPPED.

`indistinguishableNo()` is the single byte sequence returned, verbatim, for a below-floor query,
a declined (malformed) query, and a genuine no-match query alike, always with HTTP `200`, never
`404`. `settleAt` pads every response to the same budget so the three cases cannot be told apart
by response time either. Both are SHIPPED and covered end to end in
`packages/central-index/test/e2e/`.

## Jurisdiction hosting

One JSON config per jurisdiction (`packages/central-index/jurisdictions/at.json`, `eu.json`)
declares `instanceId`, `residency` (`AT` or `EU`), `operatorContact`, `lawfulBasis`, and
`retentionDays`. `loadJurisdiction` reads `WOT_CENTRAL_JURISDICTION`, defaulting to `at`. The
server serves the config verbatim at `GET /jurisdiction` and renders it, with the beta notice, on
its own status page. `AT` is the stated default residency. SHIPPED.

The 3-of-5 secret-sharing threshold for metadata residency (B-15) is not built. Only a config
placeholder exists. SPECULATIVE: the threat model behind it is unruled, and no threshold scheme
runs anywhere in this code.

## Client opt-in adapter

`apps/demo/src/central/mode.ts` reads `VITE_WOT_CENTRAL` with a fall-through to `'off'` for
anything other than the exact string `'on'`. Every exported entry point in
`apps/demo/src/central/client.ts` checks this first and returns `{ kind: 'disabled' }` without
touching the network when the mode is off. A publish is refused client-side,
`{ kind: 'refused', reason: 'residency-not-allowed' }`, when the target instance's residency is
outside the client's allowlist (default `['AT', 'EU']`). `coarsen.ts` turns a local match into
`DeclarationFacets` plus a sealed body, dropping every field this document's "never leaves the
device" list names. SHIPPED as a library; wiring a panel into the demo UI itself is a follow-up,
named in the handover as the fallback if the panel belongs in the demo rather than on the
instance status page. That wiring is DESIGNED, not built.

## Honest labelling (I7)

- SHIPPED: all seven `/declarations`, `/query`, `/clear`, `/jurisdiction`, `/health` endpoints;
  the append-only JSONL store with tombstone-based withdrawal and rebuild-on-start; the k-floor
  and sole-author-ack checks; `indistinguishableNo` plus `settleAt` timing padding on every JSON
  response; the two jurisdiction configs and the status page; the client adapter's off-by-default
  behaviour and residency allowlist gate; the end-to-end test suite in
  `packages/central-index/test/e2e/`.
- SHIPPED since 2026-09-06 (B-20 option A): Ed25519 signature verification on
  `DELETE /declarations/:id` and `POST /clear`, publish-time registration of the holder's
  verification key, single-use nonces, bounded expiry, key-scoped clear, per-key rate limiting,
  and the residency-config route to a non-loopback bind. The device half is
  `apps/demo/src/central/signing.ts`; `apps/demo/test/central_backtrace_clear_e2e.test.ts` walks
  the debrief's backtrace-and-clear path against the shipped `src/bin.ts` over real HTTP.
- DESIGNED, still open: signing the backtrace READ (`GET /declarations?authorCommitment=`), and
  wiring the opt-in panel into the demo UI itself.
- SPECULATIVE: the 3-of-5 secret-sharing threshold for metadata residency (B-15, threat model
  unruled); the Mode 1 hosted vault backup (D-11, deferred) and any computation over it, which
  remains forbidden by the ruling at the top of this document regardless of how Mode 1 itself
  eventually gets built.

## Beta notice

Every central-mode surface (the status page, and any client panel that gets wired in) must carry
a "use at your own risk, beta" notice, per the 2026-09-01 demo debrief. The status page carries
it today; SHIPPED there. A client-side panel does not exist yet, so the notice cannot yet appear
there. DESIGNED, pending the panel itself.
