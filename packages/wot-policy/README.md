# @resource-web/wot-policy

The single source of truth for the central-RAG anonymity floor and asker
protection. The central-index server (`packages/central-index`) and the
client opt-in adapter (`apps/demo/src/central`) both import this package, so
the server can never be more permissive than the device.

Zero runtime dependencies. Node stdlib and Web Crypto only. Zero imports from
`apps/demo` — `CENTRAL_K_FLOOR` is this package's own constant and is not
wired to the demo's `kThreshold` scaffolding.

## Exports

- `CENTRAL_K_FLOOR` — `7`, this package's own anonymity-floor default.
- `DeclarationFacets` — the coarse, holder-approved facets a published
  declaration is indexed under (`category`, `regionCode`, `authorCommitment`,
  `sensitive`).
- `FloorInput`, `FloorVerdict` — input/output shapes for `evaluateFloor`.
- `evaluateFloor(input)` — counts **distinct** `authorCommitment` values among
  `input.candidates`, never records, and compares the count against
  `input.kFloor ?? CENTRAL_K_FLOOR`.
- `requiresSoleAuthorAck(facets, corpus)` — the D27/F-07 single-author rule.
  True when the `(category, regionCode)` facet pair can structurally only
  ever have come from one author (at most one distinct `authorCommitment`
  across `facets` plus every corpus record sharing that pair). A higher
  `kFloor` does not fix this — it is a structural defect in the declaration
  itself, and publishing it requires explicit `soleAuthorAck: true`.
- `protectAsker(payload, sensitive)` — strips `askerDid` and `askerLabel`
  from `payload` when `sensitive` is true; returns an equal-shaped copy
  otherwise. Never mutates the input.
- `indistinguishableNo()` — the one and only response body (`Uint8Array`) for
  below-k, declined and no-match alike (I3). Byte-identical every call, a
  fresh copy each time so a caller may transfer the buffer.
- `settleAt(t0, budgetMs)` — resolves no earlier than `t0 + budgetMs`,
  regardless of how much or little work happened in between (I3 timing
  half). Matches the house style of `apps/demo/src/gate.ts`'s `settleAt`,
  restated here rather than imported.
- `CENTRAL_BUDGET_MS` — `900`, the default response budget for every
  central-index endpoint.

## Why the floor counts authors, not records

Counting records does not anonymise anyone: seven records from one holder
clear a floor of seven, and every one of them traces back to her. The floor
exists so that what is returned cannot be traced to a single person, which
only distinct voices can provide. This mirrors the rule already proven in
`apps/demo/src/match/lexical.ts` (lines 165-171) — restated here as this
package's own logic, not imported from the demo.

## Testing

```sh
npx tsc --noEmit -p tsconfig.json
npx vitest run
```
