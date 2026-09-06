# @resource-web/central-index

The opt-in central declaration index (handover §0's reading (a)+(c): a hosted rendezvous plus a
retrieval index over declarations the holder deliberately published, coarsened and k-checked).
It never indexes vault, chat, or inventory contents — see the parent handover,
`central-rag_of-web-of-trust_handover.md`, §1 for what is and is not indexed.

## Surface (SHIPPED)

Node `node:http`, no framework, no runtime dependency beyond the workspace `@resource-web/wot-policy`
package. Storage is append-only JSONL under a configurable data directory, with an in-memory facet
index rebuilt from the log on start.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | `{ ok: true, instanceId }` |
| `GET` | `/jurisdiction` | the loaded `JurisdictionConfig`, verbatim |
| `GET` | `/` | serves `publicDir/status.html` if `publicDir` is configured; 404 otherwise |
| `POST` | `/declarations` | publish; requires `holderPubKey` (raw 32-byte Ed25519, base64url); `409` if a structurally single-author facet set is sent without `soleAuthorAck: true` |
| `DELETE` | `/declarations/:id` | withdraw; signed (see below); `204` for any valid signature, idempotent, unknown ids included (no existence leak); `403 { reason }` / `429` otherwise |
| `GET` | `/declarations?authorCommitment=` | the holder's own backtrace list: id, publishedAt, residency |
| `POST` | `/query` | `200` with `{ hits }` above the floor, or the byte-identical no otherwise |
| `POST` | `/clear` | signed (see below); withdraws every declaration for one `authorCommitment` that the signing key published; `204` for any valid signature |

Every response on the table above (JSON API surface) is padded to `CENTRAL_BUDGET_MS` via
`settleAt`, timed from the first line of the request handler. `GET /` is the one exception: it is
static file serving, not the API surface, and padding a human loading a status page buys no
privacy.

### I3 indistinguishable no

Below-floor, declined (malformed `/query` input) and no-match all resolve through one function,
`sendNo()` in `src/server.ts` — the only place `indistinguishableNo()`'s bytes are written to a
response. `Content-Length` is derived from those bytes explicitly; nothing on any of the three
paths is separately serialized. Covered by `test/indistinguishable_no.test.ts`.

### Server-side policy enforcement

`requiresSoleAuthorAck` and `evaluateFloor` are called here, server-side, against the same
`@resource-web/wot-policy` functions the client calls — the server cannot be more permissive than
the device. A `/query` hit never includes `authorCommitment`: returning it would let an asker
cluster hits by author and quietly erode the k-anonymity the floor just enforced.

## Signing scheme (CLOSED 2026-09-06, decision B-20 option A)

This section used to be "Known gap": `DELETE /declarations/:id` and `POST /clear` read and
discarded the request body and acted on the plain `id` / `authorCommitment`, with no check that
the caller was the original publisher. Closed.

- `POST /declarations` now requires `holderPubKey`, a base64url raw 32-byte Ed25519 verification
  key, stored ON the declaration. Required, not optional: a declaration nobody can prove they
  published would be one nobody could ever withdraw.
- `DELETE /declarations/:id` and `POST /clear` require
  `{ payload: {action, target, authorCommitment, nonce, expiresAt}, signature, publicKey }`.
  Canonicalisation and verification are `@resource-web/wot-policy`'s `canonicalActionString` and
  `verifySignedAction`, the same functions the device uses, so the server cannot be more
  permissive than the device.
- Nonces are single-use (`src/nonces.ts`) and expiry is bounded above (two minutes), so a captured
  request is neither replayable nor a bearer token.
- `POST /clear` removes only declarations whose registered `holderPubKey` matches the signing key.
- Withdraw and clear are rate limited per public key (`src/rate_limit.ts`), never per IP and never
  per `authorCommitment` — limiting on a commitment would let a passer-by lock a holder out of
  clearing her own records.
- Unsigned requests get `403 { reason: 'signature-required' }`, out loud.
- Still unsigned, on purpose: `GET /declarations?authorCommitment=`. A leaked commitment can still
  enumerate that holder's declaration ids, timestamps and residency. Tracked in the central
  handover's "Signing scheme" section; do not read this section as "a leaked commitment is now
  worthless".

## Environment (CLI, `src/bin.ts`)

| Var | Default |
|---|---|
| `WOT_CENTRAL_PORT` | `4187` |
| `WOT_CENTRAL_JURISDICTION` | `at` |
| `WOT_CENTRAL_DATA` | `./data` |

## Bind policy

Binds `127.0.0.1` by default. A non-loopback bind is refused unless the instance's jurisdiction
(residency) config sets `"allowPublicBind": true`; both shipped configs keep it `false`.
`WOT_CENTRAL_UNSAFE_BIND=1` is a separate, test-only escape hatch so the refusal itself stays
testable, and is not a deployment option. See `DEPLOY.md` for what an operator still owes before
flipping the flag.

Shuts down cleanly on `SIGINT`/`SIGTERM` (closes all connections, then
the listener, then exits). If `public/status.html` exists next to the built package, it is served
at `GET /` automatically — no separate env var for this, since the file ships with the package.

## Testing

`test/*.test.ts` here covers only what this package owns in isolation: the JSONL store (append,
rebuild, tombstone honouring, `/clear` semantics) and the I3 byte-identical-no invariant over a
real ephemeral-port server this suite starts and stops itself. Full HTTP integration and the
three end-to-end assertions from the handover's §5 (disabled-by-default client path, a live query
round trip, the jurisdiction/status page) live in `test/e2e/**`, owned by a different unit.
