# packages/query-infra: ported from the rebiosys fork

Decision B-03, option A (Jakob, 2026-09-06): `Code/primary-repo` is the trunk,
and the rebiosys `query-infra` branch is folded in as packages rather than kept
as a parallel repo. rebiosys is frozen after this port.

**Source repo:** `$WOT/PROJECTS/trust-sharing/PROJECTS/rebiosys`
(not under `$WOT/Code`, despite what several handovers say; see B-12).
**Source branches:** `query-infra` (13 ahead of `demo-2026-08-31`, 82 behind)
and `chore/uncommitted-2026-09-04` (`f11649b`, the two files that had been
sitting uncommitted).
**Merge base:** `d24666a`.

## Method

Two methods, because the source is not one directory:

1. `packages/inventory-store` and `packages/relay-crypto` keep their exact
   paths, so they came across as `git format-patch` restricted to that path,
   applied with `git am`. Original author, date and commit message are
   preserved (`023b4b3`, `5776855`).
2. `packages/query-infra` is a **path rewrite**: its sources lived inside
   rebiosys's `packages/network-access`, a package that already exists in the
   trunk with different content. Patch application would have conflicted on
   every file, so these were copied file by file, with the source commit
   recorded per file in the table below, and their relative imports repointed
   at `@resource-web/network-access`.

## Ported

