# Sharing layer options — research note (not a decision record; append to DECISIONS.md separately if adopted)

Status: research only, no code. Branch `cloud/sharing-layer-research`. Accessed 2026-10-27.
Question: which access-control layer carries **tag + trust-zone + person + group** sharing across platforms (Tana-like tags on persons and files)?

## 1. Recommendation (conclusion first)

**Adopt the ReBAC model (relationship-based access control: access follows relationship tuples), not a product. Build a small pure local evaluator behind an I5 interface; use OpenFGA's model language as the reference spec and conformance oracle; export to Solid WAC for interop; revisit NextGraph at stable.** [confidence 0.7]

| Option | Verdict | One-line reason |
|---|---|---|
| OpenFGA | ✅ model reference + optional hub engine | Best fit semantics (usersets, conditions for expiry), CNCF Incubating; Go server, so not an in-process TS library |
| SpiceDB | ⛔ not now | Same semantics, heavier ops (central datastore), in-memory store does not persist |
| Ory Keto | ⛔ | Same family, weakest evidence of current momentum and licence in what I could verify |
| Solid WAC | ☑️ export target only | Per-resource ACL, no tags, no conditions; widest interop |
| Solid ACP | ⛔ | Stalled signals (see §4), more complex than WAC |
| NextGraph | 👀 watch | Different layer (storage + sync + capabilities); alpha |

