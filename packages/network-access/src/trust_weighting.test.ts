import { describe, expect, it } from "vitest";
import {
  applyVetoOverride,
  combine,
  DEFAULT_DISTANCE_DECAY,
  DEFAULT_MIN_CONTRIBUTORS,
  DEFAULT_P,
  DEFAULT_VETO_FLOOR,
  TrustWeightingError,
  type TrustScore,
  type TrustWeightEdge,
} from "./trust_weighting.js";

// Distinctive ids, so the "explanation leaks nothing" test can look for them
// as substrings and actually mean something.
const CLOSE = "h:alpha-9f1c";
const DISTANT = "h:bravo-73ae";
const THIRD = "h:charlie-21bd";
const STRANGER = "h:delta-unknown-0000";

function edge(over: Partial<TrustWeightEdge> & { id: string }): TrustWeightEdge {
  return {
    degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 1 },
    distance: 1,
    source: "manual",
    ...over,
  };
}

/** The worked example carried through the spec: one close voice, one distant. */
function workedExample(): { scores: TrustScore[]; edges: TrustWeightEdge[] } {
  return {
    // weight 1.0 * 0.9 * decay^0 = 0.9
    // weight 0.8 * 0.5 * decay^1 = 0.2
    edges: [
      edge({ id: CLOSE, degrees: { zutrauen: 1, vertrauen: 0.9, metaTrust: 1 }, distance: 1 }),
      edge({ id: DISTANT, degrees: { zutrauen: 0.8, vertrauen: 0.5, metaTrust: 1 }, distance: 2 }),
    ],
    scores: [
      { by: CLOSE, score: 0.9 },
      { by: DISTANT, score: 0.5 },
    ],
  };
}

describe("constants", () => {
  it("declares one probability threshold of 0.8", () => {
    expect(DEFAULT_P).toBe(0.8);
  });

  it("keeps the veto floor below the probability threshold", () => {
    expect(DEFAULT_VETO_FLOOR).toBeLessThan(DEFAULT_P);
  });
});

describe("weighted versus plain average", () => {
  it("lets a close high estimate outweigh a distant low one", () => {
    const { scores, edges } = workedExample();
    const plain = (0.9 + 0.5) / 2;
    const result = combine(scores, edges, { minContributors: 2 });

    expect(plain).toBeCloseTo(0.7, 10);
    expect(result.p).toBeCloseTo((0.9 * 0.9 + 0.2 * 0.5) / (0.9 + 0.2), 10);
    expect(result.p).toBeCloseTo(0.8272727, 6);
    // The whole point of B-20: the plain mean denies, the weighted mean allows.
    expect(plain).toBeLessThan(DEFAULT_P);
    expect(result.p).toBeGreaterThan(DEFAULT_P);
    expect(result.decision).toBe("allow");
  });

  it("agrees with the plain mean when every weight is equal", () => {
    const edges = [edge({ id: CLOSE }), edge({ id: DISTANT }), edge({ id: THIRD })];
    const scores: TrustScore[] = [
      { by: CLOSE, score: 0.2 },
      { by: DISTANT, score: 0.5 },
      { by: THIRD, score: 0.8 },
    ];
    expect(combine(scores, edges).p).toBeCloseTo(0.5, 10);
  });

  it("attenuates each further ring by the decay base", () => {
    const near = combine([{ by: CLOSE, score: 1 }, { by: DISTANT, score: 0 }], [
      edge({ id: CLOSE, distance: 1 }),
      edge({ id: DISTANT, distance: 2 }),
    ], { minContributors: 2 });
    // 1 * 1 + 0.5 * 0, over 1.5
    expect(near.p).toBeCloseTo(1 / (1 + DEFAULT_DISTANCE_DECAY), 10);
  });
});

