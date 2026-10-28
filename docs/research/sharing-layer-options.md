# Sharing layer options — tag + trust-zone + person + group access control

Status: research, no code. Written 2026-10-27 against `main` @ 7e79831. Scope: which access-control
engine (or model) should answer "may X see item Y?" when items and persons carry Tana-like tags
(supertags), people sit in trust zones, and groups exist, across devices and platforms.

Source tiers: A = spec/vendor docs/legal, B = journal/analytic, C = community. Searches ran 2026-10-27;
items I could not confirm are marked **[unverified]**. Nothing here was benchmarked or installed.

---

## 0. Conclusion first

**Adopt the Zanzibar tuple model, not a Zanzibar server.** Specifically:

1. Model sharing as relation tuples (`object#relation@subject`) with computed usersets. Use
   **OpenFGA's modelling language as the schema reference**, because it expresses tag-grants,
   ordered trust zones and groups in a few lines and has a documented conditions feature.
2. Evaluate it **in-process inside each agent-daemon**, behind a small interface in
   `packages/protocol` (I5). A central authorization service conflicts with I1 (inventory never
   leaves the owner's device) and with I2/I3 (an authz call that answers differently for "declined"
   vs "no match" leaks the very bit I3 hides).
3. Keep **OpenFGA as an optional server adapter** for any future hosted/relay deployment, and keep
   **Solid WAC/ACP as an export/import format only** if a Pod bridge ever appears. Watch **NextGraph**;
   do not build on it yet.

Confidence 0.7 on the overall direction; 0.5 on "write our own evaluator" versus embedding an
existing engine, because I found no TypeScript-embeddable Zanzibar engine and did not look hard
enough to rule one out. ⚠️ Please tell me if you know of one.

---

## 1. What the layer must do (derived from the repo)

| # | Requirement | Source in repo |
|---|---|---|
| R1 | Decide per item × asker, **locally**, without exporting inventory | I1 |
| R2 | Decision result must not be observable as different "No" kinds | I2, I3 |
| R3 | Zones are ordered: close ⊃ friend ⊃ contact (inner sees more) | D14 trust levels, D21 audience × category matrix |
| R4 | Tag-based blanket grants sit **under** per-person grants (per-person wins, including denies) | D21 / `docs/70-placeholders.md` PLC-2/3 |
| R5 | Tags apply to **persons and files/items**; one tag may grant a zone, group or person | task brief |
| R6 | Conservative default: nobody, `ask_each_time`, expiry +1y | I9 |
| R7 | Every decision auditable in human-readable form | I6 |
| R8 | Backend swappable | I5 |
| R9 | Works offline, on several devices of one owner, cross-platform (mobile, web, daemon) | D-device-sync-v2 |

R4 contains a **deny that beats a grant**. That is the single most discriminating requirement:
pure Zanzibar-style systems model *exclusion* (`but not`), not a global deny-override.

---

## 2. The model that fits (engine-independent)

```
type person                         # a contact; also a subject
  relations
    define in_zone_contact: [person]   # asserted by owner, expiring
    define in_zone_friend:  [person]
    define in_zone_close:   [person]

type group
  relations
    define member: [person, group#member]

type tag                              # supertag, e.g. "tool", "family"
  relations
    define grantee: [person, group#member, zone#member]

type zone                             # ordered by inclusion
  relations
    define member: [person] or inner#member    # close ⊂ friend ⊂ contact

type item                             # file, listing, note
  relations
    define owner:  [person]
    define tagged: [tag]
    define block:  [person, group#member]            # per-person deny
    define direct_viewer: [person, group#member, zone#member]
    define viewer: (direct_viewer or grantee from tagged) but not block
```

Notes: tags on **persons** work the same way with `type person` gaining `tagged: [tag]`; "everyone
tagged `neighbour` is in group X" is a tuple written by a rule, not a new relation kind. Expiry
(R6) and "ask each time" (I9) are **conditions** on the tuple (a timestamp comparison; a consent
flag), which OpenFGA and SpiceDB both support; Keto does not (see §3).

"ask each time" is not a pure authz answer: it yields *maybe-pending-consent*, which the
lifecycle state machine already handles. The engine answers "eligible"; consent stays in
`packages/protocol`.

---

## 3. Comparison

