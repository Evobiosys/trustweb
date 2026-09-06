# The three k's

Findings 2 and 3 of the 2026-09-06 UH-findings handover
(`DEVLOG/community-wot/wot-findings_of-WebOfTrust_handover.md` in the
unlocking-housing repo). Three unrelated parameters in this codebase are all
casually called "k". Conflating them is the trap the handover names directly:
"the famous `kThreshold: 1` must not ship warning ... is about k-anonymity
over distinct authors -- NOT about vouch counts." This document is the single
place that defines all three, so nobody has to reconstruct the distinction
from scattered comments again.

No function in this codebase should take a parameter literally named `k`
without a doc comment pointing here. Where one still does, treat that as a
bug, not a style nit -- it is exactly how the three got conflated in the
first place.

## k1 -- k-anonymity over distinct authors (aggregate display)

**Question it answers:** "Would answering identify one person?"

**Where:**
- `packages/network-access/src/anonymity.ts` -- `DEFAULT_K` (canonical value)
  and `MIN_K` (hard floor, `Math.max(2, DEFAULT_K - 1)`).
- `apps/demo/src/types.ts`'s `QueryTemplate.kThreshold` field, and every
  template in `apps/demo/src/data/templates.ts` / `match/accommodation.ts` /
  `data/free_text_query.ts` that sets it.