describe("threshold", () => {
  it("allows at exactly 0.8", () => {
    const edges = [edge({ id: CLOSE }), edge({ id: DISTANT })];
    const result = combine([
      { by: CLOSE, score: 0.8 },
      { by: DISTANT, score: 0.8 },
    ], edges, { minContributors: 2 });
    expect(result.p).toBe(0.8);
    expect(result.decision).toBe("allow");
    expect(result.explanation.thresholdMet).toBe(true);
  });

  it("denies just below 0.8", () => {
    const edges = [edge({ id: CLOSE }), edge({ id: DISTANT })];
    const result = combine([
      { by: CLOSE, score: 0.8 },
      { by: DISTANT, score: 0.79 },
    ], edges, { minContributors: 2 });
    expect(result.p).toBeCloseTo(0.795, 10);
    expect(result.decision).toBe("deny");
    expect(result.explanation.thresholdMet).toBe(false);
  });

  it("honours a caller-supplied threshold", () => {
    const edges = [edge({ id: CLOSE }), edge({ id: DISTANT })];
    const scores: TrustScore[] = [
      { by: CLOSE, score: 0.6 },
      { by: DISTANT, score: 0.6 },
    ];
    expect(combine(scores, edges, { minContributors: 2 }).decision).toBe("deny");
    expect(combine(scores, edges, { minContributors: 2, threshold: 0.6 }).decision).toBe("allow");
  });
});

describe("meta-trust governs the second hop only", () => {
  it("does not let an edge's own meta-trust touch its own contribution", () => {
    const scores: TrustScore[] = [
      { by: CLOSE, score: 1 },
      { by: DISTANT, score: 0 },
      { by: THIRD, score: 0 },
    ];
    const high = [
      edge({ id: CLOSE, degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 1 } }),
      edge({ id: DISTANT }),
      edge({ id: THIRD }),
    ];
    const low = [
      edge({ id: CLOSE, degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 0 } }),
      edge({ id: DISTANT }),
      edge({ id: THIRD }),
    ];
    expect(combine(scores, low).p).toBe(combine(scores, high).p);
  });

  it("attenuates an inherited contribution by the via edge's meta-trust", () => {
    const delegate = (metaTrust: number): TrustWeightEdge =>
      edge({ id: CLOSE, degrees: { zutrauen: 1, vertrauen: 1, metaTrust } });
    const inherited = edge({
      id: DISTANT,
      distance: 2,
      source: "inherited",
      via: CLOSE,
      degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 1 },
    });
    const scores: TrustScore[] = [
      { by: CLOSE, score: 1 },
      { by: DISTANT, score: 0 },
    ];

    // via meta-trust 1.0: inherited weight = 1 * 0.5 * 1.0 = 0.5, p = 1/1.5
    const viaMetaHigh = combine(scores, [delegate(1), inherited], { minContributors: 2 });
    // via meta-trust 0.5: inherited weight = 1 * 0.5 * 0.5 = 0.25, p = 1/1.25
    const viaMetaLow = combine(scores, [delegate(0.5), inherited], { minContributors: 2 });

    expect(viaMetaHigh.p).toBeCloseTo(1 / 1.5, 10);
    expect(viaMetaLow.p).toBeCloseTo(1 / 1.25, 10);
    // Lower meta-trust shrinks the inherited weight, so p moves TOWARDS the
    // first-ring reading. Here the inherited voice reports 0.0 and the
    // first-ring voice 1.0, so p rises. Reporting the other way round it would
    // fall. This assertion pins weight magnitude, not a direction of belief.
    expect(viaMetaLow.p).toBeGreaterThan(viaMetaHigh.p);
  });

  it("moves p towards the first ring in either direction as meta-trust falls", () => {
    // Mirror of the case above with the reports swapped, so the sign of the
    // change cannot be mistaken for meta-trust being inverted.
    const delegate = (metaTrust: number): TrustWeightEdge =>
      edge({ id: CLOSE, degrees: { zutrauen: 1, vertrauen: 1, metaTrust } });
    const inherited = edge({
      id: DISTANT,
      distance: 2,
      source: "inherited",
      via: CLOSE,
      degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 1 },
    });
    const swapped: TrustScore[] = [
      { by: CLOSE, score: 0 },
      { by: DISTANT, score: 1 },
    ];
    const viaMetaHigh = combine(swapped, [delegate(1), inherited], { minContributors: 2 });
    const viaMetaLow = combine(swapped, [delegate(0.5), inherited], { minContributors: 2 });

    expect(viaMetaHigh.p).toBeCloseTo(0.5 / 1.5, 10);
    expect(viaMetaLow.p).toBeCloseTo(0.25 / 1.25, 10);
    expect(viaMetaLow.p).toBeLessThan(viaMetaHigh.p);
  });

  it("treats an algorithm or AI delegated edge like a manual one arithmetically", () => {
    const scores: TrustScore[] = [
      { by: CLOSE, score: 0.9 },
      { by: DISTANT, score: 0.9 },
      { by: THIRD, score: 0.9 },
    ];
    const manual = [edge({ id: CLOSE }), edge({ id: DISTANT }), edge({ id: THIRD })];
    const delegated = [
      edge({ id: CLOSE, source: "algorithm" }),
      edge({ id: DISTANT, source: "ai" }),
      edge({ id: THIRD, source: "manual" }),
    ];
    expect(combine(scores, delegated).p).toBe(combine(scores, manual).p);
  });

  it("drops an inherited contribution whose via edge is absent", () => {
    const orphan = edge({ id: DISTANT, distance: 2, source: "inherited", via: "h:missing" });
    const result = combine([
      { by: CLOSE, score: 1 },
      { by: DISTANT, score: 0 },
    ], [edge({ id: CLOSE }), orphan], { minContributors: 1 });
    expect(result.explanation.contributorCount).toBe(1);
    expect(result.p).toBe(1);
  });
});