| Criterion | OpenFGA | SpiceDB | Ory Keto | Solid WAC | Solid ACP | NextGraph |
|---|---|---|---|---|---|---|
| Model | Zanzibar ReBAC + DSL | Zanzibar ReBAC + schema | Zanzibar tuples; policy language (OPL) | ACL files per resource, group docs | Policy/matcher documents | Cryptographic capabilities per document/branch |
| Computed/ordered zones (R3) | ✅ `or` over usersets | ✅ | ✅ (subject sets) | ⚠️ manual group nesting | ⚠️ via matchers | ❌ not a concept |
| Tag → grant (R5) | ✅ `from` traversal | ✅ arrows | ✅ | ❌ resource-local | ⚠️ policy matchers | ❌ |
| Per-person deny beats grant (R4) | ⚠️ `but not` only | ⚠️ `-` exclusion only | ⚠️ limited | ❌ allow-only | ✅ deny rules (draft) | ❌ |
| Conditions/expiry (R6) | ✅ CEL conditions, contextual tuples | ✅ caveats (CEL) | ❌ none found | ⚠️ spec has a conditions part | ✅ matchers | ⚠️ capability expiry **[unverified]** |
| Embeddable in-process (R1, R9) | ❌ Go server (HTTP/gRPC) | ❌ Go server (a library exists but is Go) | ❌ Go server | n/a — server concern | n/a | ✅ it *is* a local-first engine (Rust/WASM) |
| Offline / multi-device (R9) | ❌ needs reachable service | ❌ same | ❌ same | ❌ | ❌ | ✅ E2EE sync, broker sees ciphertext only |
| Reverse queries ("what may Anna see?") | ✅ ListObjects | ✅ LookupResources | ✅ expand | ❌ | ❌ | ❌ |
| Maturity / governance | CNCF Incubating since 2025-10-28 | Apache-2.0, frequent releases, caveat CVEs fixed (1.35.3, 1.52.0) | Active; v26.3.7 tightened OPL validation | Oldest, most deployed in Solid | Contested, spec reported unmaintained for years | **Alpha** (npm 0.1.1-alpha.7) |
| Fit to I1–I3 | Needs local deployment | Needs local deployment | Needs local deployment | Server-side pods break I1 unless pod is on-device | same | Strong on I1, unproven on I3 |

Reading the table: the three Zanzibar engines solve R3/R5/R6 well and R1/R9 not at all as shipped;
Solid solves neither; NextGraph solves R1/R9 and none of the model questions.

