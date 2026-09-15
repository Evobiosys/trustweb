// Trust-weighted aggregation with a transparent veto (decision B-20, source
// L-47: Tana voice memo A3TneGe6pzL2, 2026-09-05 walk session; owner ruling
// 2026-09-06). The first formal trust-math layer in the workspace.
//
// Jakob's framing, in his own words: "my ~100 friends and their friends, with
// different degrees of importance, suggest things, so I have a probability of
// it" (the probability half), balanced against "10 people had an okay
// experience and one person I trust a lot found it intolerable, so it is off
// the table" (the veto half). The owner ruling of 2026-09-06 adopted both,
// with the veto respected by default but always transparent and always
// overridable.
//
// Three properties this module holds on to, because they are the ones that
// break quietly:
//
//   1. The hidden weights never leave. Each contribution carries an owner-set
//      Zutrauen, Vertrauen and meta-trust that the person concerned must never
//      see, not even in aggregate or by inference. `explanation` is the only
//      subtree meant for rendering, and it carries no identifiers and no
//      weights. `veto.by` sits outside it, owner-side only.
//   2. Meta-trust governs the second hop, not the first. It is the weight of
//      someone's weightings, so it attenuates what reaches the owner *through*
//      that person. It never multiplies that person's own contribution.
//   3. The result is deterministic. Contributions are summed in hashed-id
//      order, so the floating-point sum does not depend on object key order or
//      on the caller's array ordering.
//
// This package declares no runtime dependencies and this module adds none: a
// HashedId is an opaque string the caller supplies, never computed here.
//
// NOT WIRED INTO ANY UI. The overlay copy, the settings rows for the three
// degrees and the delegation toggle are specified but unbuilt; see the wiring
// TODO list in
// 4claude/DEVLOG/wot-trust-weighting/trust-weighting_of-web-of-trust_spec.md.

/**
 * An opaque, caller-supplied stable identifier for a person. This module never
 * derives one and never reverses one; it only groups and orders by it.
 */
export type HashedId = string;

/**
 * Where the weights on an edge came from.
 *
 * - `manual`      the owner set the three degrees by hand.
 * - `algorithm`   a deterministic local heuristic set them (interaction
 *                 frequency, vouch depth), with no model in the loop.
 * - `ai`          the owner delegated weighting to a model. Same standing as
 *                 `algorithm` for the arithmetic; kept distinct so the UI can
 *                 label it and so the owner can override per edge.
 * - `inherited`   the weights came from a delegate's own weighting, one hop
 *                 out. Only this source is attenuated by the meta-trust of the
 *                 edge it arrived through.
 */
export type DelegationSource = "manual" | "algorithm" | "ai" | "inherited";

/**
 * The three owner-set degrees on one edge, each in [0, 1]. Never rendered to
 * the person they describe, and never echoed in `explanation`.
 */
export interface TrustDegrees {
  /** Zutrauen: confidence in this person's ability to judge the matter. */
  zutrauen: number;
  /** Vertrauen: trust in this person's intent towards the owner. */
  vertrauen: number;
  /**
   * Meta-trust: how well the owner trusts this person to estimate others, the
   * weight of their weightings. Applies to what arrives *through* them, never
   * to their own contribution.
   */
  metaTrust: number;
}

/**
 * One weighted edge from the owner to a contributor. Named TrustWeightEdge and
 * not TrustEdge on purpose: `@resource-web/protocol` already exports a
 * TrustEdge, which is a stored peer relationship record with an expiry, a very
 * different object from this weighting input.
 */
export interface TrustWeightEdge {
  id: HashedId;
  degrees: TrustDegrees;
  /**
   * Graph distance from the owner. 1 is a direct contact (first ring), 2 is a
   * friend of a friend, and so on. Must be an integer of at least 1.
   */
  distance: number;
  source: DelegationSource;
  /**
   * For `source: "inherited"`, the first-ring edge this contribution reached
   * the owner through. Its meta-trust attenuates the contribution. An
   * inherited edge with no resolvable `via` carries no weight at all.
   */
  via?: HashedId;
  /**
   * Owner override for veto standing. Left undefined, eligibility falls back
   * to the `vetoFloor` rule below.
   */
  vetoEligible?: boolean;
}