describe("veto", () => {
  const eligible = edge({ id: THIRD, degrees: { zutrauen: 0.9, vertrauen: 0.9, metaTrust: 0.9 } });
  const edges = [edge({ id: CLOSE }), edge({ id: DISTANT }), eligible];
  const scores: TrustScore[] = [
    { by: CLOSE, score: 0.95 },
    { by: DISTANT, score: 0.95 },
    { by: THIRD, score: 0.95, veto: true },
  ];

  it("blocks by default and leaves the probability untouched", () => {
    const result = combine(scores, edges);
    expect(result.decision).toBe("vetoed");
    expect(result.p).toBeCloseTo(0.95, 10);
    expect(result.veto).toEqual({ spoken: true, by: THIRD, overridden: false });
    expect(result.explanation.overlayKey).toBe("veto_spoken");
  });

  it("ignores a veto from an edge below the eligibility floor", () => {
    const weak = edge({ id: THIRD, degrees: { zutrauen: 0.5, vertrauen: 0.5, metaTrust: 1 } });
    const result = combine(scores, [edge({ id: CLOSE }), edge({ id: DISTANT }), weak]);
    expect(result.veto.spoken).toBe(false);
    expect(result.veto.by).toBeNull();
    expect(result.decision).toBe("allow");
  });

  it("respects an explicit vetoEligible override in both directions", () => {
    const forced = edge({
      id: THIRD,
      degrees: { zutrauen: 0.1, vertrauen: 0.1, metaTrust: 1 },
      vetoEligible: true,
    });
    expect(combine(scores, [edge({ id: CLOSE }), edge({ id: DISTANT }), forced]).decision).toBe("vetoed");

    const silenced = edge({
      id: THIRD,
      degrees: { zutrauen: 0.9, vertrauen: 0.9, metaTrust: 1 },
      vetoEligible: false,
    });
    expect(combine(scores, [edge({ id: CLOSE }), edge({ id: DISTANT }), silenced]).decision).toBe("allow");
  });

  it("records the strongest binding veto deterministically", () => {
    const strong = edge({ id: THIRD, degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 1 } });
    const weaker = edge({ id: DISTANT, degrees: { zutrauen: 0.8, vertrauen: 0.95, metaTrust: 1 } });
    const result = combine([
      { by: CLOSE, score: 0.9 },
      { by: DISTANT, score: 0.9, veto: true },
      { by: THIRD, score: 0.9, veto: true },
    ], [edge({ id: CLOSE }), weaker, strong]);
    expect(result.veto.by).toBe(THIRD);
  });

  it("stays transparent when the owner chose not to respect it", () => {
    const result = combine(scores, edges, { respectVeto: false });
    expect(result.decision).toBe("allow");
    expect(result.veto.spoken).toBe(true);
    expect(result.explanation.overlayKey).toBe("veto_alternative_path");
  });

  it("requires the via edge's meta-trust for an inherited veto to bind", () => {
    const inheritedVeto = edge({
      id: THIRD,
      distance: 2,
      source: "inherited",
      via: CLOSE,
      degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 1 },
    });
    const withScores: TrustScore[] = [
      { by: CLOSE, score: 0.95 },
      { by: DISTANT, score: 0.95 },
      { by: THIRD, score: 0.95, veto: true },
    ];
    const lowMeta = edge({ id: CLOSE, degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 0.2 } });
    const highMeta = edge({ id: CLOSE, degrees: { zutrauen: 1, vertrauen: 1, metaTrust: 0.95 } });

    expect(combine(withScores, [lowMeta, edge({ id: DISTANT }), inheritedVeto]).veto.spoken).toBe(false);
    expect(combine(withScores, [highMeta, edge({ id: DISTANT }), inheritedVeto]).veto.spoken).toBe(true);
    // The floor can be waived deliberately, never silently.
    expect(
      combine(withScores, [lowMeta, edge({ id: DISTANT }), inheritedVeto], {
        inheritedVetoRequiresMetaFloor: false,
      }).veto.spoken,
    ).toBe(true);
  });
});

