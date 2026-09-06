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
| `POST` | `/declarations` | publish; `409` if a structurally single-author facet set is sent without `soleAuthorAck: true` |
| `DELETE` | `/declarations/:id` | withdraw; always `204`, idempotent, unknown ids included (no existence leak) |
| `GET` | `/declarations?authorCommitment=` | the holder's own backtrace list: id, publishedAt, residency |
| `POST` | `/query` | `200` with `{ hits }` above the floor, or the byte-identical no otherwise |
| `POST` | `/clear` | withdraws every declaration for one `authorCommitment`; always `204` |

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

## Known gap (SPECULATIVE, not this unit's contract)

`DELETE /declarations/:id` and `POST /clear` both take "a signed withdrawal proof" per the
handover's §4 table, but no signing/verification scheme, key material, or DID-recovery package is
part of this build's fixed contracts. Today both endpoints read and discard the request body and
act on the plain `id` / `authorCommitment` supplied — there is no cryptographic check that the
caller is the original publisher. This is a deliberate scope gap, not an oversight: closing it
needs a signature scheme decision that belongs with the DID/crypto packages (`packages/transport`,
`packages/wot-policy`), not with this HTTP surface. Flag before shipping withdrawal/clear to any
untrusted network.

## Environment (CLI, `src/bin.ts`)

| Var | Default |
|---|---|
| `WOT_CENTRAL_PORT` | `4187` |
| `WOT_CENTRAL_JURISDICTION` | `at` |
| `WOT_CENTRAL_DATA` | `./data` |

Binds `127.0.0.1` always. Shuts down cleanly on `SIGINT`/`SIGTERM` (closes all connections, then
the listener, then exits). If `public/status.html` exists next to the built package, it is served
at `GET /` automatically — no separate env var for this, since the file ships with the package.

## Testing

`test/*.test.ts` here covers only what this package owns in isolation: the JSONL store (append,
rebuild, tombstone honouring, `/clear` semantics) and the I3 byte-identical-no invariant over a
real ephemeral-port server this suite starts and stops itself. Full HTTP integration and the
three end-to-end assertions from the handover's §5 (disabled-by-default client path, a live query
round trip, the jurisdiction/status page) live in `test/e2e/**`, owned by a different unit.