/** One contributor's report about the item under question. */
export interface TrustScore {
  by: HashedId;
  /** The contributor's own estimate in [0, 1]. */
  score: number;
  /** An "intolerable" report. Binds only if the edge clears the veto rules. */
  veto?: boolean;
}

export type CombineDecision = "allow" | "deny" | "vetoed" | "insufficient";

/** Coarse band shown in place of the raw probability. See ConfidenceBand note. */
export type ConfidenceBand = "low" | "moderate" | "high";

/**
 * Overlay identifiers for the UI layer. Keys only: the DE and EN copy lives in
 * the spec, so that translation churn never touches this pure module.
 */
export type OverlayKey =
  | "veto_spoken"
  | "veto_alternative_path"
  | "veto_overridden"
  | "insufficient_contributors";

export interface VetoState {
  spoken: boolean;
  /**
   * Owner-side only. Never rendered, never placed in `explanation`, never sent
   * to a requester. The overlay says that a veto was spoken, not by whom.
   */
  by: HashedId | null;
  overridden: boolean;
}

/** One entry in the override log. Append-only; `combine` never writes one. */
export interface VetoOverrideEntry {
  /** Milliseconds since epoch, supplied by the caller so this stays pure. */
  at: number;
  /** Free-text owner note. Optional, and never rendered to the vetoing person. */
  reason?: string;
}

/**
 * The render-safe subtree. Everything the overlay is allowed to show comes
 * from here. It carries no identifiers, no degrees and no weights, by
 * construction and by test.
 */
export interface CombineExplanation {
  /**
   * How many contributions actually carried weight. Coarse but not free of
   * risk: watched across repeated asks it narrows individual weights, which is
   * why `minContributors` and the batching mitigation in the spec exist.
   */
  contributorCount: number;
  /** Contributions dropped because no edge matched their `by`. */
  droppedUnknown: number;
  /** The furthest ring that contributed. Rings, not distances per person. */
  ringsReached: number;
  /** Coarse stand-in for the probability, so the overlay need not show `p`. */
  confidenceBand: ConfidenceBand;
  thresholdMet: boolean;
  vetoSpoken: boolean;
  vetoOverridden: boolean;
  /** Which overlay to show, or null when there is nothing to disclose. */
  overlayKey: OverlayKey | null;
}

export interface CombineResult {
  /** Trust-weighted mean of the contributed scores, in [0, 1]. */
  p: number;
  /**
   * The threshold this result was decided against. Carried so that
   * `applyVetoOverride` cannot silently disagree with the `combine` that
   * produced the result, which would otherwise flip allow to deny on an
   * unchanged `p` whenever the caller passed a custom threshold to one and not
   * to the other. Owner-side; never rendered.
   */
  threshold: number;
  decision: CombineDecision;
  veto: VetoState;
  explanation: CombineExplanation;
  /** Empty from `combine`; `applyVetoOverride` appends to it. */
  overrideLog: VetoOverrideEntry[];
}

export interface CombineOptions {
  /** Probability threshold. Defaults to DEFAULT_P. Met at `p >= threshold`. */
  threshold?: number;
  /** Per-ring attenuation base. Defaults to DEFAULT_DISTANCE_DECAY. */
  distanceDecay?: number;
  /** Minimum ability-times-intent for an unflagged edge to veto. */
  vetoFloor?: number;
  /** Whether a bound veto blocks. Defaults to true (the owner ruling). */
  respectVeto?: boolean;
  /** An inherited veto also needs its `via` edge's meta-trust at the floor. */
  inheritedVetoRequiresMetaFloor?: boolean;
  /** Below this many weighted contributors the aggregate is not released. */
  minContributors?: number;
}