### 3.1 OpenFGA
- Best DSL and docs for what we need; conditions (CEL), contextual tuples (pass "Anna is in the
  `close` zone *right now*" without storing it) and ListObjects/ListUsers.
- Contextual tuples fit I1 well: the daemon can pass its local facts per check, so a server would
  not need our inventory — but then the server adds nothing the daemon cannot do itself.
- Cost: a Go service per owner device is not viable on a phone; a shared server breaks I1.

### 3.2 SpiceDB
- Most mature open implementation of the Zanzibar paper; caveats ≈ conditions; Apache-2.0.
- Same deployment problem. Stronger consistency tooling (zookies/revisions) that a single-owner,
  mostly-offline graph does not need.
- Security history: caveat bugs (wrong denials, cache reuse) — relevant because caveats are what
  we would lean on for expiry.

### 3.3 Ory Keto
- Plain tuples and subject sets cover groups and zones. No conditions found, so expiry and consent
  flags would live outside the engine. Docs conflict on whether self-hosted Keto executes OPL at
  runtime or reads namespaces from config **[unverified]**. Weakest fit for R6.

### 3.4 Solid WAC / ACP
- Resource-centred: access lives in a file next to the resource. Good for publishing to a Pod,
  poor for "this tag grants that zone" across thousands of items. WAC is allow-only. ACP adds
  deny and matchers but its spec status is contested.
- Useful as an **interop target**: our tuples compile to a WAC/ACP file when sharing out to a
  Pod. Not a decision engine.

### 3.5 NextGraph
- Different layer: it decides **who can decrypt and sync a document**, not who may be *shown* an
  item after a match. Capabilities are cryptographic, so revocation and zone changes mean re-keying
  — a cost I could not quantify from public material.
- Genuinely aligned with the vision (local-first, E2EE, RDF graph, groups) and with the v1
  zero-knowledge target (D2). Alpha, single-vendor, no independent audit found.

---

## 4. Options and recommendation

| Option | Cost | Value | Verdict |
|---|---|---|---|
| A. Run OpenFGA/SpiceDB as a central service | Low build, high privacy cost (breaks I1, risks I3) | Strong tooling | ⛔ |
| B. Embed per-device: small TS evaluator of the §2 model, OpenFGA DSL as spec, OpenFGA test fixtures as conformance suite | Medium build (a few hundred lines + tests; ordered-zone and tag traversal only) | Satisfies I1–I3, I5, I6, offline | ☑️ **recommended** |
| C. Build on NextGraph | High, alpha risk | Best long-run alignment | ⛔ now, 👀 re-check in 2027 |
| D. Solid WAC/ACP as the engine | Medium | Wrong shape (resource-local) | ⛔ as engine, ☑️ as export format |

**Why B beats A despite "do not hand-roll authz":** the scope is small and closed (four relation
kinds, depth ≤ 4, no external tenants), and the property that must never regress (I3) is easier to
guarantee when the decision function is local, pure and synchronous. Mitigation for the hand-roll
risk: property tests that cross-check every decision against an OpenFGA instance in CI (contained,
CI-only, not a runtime dependency).

**R4 (deny wins) handling:** model `block` as an explicit exclusion in `viewer`, evaluated in the
same expression; then *test* that no grant path (tag, zone, group, direct) can bypass it. This is
the likeliest place for a silent leak.

---

## 5. Risks and unintended consequences ⚠️

- **Tag explosion as a side channel:** if a tag name is visible to an asker, it discloses
  inventory (I1/I2). Tags must stay owner-private; askers see only the outcome.
- **Timing (I3):** engine latency must not vary with "item exists but denied" vs "no item".
  Check cost should be constant per request, or the uniform reply schedule (30 s) must absorb it.
- **Tags on persons are sensitive** (they encode what the owner thinks of someone). Never include
  them in `PASS`, status or audit exports that leave the device; audit (I6) stays local.
- **Zone drift:** transitive group nesting can widen access silently. Cap depth and log the path of
  every grant (R7).
- **Expiry on tuples** (+1y, I9) needs a clock source; offline devices disagree. Prefer
  "valid until" evaluated at check time on the deciding device.

## 6. What I may have missed
- Whether any embeddable authz library (WASM build of OpenFGA/SpiceDB, Cedar, OPA/Rego, Casbin)
  beats a hand-rolled evaluator for option B. Cedar (policy language with entity hierarchies) and
  Casbin were not researched here and deserve a short follow-up.
- Cross-owner sharing (Anna's tags on Ben's items) — treated as out of scope; each owner evaluates
  only their own graph.
- Real performance numbers for any option.

## 7. Next steps (design only)
1. Owner decision: accept option B? If yes, record as a `DECISIONS.md` entry (append-only).
2. Follow-up spike: Cedar/Casbin/OPA comparison against R1–R9 (research only).
3. Then a protocol-level interface sketch (`SharingPolicy.check(subject, item) -> eligible | not`)
   in `packages/protocol`, TDD-first, with the I3 timing test as the first red test.

---

## Sources (searched 2026-10-27)
- [A] OpenFGA, "Accepted into CNCF Incubation" — https://openfga.dev/blog/incubation-announcement (2025-10-28)
- [A] OpenFGA project / news — https://openfga.dev/project , https://openfga.dev/blog/fine-grained-news-2025-02
- [A] SpiceDB, pkg.go.dev (Apache-2.0) — https://pkg.go.dev/github.com/authzed/spicedb ; Snap Store listing reports 1.56.2 (2026-09-11) [C]
- [A] CVE-2024-46989 (SpiceDB caveats) — https://nvd.nist.gov/vuln/detail/CVE-2024-46989
- [A] Ory Keto docs and changelog v26.3.7 — https://www.ory.com/docs/self-hosted/oel/keto/changelog/v26.3.7 ; https://ory.sh/docs/keto/secure
- [C] Ory community archive on OPL runtime behaviour — https://archive.ory.sh (unreliable, hence **[unverified]**)
- [A/C] Solid WAC/ACP — https://forum.solidproject.org/t/access-control-policies-acp-and-web-access-control-wac/3616 [C]; https://github.com/solid/authorization-panel/issues/184 [C]; Inrupt ESS docs https://docs.inrupt.com/archive/ess/1.0/security/authorization [A, archived ⚠️]
- [A] NextGraph — https://nextgraph.org ; https://www.npmjs.com/package/nextgraph ; FOSDEM 2026 slides https://fosdem.org/2026/events/attachments/J3ZBYC-nextgraph-sync-engine-sdk-reactive-orm/slides/267359/nextgraph_uurlpcc.pdf (self-reported)
- Internal: `CLAUDE.md` I1–I9, `DECISIONS.md` D2/D14/D21, `docs/70-placeholders.md`, `docs/research/ad4m-fit.md`
