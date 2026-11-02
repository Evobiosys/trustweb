<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->
# Sharing policy (prototype)

Status: prototype, 2026-11-02. Implements option B of `docs/research/sharing-layer-options.md`
(embedded, per-device evaluator; OpenFGA-style model as the spec). Code: `packages/protocol/src/sharing_policy.ts`.
Not wired into the daemon yet. Nothing here changes a running system.

## Conclusion

A 150-line pure function, `checkSharing`, answers "may this asker see this item?" from four subject
kinds (person, group, zone, persons-with-a-tag), item tags, and an owner-level tag-grant list. A
**block always beats a grant**, expiry is required on grants, and the default is deny. It runs on the
owner's device only (I1) and sits behind the `SharingPolicy` interface so another engine can replace it (I5).

## Model

| Concept | Shape | Notes |
|---|---|---|
| Zone | `contact` ⊂ `friend` ⊂ `close` (existing `TrustLevel`) | a grant to `friend` also covers `close`; zone assertions expire |
| Person | `{ zone?, tags[], groups[] }` | tags on persons are owner-private |
| Group | `{ memberOf[] }` | nesting followed to `MAX_GROUP_DEPTH` = 4; cycles are safe |
| Item | `{ tags[], viewers: Grant[], blocks: Subject[] }` | tags are owner-private |
| Tag grant | `{ tag, grant }` | blanket rule: items tagged `tag` are visible to the subject |
| Subject | `person` / `group` / `zone` / `person_tag` | `person_tag` = Tana-style tag on a person |
| Grant | `{ subject, expiresAt }` | `expiresAt` required (I9); unparseable counts as expired |

Evaluation: (1) any matching block, from person or group, denies; blocks never expire (fail closed).
(2) any live item grant or applicable tag grant allows. (3) otherwise deny.

## How it maps to the invariants

| Invariant | How |
|---|---|
| I1 | pure function over local data; no I/O, no network |
| I2 / I3 | only `eligible` may flow toward asker-facing code; `audit` and `cost` stay local. Declined and no-match both map to the same `PASS` upstream, so callers must not branch wire behaviour on `audit` |
| I5 | `SharingPolicy` interface + `referenceSharingPolicy`; no dependency, not even zod |
| I6 | every decision returns human-readable `audit` lines naming the grant or block |
| I9 | default deny, grants must expire, zone assertions expire |

## Tests

`sharing_policy.test.ts`: example tests per rule plus eight seeded property tests (300 runs each, a
failure prints its seed): no grants means no access; a person block or a group block always wins;
adding a grant never revokes; raising a zone never removes zone-granted access; everything expired
means nobody; grant order is irrelevant; rule-scan cost is the same for every asker. Mutation
spot-check (blocks ignored, expiry ignored, depth cap removed, zone `>=` changed to `===`): each was
caught. The seeded generator is hand-rolled to avoid a new dependency; `fast-check` could replace it.

## What this does not do ⚠️

- **Not timing-safe.** `cost` is constant per policy, but membership resolution depends on the asker's groups and this has no timing test. The uniform 30 s reply schedule (I3) is what hides latency; do not rely on this function for that.
- **Not consent.** "ask each time" stays in the lifecycle state machine; `eligible` only says the asker may be asked about.
- **Not persisted, not wired.** No store, no UI, no daemon call site. Wiring is a separate change.
- **Not conformance-tested against OpenFGA.** The research doc proposes a CI cross-check; it is not built.
- **Cross-owner sharing, conditions beyond expiry, and reverse queries ("what can Anna see?")** are out of scope.
- **Tag rules are caller-supplied.** Nothing here writes "everyone tagged `neighbour` joins group X"; that would be a rule engine on top.

## Open questions for the owner

1. Should blocks ever carry an expiry? Today they cannot; the cost is that a forgotten block stays forever.
2. Should a zone grant to `contact` mean "any connected person" (current) or "only people with a live zone assertion" (same thing here, since zone comes from the assertion)? Decide when edges are wired in.
3. Place for the first call site: `ownerHandleRequest` in the daemon, before the matcher result is used.