/**
 * The single probability threshold for the whole workspace, on the combined
 * trust-weighted probability. Owner decision, 2026-09-06: "default is 0.8".
 * Nothing else declares a second one. Changing it is a one-line change here.
 */
export const DEFAULT_P = 0.8;

/**
 * Per-ring attenuation: a contribution at distance d is scaled by
 * DEFAULT_DISTANCE_DECAY^(d-1), so the first ring is untouched, the second
 * ring counts half, the third a quarter. Chosen as the plainest reading of
 * "closer contacts weigh more than distant ones" with no free parameters
 * beyond the one. It is a starting value, not a measured one, and it should be
 * retuned alongside the C-08 prevalence run rather than guessed at again.
 */
export const DEFAULT_DISTANCE_DECAY = 0.5;

/**
 * Minimum Zutrauen times Vertrauen for an edge to speak a binding veto, unless
 * the owner set `vetoEligible` on that edge by hand.
 *
 * OPEN (owner decision pending): Jakob's phrasing was "one very-trusted
 * person" and "a native leader in that domain", which clearly means not every
 * edge may veto, but it does not fix a number. 0.7 is a placeholder that keeps
 * the floor visibly above the midpoint while leaving room under DEFAULT_P; it
 * is exposed through CombineOptions.vetoFloor precisely so no caller inherits
 * a magic number silently.
 */
export const DEFAULT_VETO_FLOOR = 0.7;

/**
 * Smallest number of weighted contributors before a combined probability is
 * released at all. Set to DEFAULT_K's spirit rather than importing it: this is
 * an aggregate over people, so it needs the same kind of floor that
 * anonymity.ts applies to match counts, and it must not silently inherit a
 * value tuned for a different aggregate. See the k-floor interaction section
 * of the spec, and note that C-03 (`kThreshold: 1` still live at four call
 * sites) would defeat this floor wherever the two aggregates meet.
 */
export const DEFAULT_MIN_CONTRIBUTORS = 3;

/** Band edges for the coarse confidence stand-in. */
const BAND_LOW_MAX = 0.4;
const BAND_MODERATE_MAX = 0.7;

export class TrustWeightingError extends Error {}

function assertUnitInterval(value: number, label: string, id: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TrustWeightingError(`${label} for ${id} must lie in [0, 1], got ${value}`);
  }
}

function validateEdge(edge: TrustWeightEdge): void {
  assertUnitInterval(edge.degrees.zutrauen, "zutrauen", edge.id);
  assertUnitInterval(edge.degrees.vertrauen, "vertrauen", edge.id);
  assertUnitInterval(edge.degrees.metaTrust, "metaTrust", edge.id);
  if (!Number.isInteger(edge.distance) || edge.distance < 1) {
    throw new TrustWeightingError(`distance for ${edge.id} must be an integer of at least 1, got ${edge.distance}`);
  }
  if (edge.source === "inherited" && edge.via === undefined) {
    throw new TrustWeightingError(`inherited edge ${edge.id} needs a via`);
  }
}

function bandFor(p: number): ConfidenceBand {
  if (p < BAND_LOW_MAX) return "low";
  if (p < BAND_MODERATE_MAX) return "moderate";
  return "high";
}

/**
 * Weight of one contribution.
 *
 *   base    = zutrauen * vertrauen            (ability times intent)
 *   decay   = distanceDecay^(distance - 1)    (closeness)
 *   meta    = metaTrust of the `via` edge, for inherited contributions only
 *
 *   w = base * decay * meta
 *
 * An edge's own meta-trust is deliberately absent: meta-trust weights that
 * person's weightings of others, so it belongs to the hop, not to the source.
 * Returns 0 when an inherited edge has no resolvable `via`, which drops it.
 */
