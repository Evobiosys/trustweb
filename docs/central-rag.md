# Central RAG: the opt-in declaration index

This is the surface built under `feat/central-rag`: a hosted, opt-in retrieval index over
declarations a holder deliberately published, coarsened and consent-recorded, plus a
per-jurisdiction hosting shape. It reads (a) and (c) of the feasibility note's three central-RAG
options, never (b). It never computes over vault, chat, or inventory contents.

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
| `POST` | `/declarations` | `{ facets, sealedBody, soleAuthorAck? }` | `201 { id, publishedAt, instanceId, residency }`, or `409 { reason: 'sole-author-ack-required' }` | SHIPPED |
| `DELETE` | `/declarations/:id` | a withdrawal proof | `204`, idempotent (unknown or already-withdrawn ids also return `204`, never `404`, so as not to leak whether an id ever existed) | SHIPPED end to end; the proof is accepted and its bytes are drained, but nothing verifies a signature over it yet, so treat "signed withdrawal proof" as DESIGNED, not enforced |
| `GET` | `/declarations?authorCommitment=` | none | `{ declarations: [{ id, publishedAt, residency }, ...] }`, the holder's own backtrace list | SHIPPED |
| `POST` | `/query` | `{ facets, askerDid?, askerLabel? }` | `200`, either `{ hits: [...] }` above the floor or the byte-identical no | SHIPPED |
| `POST` | `/clear` | `{ authorCommitment }` | `204`, withdraws every declaration of that holder | SHIPPED end to end; same caveat as `DELETE /declarations/:id`: the "signed proof" is a plain field the server accepts as-is, with no signature check |

## The floor, the sole-author rule, and the indistinguishable no

`@resource-web/wot-policy` is the one implementation of the anonymity floor and asker
protection, imported identically by the client and the server, so the server can never be more
permissive than the device. `evaluateFloor` counts distinct `authorCommitment` values, not
records, against `K_FLOOR_DEFAULT` (7). `requiresSoleAuthorAck` refuses a publish whose
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
- DESIGNED: signature verification on the withdrawal proof (`DELETE /declarations/:id`) and the
  clear proof (`POST /clear`). The API sketch in the handover calls both a "signed proof", and
  the server accepts a body shaped that way, but nothing in `server.ts` verifies a signature over
  either one today: a withdrawal or a clear currently succeeds for any caller who can name the
  right id or `authorCommitment`, with no proof of holdership checked. This is a real gap between
  the spec and the shipped code, not a design choice, and should be treated as open rather than
  quietly assumed closed. Also DESIGNED: wiring the opt-in panel into the demo UI itself.
- SPECULATIVE: the 3-of-5 secret-sharing threshold for metadata residency (B-15, threat model
  unruled); the Mode 1 hosted vault backup (D-11, deferred) and any computation over it, which
  remains forbidden by the ruling at the top of this document regardless of how Mode 1 itself
  eventually gets built.

## Beta notice

Every central-mode surface (the status page, and any client panel that gets wired in) must carry
a "use at your own risk, beta" notice, per the 2026-09-01 demo debrief. The status page carries
it today; SHIPPED there. A client-side panel does not exist yet, so the notice cannot yet appear
there. DESIGNED, pending the panel itself.