Why not just install a server: I1 (inventory never leaves the owner's device) and I5 (swappable behind `packages/protocol`) point to a **local, per-device decision function**, which a central Zanzibar-style service contradicts unless one instance runs on every device.

## 2. Requirements mapped to this repo

| Need | Repo anchor | What the layer must do |
|---|---|---|
| Trust zone | ring vocabulary `close/friends/commons/pub` (`permission_policy.ts`, D21); `audience: "trusted"` (I9) | Zone as a group-like set a person belongs to |
| Person | trust edges with `expires_at` +1y (I9) | Direct grant, expiring |
| Group | circles / rooms | Set membership, nestable |
| Tag (Tana supertag) on person or file | EAV semantic layer (`storage-kidur-semantic.md`) | Tag as a first-class set: "everyone tagged X may see files tagged Y" |
| Cross-platform | TS, Rust, Flutter targets | Same decision on every device, same answer |
| Never break | I1, I2, I3, I8, I9 | See §5 |

## 3. Comparison (cost-benefit)

| Criterion | OpenFGA | SpiceDB | Ory Keto | Solid WAC | Solid ACP | NextGraph |
|---|---|---|---|---|---|---|
| Model | tuples + type model; usersets | schema: relations + permissions | tuples + namespaces + OPL | per-resource ACL | policy/matcher resources | capability links (bearer) |
| Tag as set | yes (tag object, member relation) | yes | yes | no (group docs only) | partly (matchers) | no (not a permission concept) |
| Zone / group / person | yes / yes / yes | yes / yes / yes | yes / yes / yes | via agentGroup | yes | per-document keys |
| Expiry / conditions (I9) | conditional tuples, time-window example [A] | caveats, CEL [A] | not verified | none | partly | not verified |
| Runs on a phone / in-process | no (Go server; SQLite and memory adapters exist [A]) | no (memdb non-persistent [A]) | no (Go server) | n/a (file ACL) | n/a | yes (Rust core, local-first) |
| Offline / local-first | only per-device instance | only per-device instance | only per-device instance | weak | weak | strong |
| Revocation | delete tuple | delete tuple | delete tuple | edit ACL | edit policy | synchronous, quorum-signed [A] |
| Maturity signal | CNCF Incubating since 2025-10-28 [A] | Apache-2.0 [A], active releases | releases seen (v25.4, v26.2) [C] | in use on solidcommunity.net [C] | disputed [C] | alpha [A] |
| Cost to adopt | medium (sidecar per device) | high | medium | low (export only) | medium | high (storage rewrite) |
| Value for tag + zone + person + group | high | high | medium | low | low-medium | medium, different layer |

## 4. Findings per option

- **OpenFGA.** Tuples are user–relation–object; the user can be a userset such as "editors of folder X", which gives zones and groups for free. Conditional tuples carry a named condition, with a time-window example, which maps to I9's `expires_at`. Contextual tuples are supplied per check and never stored, which suits "this request comes from a person in zone Z" checks. "X from Y" indirect relations are how a file inherits from a tag or folder. SQLite and MySQL adapters were contributed by Grafana Labs and TwinTag. Licence: I could not confirm Apache-2.0 from the results; check the repo `LICENSE`. [A: openfga.dev/docs/modeling/conditions, /blog/conditional-tuples-announcement, /project, cncf.io 2025-11-11]
- **SpiceDB.** Same Zanzibar family; caveats attach CEL conditions to relationships. Apache-2.0 per pkg.go.dev (published 2026-06-18). Datastores: Spanner, CockroachDB, PostgreSQL, MySQL, and memdb (not persisted). Docs state Watch needs CockroachDB changefeeds, which I could not re-verify for current versions. Designed as a central service; no embedded mode found. [A: docs.authzed.com/reference/caveats, /spicedb/selecting-a-datastore, pkg.go.dev]
- **Ory Keto.** Relation tuples, subject sets, namespaces, OPL (Ory Permission Language). Release pages list v25.4.0 and v26.2.0; I did not confirm licence or current maintainer commitment. Treat as unverified. ⚠️ [A: ory.com/docs/keto proto API; C: newreleases.io]
- **Solid WAC.** Oldest Solid access spec, still what solidcommunity.net uses. No tag concept; the unit is a resource plus an agent or agent group. [C: solid/specification discussion 2026]
- **Solid ACP.** Incubated since 2020, proposed at version 0.9 in 2022. A March 2026 mailing-list post says an ACP protocol spec is still missing; one contributor calls it unmaintained for four years (opinion, not status). [C: lists.w3.org public-solid 2026-03; github.com/solid/specification PR discussion]
- **NextGraph.** Permissions are cryptographic capabilities inside a share link (Nuri). Root-branch read capability opens the whole document; adding permissions works asynchronously offline; **removal is synchronous and needs a quorum-signed SyncSignature**. Apps are alpha; SDK status unclear. This sits below the sharing layer: it would replace our store, not our policy. The AD4M note already records a `nextgraph-link-language` in the coasys org. [A: docs.nextgraph.org/en/framework/permissions; fosdem.org 2026]

## 5. Invariant check — unintended consequences ⚠️

| Risk | Invariant | Mitigation |
|---|---|---|
| ReBAC **transitive inheritance** (userset rewrites, "from" relations) can grant access through a chain of people | I8 hop-consent: every hop consents | Allow inheritance only tag→file and zone→person within one owner's graph; never across person edges |
| "Who can see this?" reverse queries (list users / lookup) | I2 asker blindness | Expose only to the owner locally; never in asker-facing API |
| A central tuple store holds everyone's graph | I1 local sovereignty | One evaluator per owner device; no shared tuple store |
| Allow/deny shape leaks via timing or message shape | I3 indistinguishable No | The engine answers locally; the wire still emits identical `PASS` on the uniform schedule |
| Wider defaults through a tag ("everyone tagged X") | I9 conservative defaults | New tag grants start `ask_each_time`, expire at +1y |
| Presenting the evaluator as private-by-proof | I7 honest labeling | Label v0 as policy enforcement, not zero-knowledge |

## 6. Proposed next steps (small, reversible)

1. Define a `SharingPolicy` interface in `packages/protocol` (check(subject, action, object) → allow/deny/ask, plus an audit reason string for I6). Condition: only after Jakob confirms.
2. Write the reference model once in OpenFGA's DSL as a spec; derive test vectors from it; run the TS evaluator against the vectors (property: same answers).
3. Add a WAC exporter for post-consent, already-shared items only.
4. Re-check NextGraph when its SDK leaves alpha.

## ❗ Decision points for Jakob

1. Is one evaluator per device acceptable, or do you want a shared hub (then OpenFGA as a server is the pick)? **My lean:** per device.
2. Should tags grant access at all, or only label? **My lean:** grant, but only through `ask_each_time` first.
3. Does interop with Solid pods matter now? **My lean:** export only, later.

## 7. What I could not verify (please tell me if you can)

Licences of OpenFGA and Keto from primary files; Keto maintenance status; SpiceDB expiry support and Watch on non-CockroachDB stores; ListObjects scale on SQLite; NextGraph licence and SDK release state. Direct fetches of project repos failed in this sandbox, so claims rest on search summaries. Overall confidence 0.7; items in this section sit below 0.7.

## 8. Sources (tiered, accessed 2026-10-27; none older than 10 years)

- [A] openfga.dev — conditions, conditional tuples announcement, project page; cncf.io blog 2025-11-11
- [A] docs.authzed.com — caveats, datastore selection; pkg.go.dev/github.com/authzed/spicedb (2026-06-18)
- [A] ory.com/docs/keto — proto API, namespaces
- [A] docs.nextgraph.org — permissions and capabilities; fosdem.org 2026 NextGraph talk
- [B] arxiv.org/pdf/2411.05622 — user-managed access over Solid, WAC vs ACP comparison (2024-11)
- [C] lists.w3.org public-solid 2026-03; github.com/solid/specification PR threads; newreleases.io Keto releases

Roundup: models travel, servers do not — keep the relationships, carry them lightly. 🌱