function weightFor(edge: TrustWeightEdge, byId: ReadonlyMap<HashedId, TrustWeightEdge>, decay: number): number {
  const base = edge.degrees.zutrauen * edge.degrees.vertrauen;
  const closeness = Math.pow(decay, edge.distance - 1);
  if (edge.source !== "inherited") return base * closeness;
  const via = edge.via === undefined ? undefined : byId.get(edge.via);
  if (via === undefined) return 0;
  return base * closeness * via.degrees.metaTrust;
}

/**
 * May this edge speak a veto that binds?
 *
 * An owner-set `vetoEligible` wins outright, in both directions. Otherwise the
 * edge needs ability times intent at or above the floor. An inherited veto
 * additionally needs the edge it arrived through to clear the same floor on
 * meta-trust, so that a stranger's veto cannot bind through one delegation hop
 * while the owner's own phrase for the veto holder stays "very trusted".
 */
function vetoBinds(
  edge: TrustWeightEdge,
  byId: ReadonlyMap<HashedId, TrustWeightEdge>,
  vetoFloor: number,
  inheritedRequiresMetaFloor: boolean,
): boolean {
  const strength = edge.degrees.zutrauen * edge.degrees.vertrauen;
  const eligible = edge.vetoEligible ?? strength >= vetoFloor;
  if (!eligible) return false;
  if (edge.source !== "inherited") return true;
  const via = edge.via === undefined ? undefined : byId.get(edge.via);
  if (via === undefined) return false;
  return inheritedRequiresMetaFloor ? via.degrees.metaTrust >= vetoFloor : true;
}

/**
 * Combine contributed scores into one trust-weighted probability, then apply
 * the veto on top of it.
 *
 *   p = sum(w_i * s_i) / sum(w_i)
 *
 * A plain weighted arithmetic mean, which is the literal reading of "a
 * trust-weighted average, not a plain average". Deliberately not a noisy-OR or
 * a Bayesian pool: those change what a score means, and the owner asked for an
 * average that respects closeness, not a different truth model.
 *
 * Order of operations, which matters for what the veto is allowed to touch:
 *   1. weights, then p, summed in hashed-id order for determinism;
 *   2. the contributor floor, which can withhold the aggregate entirely;
 *   3. the threshold, giving allow or deny;
 *   4. the veto, which replaces the decision and never alters p.
 * Step 4 leaving p intact is what makes an override coherent: overriding
 * reveals the probability that was there all along rather than recomputing it.
 *
 * Scores whose `by` matches no edge are dropped rather than given a stranger
 * weight, and counted in `explanation.droppedUnknown`. Silence from someone the
 * owner has no edge to is not evidence, and inventing a default weight for
 * them would be the one place this module could be flooded from outside.
 */