| Trunk path | rebiosys source | Source commits | Change on the way in |
|---|---|---|---|
| `packages/inventory-store/**` | same path | `023b4b3` | none, verbatim via `git am` |
| `packages/relay-crypto/**` | same path | `5776855` | none, verbatim via `git am` |
| `packages/query-infra/src/profiles.ts` (+test) | `packages/network-access/src/profiles.ts` | `d838cfe` | import repointed |
| `packages/query-infra/src/reply_schedule.ts` (+test) | `.../src/reply_schedule.ts` | `d838cfe` | none |
| `packages/query-infra/src/templates.ts` (+test) | `.../src/templates.ts` | `6e9e5a2`, `9f3f7eb` | import repointed |
| `packages/query-infra/src/red_flags.ts` (+test) | `.../src/red_flags.ts` | `6e9e5a2` | import repointed |
| `packages/query-infra/src/pause.ts` (+test) | `.../src/pause.ts` | `6e9e5a2` | none |
| `packages/query-infra/src/vault.ts` | `.../src/vault.ts` | `6e9e5a2` | none |
| `packages/query-infra/src/vault_query.ts` (+test) | `.../src/vault_query.ts` | `6e9e5a2`, `9f3f7eb`, `0613fb1` | import repointed; duplicate k constant deleted (below) |
| `packages/query-infra/src/query_gateway.ts` (+test) | `.../src/query_gateway.ts` | `6e9e5a2` | none |
| `packages/query-infra/src/contact_channels.ts` (+test) | `.../src/contact_channels.ts` | `ee3fe73` | none |
| `packages/query-infra/src/review_queue.ts` (+test) | `.../src/review_queue.ts` | `ee3fe73` | import repointed |
| `packages/query-infra/src/restore_prompt.ts` (+test) | `.../src/restore_prompt.ts` | `ee3fe73` | none |
| `packages/query-infra/src/contracts.ts` (+test) | `.../src/contracts.ts` | `0613fb1` | reads the one `DEFAULT_K`; tests retuned to 3 |
| `packages/query-infra/src/config.ts` | `.../src/config.ts` (the fork's added fields only) | `6e9e5a2`, `cd498bb` | rewritten as `loadQueryInfraConfig()` extending the trunk's `loadConfig()`, so `packages/network-access/src/config.ts` is untouched |
| `packages/query-infra/src/index.ts` | `.../src/index.ts` (the 12 added export lines) | `6e9e5a2`, `ee3fe73`, `0613fb1` | new barrel that also re-exports `@resource-web/network-access` |
| `packages/query-infra/demo/server.ts` | `.../demo/server.ts` | `d838cfe`, `6e9e5a2`, `9f3f7eb`, `ee3fe73`, `f11649b` | `NETWORK_ACCESS_HOST` opt-in included (`f11649b`); vault fixtures path now package-local; reach-out route removed (deferred) |
| `packages/query-infra/demo/query_infra_demo.ts` | same | `6e9e5a2`, `9f3f7eb` | vault fixtures path now package-local |
| `packages/query-infra/demo/review.html` | same | `ee3fe73` | none |
| `packages/query-infra/demo/{ask,inbox}.html` | copied from the trunk's `packages/network-access/demo/` | trunk | none; the fork's copies were byte-identical |
| `packages/query-infra/data/profiles.jsonl` | `.../data/profiles.jsonl` | `d838cfe` | none |
| `packages/query-infra/data/peer_contacts.sample.json` | `.../data/peer_contacts.sample.json` | `ee3fe73` | none |
| `packages/query-infra/data/{contacts.sample,profiles}.json` | copied from the trunk | trunk | the fork deleted `profiles.json`; it is kept here as the documented legacy fallback of `loadProfilesFile()` |
| `packages/query-infra/fixtures/vault/*.md` | repo-root `fixtures/vault/` | `6e9e5a2`, `0613fb1` | moved under the package so the port adds nothing at the repo root |

## The k floor, unified

One constant now, `DEFAULT_K` in `packages/network-access/src/anonymity.ts`,
value **3** (the trunk's). Two duplicates were deleted:

- the fork's `DEFAULT_K = 7` in its own `anonymity.ts` (commit `0613fb1`),
- the fork's `DEFAULT_VAULT_K = 7` in `vault_query.ts`.

`anonymity.ts` now carries the provenance: Jakob's 2026-08-25 owner decision
(DECISIONS.md D24) set the fork's floor to 7, and F-07 rules that the floor is
not tuned before the C-08 prevalence run reports, so the trunk value stands
until then. Raising it is a one-line change in that one file.

`MIN_K = 2` in `contracts.ts` was kept as-is. It is now *below* the default
rather than well under it, which changes what a `mutual:true` contract can do.
That is a real owner-safety question and it is flagged for Jakob, not silently
resolved here.

`packages/network-access/src/config.ts` still defaults `k` to 3 and was not
touched; the fork's `k: 7` default went with its `DEFAULT_K`.

## Dropped

| Dropped | Why |
|---|---|
| the fork's `anonymity.ts` (`DEFAULT_K = 7`) and its `anonymity.test.ts` edit | duplicate of the trunk's module; the value question is now one constant plus a comment |
| the fork's `config.ts` rewrite | would have edited a shared trunk file for three fields only query-infra needs; those fields live in `packages/query-infra/src/config.ts` instead |
| the fork's `index.ts` edit | same reason; query-infra has its own barrel |
| the fork's `packages/network-access/README.md` edit (5 lines) | describes the fork's merged package layout, which no longer exists |
| the fork's `data/profiles.json` deletion | the trunk still ships it and `loadProfilesFile()` documents it as the fallback |
| `DECISIONS.md` (49 lines) and `docs/e2ee-relay-upgrade.md` (82 lines) | rebiosys decision records and a deployment guide for the questhub relay; they belong with the fork's history, not the trunk's build. Still readable in the frozen repo |
| `scripts/rebiosys-pull-e2ee`, `scripts/rebiosys_pull_e2ee_test.py` | deployment tooling for the rebiosys relay host; keeps the port inside `packages/*` and stays with B-12 (rebiosys home) |

## Deferred, needs a decision

| Deferred | Why |
|---|---|
| `proactive_reach_out` gate event, `startProactiveReachOut()`, the `origin` and `message` fields on `IntroQuery` / `OutwardResponse` (fork `gates.ts` + `types.ts`, commits `d838cfe`/`cd498bb`) | this is the fork half of C-06's two competing D21 implementations. It changes the trunk's gate state machine, which also carries the trunk's own two-hop demo 21. Porting it is a product decision, not a merge |
| the demo server's `POST /api/reach-out` route and the `proactive_reach_out` branch of `POST /api/queries/:id/event` | depend on the above; removed from the ported server with a comment pointing here |
| `MIN_K = 2` versus a default of 3 | see above |
| the ported demo server duplicates most of `packages/network-access/demo/server.ts` | the fork's server is that file plus ~490 lines. Deduplicating means extracting a shared demo host, which touches a trunk file; left for a later pass |

## Running it

```
pnpm install
pnpm -r build
pnpm --filter @resource-web/query-infra test
pnpm --filter @resource-web/query-infra demo:script   # serverless, opens no port
pnpm --filter @resource-web/query-infra demo          # http://127.0.0.1:4790
```

Both this demo server and `packages/network-access`'s own default to port 4790
and read the same `NETWORK_ACCESS_PORT`, so running the two filters at once
fails with EADDRINUSE. Set `NETWORK_ACCESS_PORT` on one of them to run them side
by side. Deduplicating the two servers is on the deferred list above.

The server binds loopback only unless `NETWORK_ACCESS_HOST` is set explicitly.
Useful overrides: `NETWORK_ACCESS_PORT`, `NETWORK_ACCESS_STATE_DIR` (keeps the
owner-local JSONL store out of `~/.local/share/rebiosys`),
`NETWORK_ACCESS_INVENTORY` (the inventory JSONL corpus),
`NETWORK_ACCESS_VAULT_PATH`, `NETWORK_ACCESS_NO_BRIDGE=1`.

## A note on style

Ported files keep their original prose, em dashes included, so that "verbatim"
means verbatim and the `git am` patches stay applicable. The no-em-dash rule
was applied to everything written for this port: this file, the new comments in
`anonymity.ts`, `config.ts` and `index.ts`, the commit messages, and the
handover.