describe("applyVetoOverride", () => {
  const edges = [
    edge({ id: CLOSE }),
    edge({ id: DISTANT }),
    edge({ id: THIRD, degrees: { zutrauen: 0.9, vertrauen: 0.9, metaTrust: 0.9 } }),
  ];

  it("passes the decision through while keeping the veto on the record", () => {
    const blocked = combine([
      { by: CLOSE, score: 0.95 },
      { by: DISTANT, score: 0.95 },
      { by: THIRD, score: 0.95, veto: true },
    ], edges);
    const overridden = applyVetoOverride(blocked, { at: 1_757_000_000_000, reason: "checked directly" });

    expect(overridden.decision).toBe("allow");
    expect(overridden.p).toBe(blocked.p);
    expect(overridden.veto).toEqual({ spoken: true, by: THIRD, overridden: true });
    expect(overridden.explanation.vetoSpoken).toBe(true);
    expect(overridden.explanation.vetoOverridden).toBe(true);
    expect(overridden.explanation.overlayKey).toBe("veto_overridden");
    expect(overridden.overrideLog).toEqual([{ at: 1_757_000_000_000, reason: "checked directly" }]);
    // Pure: the original result is untouched.
    expect(blocked.veto.overridden).toBe(false);
    expect(blocked.overrideLog).toEqual([]);
  });

  it("still denies when the probability alone did not clear the threshold", () => {
    const blocked = combine([
      { by: CLOSE, score: 0.4 },
      { by: DISTANT, score: 0.4 },
      { by: THIRD, score: 0.4, veto: true },
    ], edges);
    expect(blocked.decision).toBe("vetoed");
    expect(applyVetoOverride(blocked, { at: 1 }).decision).toBe("deny");
  });

  it("reuses the threshold the result was decided against", () => {
    const scores: TrustScore[] = [
      { by: CLOSE, score: 0.65 },
      { by: DISTANT, score: 0.65 },
      { by: THIRD, score: 0.65, veto: true },
    ];
    const blocked = combine(scores, edges, { threshold: 0.6 });
    expect(blocked.threshold).toBe(0.6);
    expect(blocked.decision).toBe("vetoed");
    // Without the carried threshold this would silently fall back to 0.8 and
    // deny an unchanged p of 0.65.
    expect(applyVetoOverride(blocked, { at: 1 }).decision).toBe("allow");
    // An explicit opts threshold still wins, for a deliberate re-evaluation.
    expect(applyVetoOverride(blocked, { at: 1 }, { threshold: 0.9 }).decision).toBe("deny");
  });

  it("refuses to override where no veto was spoken", () => {
    const clean = combine([
      { by: CLOSE, score: 0.9 },
      { by: DISTANT, score: 0.9 },
      { by: THIRD, score: 0.9 },
    ], edges);
    expect(() => applyVetoOverride(clean, { at: 1 })).toThrow(TrustWeightingError);
  });
});

describe("explanation carries no hidden weights", () => {
  it("names nobody and repeats no degree", () => {
    const { scores, edges } = workedExample();
    const withVeto: TrustScore[] = [
      ...scores,
      { by: THIRD, score: 0.4, veto: true },
      { by: STRANGER, score: 1 },
    ];
    const allEdges = [
      ...edges,
      edge({ id: THIRD, degrees: { zutrauen: 0.93, vertrauen: 0.87, metaTrust: 0.71 } }),
    ];
    const result = combine(withVeto, allEdges, { minContributors: 2 });
    const rendered = JSON.stringify(result.explanation);

    for (const id of [CLOSE, DISTANT, THIRD, STRANGER]) {
      expect(rendered).not.toContain(id);
    }
    for (const degree of ["0.93", "0.87", "0.71", "0.9", "0.8", "0.5"]) {
      expect(rendered).not.toContain(degree);
    }
    // The raw probability is owner-side; the overlay gets a band instead.
    expect(rendered).not.toContain(String(result.p));
    expect(result.explanation.confidenceBand).toBe("moderate");
    // veto.by lives outside the render-safe subtree, and is populated there.
    expect(result.veto.by).toBe(THIRD);
    expect(Object.keys(result.explanation)).not.toContain("by");
  });

  it("reports unmatched contributions as dropped rather than weighting them", () => {
    const { scores, edges } = workedExample();
    const result = combine([...scores, { by: STRANGER, score: 1 }], edges, { minContributors: 2 });
    expect(result.explanation.droppedUnknown).toBe(1);
    expect(result.explanation.contributorCount).toBe(2);
    expect(result.p).toBeCloseTo(0.8272727, 6);
  });
});