export function combine(
  scores: readonly TrustScore[],
  edges: readonly TrustWeightEdge[],
  opts: CombineOptions = {},
): CombineResult {
  const threshold = opts.threshold ?? DEFAULT_P;
  const decay = opts.distanceDecay ?? DEFAULT_DISTANCE_DECAY;
  const vetoFloor = opts.vetoFloor ?? DEFAULT_VETO_FLOOR;
  const respectVeto = opts.respectVeto ?? true;
  const inheritedRequiresMetaFloor = opts.inheritedVetoRequiresMetaFloor ?? true;
  const minContributors = opts.minContributors ?? DEFAULT_MIN_CONTRIBUTORS;

  const byId = new Map<HashedId, TrustWeightEdge>();
  for (const edge of edges) {
    validateEdge(edge);
    byId.set(edge.id, edge);
  }

  // Sorting by hashed id before summing is what makes the result independent
  // of caller array order and of Map iteration order. Without it a determinism
  // test passes by luck of insertion order.
  const ordered = [...scores].sort((a, b) => (a.by < b.by ? -1 : a.by > b.by ? 1 : 0));

  let weightSum = 0;
  let weightedScoreSum = 0;
  let contributorCount = 0;
  let droppedUnknown = 0;
  let ringsReached = 0;
  let vetoEdge: TrustWeightEdge | null = null;
  let vetoStrength = -1;

  for (const contribution of ordered) {
    const edge = byId.get(contribution.by);
    if (edge === undefined) {
      droppedUnknown += 1;
      continue;
    }
    assertUnitInterval(contribution.score, "score", contribution.by);

    if (contribution.veto === true && vetoBinds(edge, byId, vetoFloor, inheritedRequiresMetaFloor)) {
      // Strongest binding veto wins, ties broken by the id order already
      // imposed above, so the recorded `by` is deterministic.
      const strength = edge.degrees.zutrauen * edge.degrees.vertrauen;
      if (strength > vetoStrength) {
        vetoStrength = strength;
        vetoEdge = edge;
      }
    }

    const w = weightFor(edge, byId, decay);
    if (w <= 0) continue;
    weightSum += w;
    weightedScoreSum += w * contribution.score;
    contributorCount += 1;
    if (edge.distance > ringsReached) ringsReached = edge.distance;
  }

  const enoughContributors = contributorCount >= minContributors && weightSum > 0;
  // Withholding rather than reporting a low p: an aggregate over one or two
  // people is the case k-anonymity exists to suppress, and p would otherwise
  // be that person's own score wearing the aggregate's clothes.
  const p = enoughContributors ? weightedScoreSum / weightSum : 0;
  const thresholdMet = enoughContributors && p >= threshold;

  const vetoSpoken = vetoEdge !== null;
  let decision: CombineDecision;
  if (!enoughContributors) {
    decision = "insufficient";
  } else if (vetoSpoken && respectVeto) {
    decision = "vetoed";
  } else {
    decision = thresholdMet ? "allow" : "deny";
  }

  let overlayKey: OverlayKey | null = null;
  if (!enoughContributors) overlayKey = "insufficient_contributors";
  else if (decision === "vetoed") overlayKey = "veto_spoken";
  else if (vetoSpoken) overlayKey = "veto_alternative_path";

  return {
    p,
    threshold,
    decision,
    veto: { spoken: vetoSpoken, by: vetoEdge === null ? null : vetoEdge.id, overridden: false },
    explanation: {
      contributorCount,
      droppedUnknown,
      ringsReached,
      confidenceBand: bandFor(p),
      thresholdMet,
      vetoSpoken,
      vetoOverridden: false,
      overlayKey,
    },
    overrideLog: [],
  };
}

/**
 * Lift a spoken veto for this one decision, transparently.
 *
 * Pure: returns a new result and mutates nothing. The veto stays recorded as
 * spoken forever; only `overridden` flips, an entry lands in the override log,
 * and the decision falls back to what the probability alone said. The owner
 * ruling is that the veto is "never off the table, just transparently
 * applied", so an override that erased the veto would be the wrong shape.
 *
 * Calling it where no veto was spoken is a caller error rather than a no-op,
 * because it almost always means the caller is overriding a stale result.
 *
 * The threshold defaults to the one the result was already decided against,
 * not to DEFAULT_P, so an override of a custom-threshold combine stays
 * consistent without the caller having to repeat the options.
 */
export function applyVetoOverride(
  result: CombineResult,
  entry: VetoOverrideEntry,
  opts: CombineOptions = {},
): CombineResult {
  if (!result.veto.spoken) {
    throw new TrustWeightingError("no veto was spoken, so there is nothing to override");
  }
  const threshold = opts.threshold ?? result.threshold;
  const decision: CombineDecision =
    result.decision === "insufficient" ? "insufficient" : result.p >= threshold ? "allow" : "deny";

  return {
    ...result,
    threshold,
    decision,
    veto: { ...result.veto, overridden: true },
    explanation: {
      ...result.explanation,
      vetoOverridden: true,
      thresholdMet: decision === "allow",
      overlayKey: result.decision === "insufficient" ? "insufficient_contributors" : "veto_overridden",
    },
    overrideLog: [...result.overrideLog, entry],
  };
}