- `apps/demo/src/match/lexical.ts`'s `matchTemplate()`: `distinctAuthors >=
  template.kThreshold`, with the B-08 (2026-09-06) owner-declared bypass --
  an all-owner-declared match (`thread.source === 'self'`, an inventory entry
  or second-brain note) skips the floor entirely, because its only "voice" is
  the person about to be asked to consent, not a third party. A chat-derived
  hit, alone or mixed with owner-declared hits, still needs `distinctAuthors
  >= kThreshold`.

**Canonical value and floor (Finding 3):** `DEFAULT_K = 3`, `MIN_K = 2`, both
defined exactly once in `packages/network-access/src/anonymity.ts` (commit
`9b6a342`, "k floor: tie MIN_K to DEFAULT_K so the two move together").
`packages/network-access/src/default_k_unification.test.ts` is the structural
guard: it fails if a second `export const DEFAULT_K` appears anywhere in this
workspace's `packages/*/src` or `apps/*/src`, or if the one flagged exception
below drifts.

**History of the disagreement (now reconciled on this branch):**

| Source | Value | Status |
|---|---|---|
| `primary-repo`'s `packages/network-access/src/anonymity.ts` | 3 | canonical, kept |
| `rebiosys` fork's own copy of the same file | 7 | deleted when `query-infra` was ported into the trunk (decision B-03 option A, commit `775c346`) |
| `packages/query-infra`'s vault-specific duplicate | 7 | deleted in the same port |
| design doc `overnight/05-chat-group-information.md:83` | "integer >= 2, default 7 ... never below 2" | doc not code; still says 7, not updated by this handover -- a product call for the project owner, not this handover's to make |

**Resolved by the k-standardize pass (2026-09-06, Jakob: "keep k as is, just
standardize them"):** the two drifts below were left open by the original
UH-findings handover. Neither k VALUE changed; both were given a name.

Four templates in `apps/demo/src/data/templates.ts`
(`nachmieter_genossenschaft`, `kassenarzt_open`, `handwerker_reliable`,
`childcare.place_open`) used to hardcode the literal `kThreshold: 7` rather
than importing `DEFAULT_K` (3). One of them even carried a comment claiming
"per catalogue doc section 1 (DEFAULT_K)" while citing a file that says 3,
not 7 -- itself a small instance of the drift this document exists to stop.
The literal is now `HIGH_RISK_TEMPLATE_K`, a named constant exported beside
`DEFAULT_K` in `packages/network-access/src/anonymity.ts`, value still 7:
reconciling these four to `DEFAULT_K` would have silently RELAXED their
anonymity floor from 7 to 3; raising `DEFAULT_K` itself to 7 is what the
design doc implies but contradicts F-07's ruling that the floor is not to be
tuned before the C-08 prevalence measurement runs. The design doc
(`overnight/05-chat-group-information.md:83`) still says 7 as its own
default, unchanged -- that row in the table above stays a ❗ for the project
owner; naming the code-side constant did not touch it.

`packages/inventory-store/src/query.ts`'s own zero-dependency copy is no
longer named `DEFAULT_K` at all -- renamed to `INVENTORY_DEFAULT_K`, value
still 3, with its own doc comment pointing here. It stays a SEPARATE
definition, not merged into a single import, for the same reason as before:
`inventory-store` deliberately declares zero dependencies in its own
`package.json` -- load-bearing evidence in decision B-22's AGPL/third-party-
dependency audit ("packages/inventory-store and packages/relay-crypto
declare no dependencies at all") -- while `network-access` is licensed
AGPL-3.0-or-later. Wiring one to import the other stays a dependency/license
call for the project owner. What changed is that drift between the two no
longer goes unnoticed silently: `packages/network-access/src/
default_k_unification.test.ts` now asserts `INVENTORY_DEFAULT_K` is defined
in exactly that one file and nowhere named `DEFAULT_K`, and
`apps/demo/test/k_cross_package_sync.test.ts` -- the one place in this
workspace that already depends on both packages -- imports both constants
and fails the moment their VALUES diverge.

**Settings surface (2026-09-06):** the demo's "Mein Profil" screen
(`apps/demo/src/screens/profile.ts`) now shows a read-only "Anonymity floor
(k)" section: `DEFAULT_K`, `HIGH_RISK_TEMPLATE_K` (this page's k1) and
`VOUCH_K` (k2, below), each with a one-line explanation, plus an advanced,
OFF-by-default toggle, "Test mode: single-holder matches allowed"
(`DeviceState.testModeSingleHolderMatches`, `withDefaults`-backfilled to
`false`). It widens ONLY `match/lexical.ts`'s existing B-08 owner-declared
bypass (`thread.source === 'self'`) and is threaded through as an explicit
argument to `matchTemplate()`, read nowhere near the
`distinctAuthors >= template.kThreshold` branch that protects a real chat
message's third party -- see `apps/demo/test/match_kanon.test.ts`'s
`testModeSingleHolderMatches` suite for the tests proving that.

Honestly stated finding, not hidden in a code comment alone: because an
owner-declared hit's `author` is always `s.me.displayName`
(`state.ts`'s `inventoryThreads()` / `main.ts`'s `secondBrainThread()`),
`distinctAuthors` is already exactly 1 for every owner-declared band-hit
set, and the existing bypass already fires unconditionally for it. So this
toggle currently changes NO gating outcome -- it exists as the named,
explicit override surface `match/accommodation.ts`'s own comment already
asks for ("bigger-corpus-or-explicit-override fix"), wired and tested ahead
of the corpus change that would ever make it non-vacuous.

**❗ Open for the project owner, not decided here:** "single-holder" most
naturally could also describe a holder's own CHAT message about their own
thing (e.g. Marlene posting "meine Wohnung wird frei" into a group chat --
one real author, writing about herself, same as an inventory entry in
substance) -- a reading `match/accommodation.ts`'s comment gestures at
("a genuine chat-message match against this template can no longer clear
the floor... known and accepted"). This toggle deliberately does NOT cover
that case: `matchTemplate()`'s bypass check is `h.source === 'self'`, which
is true only for owner-declared corpora (inventory items, second-brain
notes), never for an ordinary `ChatThread` regardless of who wrote which
message in it. Extending "single-holder" to also mean "one real author,
whoever they are, in a chat" would let a single chat message about oneself
skip the floor -- exactly the shape of the historically dangerous
`kThreshold: 1` mistake this codebase already had to fix once (see the
Summary table's closing note below). Left unbuilt and named here rather than
guessed at.

## k2 -- vouch-count k for credential presentation

**Question it answers:** "How many distinct vouchers must a holder present
before a relying party treats them as vouched-for?"

**Where:** `packages/transport/src/inbound_vouch.ts` -- `VOUCH_K` (default),
`verifyInboundVouches()`'s `k` option (Finding 1, the new inbound-vouch
route). Nowhere before Finding 1's work existed at all: there was no
inbound-vouch collection or verification path, so there was nothing to name.

**Default:** `VOUCH_K = 2`, clamped up to a hard floor of 2 inside
`verifyInboundVouches` regardless of what a caller passes (same
never-below-2 reasoning as k1's `MIN_K`, at k = 1 "vouched for" means "one
person said so", not meaningfully different from unvouched).

**UH-configurable:** this is explicitly a product decision for whichever
relying party consumes it, not fixed by the WoT side. UH's own proposal
(`wot-sharing-proposal_of-UnlockingHousing.md` §5) enforces `MIN_K_THRESHOLD
= 2` as its floor and argues 3 is more defensible specifically for owner
contact details -- that choice (UH's D3) is explicitly UH-side and not
resolved here.

**Anti-Sybil requirement:** counting distinct issuer DIDs without an anchor
set is theatre -- DIDs are free to mint. `verifyInboundVouches`'s
`anchorDids` option restricts counting to a caller-supplied allowlist; a
relying party with no anchor set and no other Sybil defense should always
supply one (UH's own `UH_WOT_ANCHOR_DIDS`, its D2, is also UH-side and not
resolved here).

## k3 -- trust-distance / weighting

**Question it answers:** "How much should a contribution count, given how
far and how trusted the path to it is?"

**Where:** `packages/network-access/src/trust_weighting.ts` on branch
`feat/trust-weighting` (commit `bae327c`, **not merged** into this trunk).
`DEFAULT_MIN_CONTRIBUTORS = 3` -- the minimum number of independent
contributors an aggregation needs before it returns a decision at all,
distinct from both k1 (distinct authors clearing an anonymity floor) and k2
(distinct vouchers clearing a presentation threshold). Implements Jakob's
B-20 ruling: a trust-weighted average (`w_i = zutrauen_i * vertrauen_i *
decay^(distance_i - 1) * metaTrust`) plus a sociocracy-style veto.

There is also, separately, no trust-DISTANCE (hop-count) function anywhere
in this codebase outside `trust_weighting.ts`'s `distance_i` input (which the
caller supplies; nothing here computes a shortest path). `docs/
query-traversal.md` names the cross-hop anonymity floor as an open problem.
UH's own use of "distance" (`TrustClaim.distance`, carried but unused,
per its proposal §7) is deliberately fixed at 1 by construction (anchor-set
vouches only), for exactly this reason.

## Summary table

| | k1 | k2 | k3 |
|---|---|---|---|
| Counts | distinct AUTHORS in a matched corpus | distinct ANCHOR/issuer VOUCHERS for one subject | weighted, decayed CONTRIBUTORS |
| Answers | "would this identify one person?" | "is this holder vouched-for enough?" | "how much should this aggregate contribution count?" |
| Constant | `DEFAULT_K` / `MIN_K` | `VOUCH_K` | `DEFAULT_MIN_CONTRIBUTORS` |
| Where | `packages/network-access/src/anonymity.ts` | `packages/transport/src/inbound_vouch.ts` | `packages/network-access/src/trust_weighting.ts` (branch `feat/trust-weighting`, unmerged) |
| Default | 3 (floor 2) | 2 (floor 2) | 3 |
| Configurable by | the WoT deployment (env / template) | the relying party (e.g. UH) | not yet wired to any config surface |

**The historically dangerous phrase, disambiguated:** "`kThreshold: 1` must
not ship" refers to k1 ONLY -- a demo-crutch value in `apps/demo/src/data/
templates.ts` and two other call sites, fixed on 2026-09-06 (commit
`9693f5f`) by importing `DEFAULT_K` instead of hardcoding `1`, and guarded
by `apps/demo/test/kthreshold_sweep.test.ts`. It has never meant, and does
not mean, "no vouch may stand alone" (k2) or "no single contributor may be
trusted" (k3). See `README.md`'s Privacy Honesty Box for the reader-facing
version of this same distinction.