describe("degenerate input", () => {
  it("withholds the aggregate below the contributor floor", () => {
    const result = combine([{ by: CLOSE, score: 1 }], [edge({ id: CLOSE })]);
    expect(DEFAULT_MIN_CONTRIBUTORS).toBe(3);
    expect(result.decision).toBe("insufficient");
    expect(result.p).toBe(0);
    expect(result.explanation.overlayKey).toBe("insufficient_contributors");
  });

  it("returns a defined result for no scores at all", () => {
    const result = combine([], []);
    expect(result.decision).toBe("insufficient");
    expect(result.p).toBe(0);
    expect(Number.isNaN(result.p)).toBe(false);
    expect(result.explanation.contributorCount).toBe(0);
  });

  it("does not divide by zero when every weight collapses", () => {
    const zeroed = [
      edge({ id: CLOSE, degrees: { zutrauen: 0, vertrauen: 1, metaTrust: 1 } }),
      edge({ id: DISTANT, degrees: { zutrauen: 1, vertrauen: 0, metaTrust: 1 } }),
      edge({ id: THIRD, degrees: { zutrauen: 0, vertrauen: 0, metaTrust: 1 } }),
    ];
    const result = combine([
      { by: CLOSE, score: 1 },
      { by: DISTANT, score: 1 },
      { by: THIRD, score: 1 },
    ], zeroed);
    expect(Number.isNaN(result.p)).toBe(false);
    expect(result.p).toBe(0);
    expect(result.decision).toBe("insufficient");
  });

  it("rejects degrees outside the unit interval and bad distances", () => {
    expect(() => combine([], [edge({ id: CLOSE, degrees: { zutrauen: 1.2, vertrauen: 1, metaTrust: 1 } })])).toThrow(
      TrustWeightingError,
    );
    expect(() => combine([], [edge({ id: CLOSE, distance: 0 })])).toThrow(TrustWeightingError);
    expect(() => combine([], [edge({ id: CLOSE, distance: 1.5 })])).toThrow(TrustWeightingError);
    expect(() => combine([{ by: CLOSE, score: 2 }], [edge({ id: CLOSE })])).toThrow(TrustWeightingError);
    expect(() => combine([], [edge({ id: CLOSE, source: "inherited" })])).toThrow(TrustWeightingError);
  });
});

describe("determinism", () => {
  it("gives an identical result whatever order the contributions arrive in", () => {
    const edges = [
      edge({ id: THIRD, degrees: { zutrauen: 0.71, vertrauen: 0.93, metaTrust: 0.4 } }),
      edge({ id: CLOSE, degrees: { zutrauen: 0.87, vertrauen: 0.62, metaTrust: 0.9 } }),
      edge({ id: DISTANT, distance: 2, source: "inherited", via: CLOSE, degrees: { zutrauen: 0.55, vertrauen: 0.77, metaTrust: 0.3 } }),
    ];
    const scores: TrustScore[] = [
      { by: CLOSE, score: 0.83 },
      { by: DISTANT, score: 0.41 },
      { by: THIRD, score: 0.67 },
    ];
    const forward = combine(scores, edges);
    const reversed = combine([...scores].reverse(), [...edges].reverse());
    const shuffled = combine([scores[2], scores[0], scores[1]], [edges[1], edges[2], edges[0]]);

    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
    // Bit-identical, not merely close: the sum order is pinned, not lucky.
    expect(reversed.p).toBe(forward.p);
    expect(shuffled.p).toBe(forward.p);
  });

  it("repeats itself across calls", () => {
    const { scores, edges } = workedExample();
    expect(combine(scores, edges, { minContributors: 2 })).toEqual(combine(scores, edges, { minContributors: 2 }));
  });
});
