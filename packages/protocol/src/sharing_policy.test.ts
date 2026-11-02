// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//
// Sharing policy (docs/design/sharing-policy.md, docs/research/sharing-layer-options.md §2/§4 option B).
// Synthetic ids only ("p1", "g1", "tool"); no person's data. Property tests use a seeded PRNG so a
// failure prints a seed that replays it exactly (no extra dependency; fast-check could replace `forAll`).
import { describe, it, expect } from "vitest";
import {
  checkSharing,
  MAX_GROUP_DEPTH,
  type Grant,
  type SharingGraph,
  type SharingInput,
  type SharingItem,
  type Subject,
  type TagGrant,
} from "./sharing_policy.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const FUTURE = "2027-06-01T00:00:00.000Z";
const PAST = "2026-01-01T00:00:00.000Z";

const g = (subject: Subject, expiresAt = FUTURE): Grant => ({ subject, expiresAt });
const item = (o: Partial<SharingItem> = {}): SharingItem => ({ id: "i1", tags: [], viewers: [], blocks: [], ...o });
const input = (o: Partial<SharingInput> = {}): SharingInput => ({
  graph: { persons: {}, groups: {} },
  tagGrants: [],
  item: item(),
  asker: "p1",
  now: NOW,
  ...o,
});

describe("defaults (I9: conservative)", () => {
  it("denies when nothing grants", () => {
    expect(checkSharing(input()).eligible).toBe(false);
  });
  it("denies an asker the graph has never heard of, even with zone/group/tag grants", () => {
    const d = checkSharing(
      input({
        asker: "stranger",
        item: item({ tags: ["tool"], viewers: [g({ kind: "zone", level: "contact" }), g({ kind: "group", id: "g1" })] }),
        tagGrants: [{ tag: "tool", grant: g({ kind: "person_tag", tag: "neighbour" }) }],
      }),
    );
    expect(d.eligible).toBe(false);
  });
});

describe("grants", () => {
  it("direct person grant", () => {
    expect(checkSharing(input({ item: item({ viewers: [g({ kind: "person", id: "p1" })] }) })).eligible).toBe(true);
  });
  it("zone grant covers that zone and every inner zone (close ⊂ friend ⊂ contact)", () => {
    const graph: SharingGraph = {
      persons: {
        a: { zone: { level: "contact", expiresAt: FUTURE } },
        b: { zone: { level: "friend", expiresAt: FUTURE } },
        c: { zone: { level: "close", expiresAt: FUTURE } },
      },
      groups: {},
    };
    const it1 = item({ viewers: [g({ kind: "zone", level: "friend" })] });
    expect(checkSharing(input({ graph, item: it1, asker: "a" })).eligible).toBe(false);
    expect(checkSharing(input({ graph, item: it1, asker: "b" })).eligible).toBe(true);
    expect(checkSharing(input({ graph, item: it1, asker: "c" })).eligible).toBe(true);
  });
  it("group grant, including a nested group (members of a child group belong to its parent)", () => {
    const graph: SharingGraph = {
      persons: { p1: { groups: ["child"] } },
      groups: { child: { memberOf: ["parent"] }, parent: {} },
    };
    const viaParent = item({ viewers: [g({ kind: "group", id: "parent" })] });
    expect(checkSharing(input({ graph, item: viaParent })).eligible).toBe(true);
  });
  it("tag grant: an owner-level rule 'items tagged T are visible to S' applies via the item's tags", () => {
    const tagGrants: TagGrant[] = [{ tag: "tool", grant: g({ kind: "zone", level: "friend" }) }];
    const graph: SharingGraph = { persons: { p1: { zone: { level: "friend", expiresAt: FUTURE } } }, groups: {} };
    expect(checkSharing(input({ graph, tagGrants, item: item({ tags: ["tool"] }) })).eligible).toBe(true);
    expect(checkSharing(input({ graph, tagGrants, item: item({ tags: ["book"] }) })).eligible).toBe(false);
  });
  it("tag on persons: a grant to 'persons tagged T'", () => {
    const graph: SharingGraph = { persons: { p1: { tags: ["neighbour"] }, p2: {} }, groups: {} };
    const it1 = item({ viewers: [g({ kind: "person_tag", tag: "neighbour" })] });
    expect(checkSharing(input({ graph, item: it1, asker: "p1" })).eligible).toBe(true);
    expect(checkSharing(input({ graph, item: it1, asker: "p2" })).eligible).toBe(false);
  });
});

describe("per-person block beats every grant (R4)", () => {
  const graph: SharingGraph = {
    persons: { p1: { zone: { level: "close", expiresAt: FUTURE }, tags: ["neighbour"], groups: ["g1"] } },
    groups: { g1: {} },
  };
  const everyGrant = [
    g({ kind: "person", id: "p1" }),
    g({ kind: "zone", level: "contact" }),
    g({ kind: "group", id: "g1" }),
    g({ kind: "person_tag", tag: "neighbour" }),
  ];
  it.each<Subject>([{ kind: "person", id: "p1" }, { kind: "group", id: "g1" }])("block by %j", (block) => {
    const open = item({ tags: ["tool"], viewers: everyGrant });
    expect(checkSharing(input({ graph, item: open })).eligible).toBe(true);
    const d = checkSharing(input({ graph, item: { ...open, blocks: [block] }, tagGrants: [{ tag: "tool", grant: everyGrant[1]! }] }));
    expect(d.eligible).toBe(false);
    expect(d.audit.join("\n")).toContain("blocked");
  });
  it("a block does not expire (fail closed)", () => {
    const d = checkSharing(input({ graph, now: new Date("2099-01-01T00:00:00Z"), item: item({ viewers: [g({ kind: "person", id: "p1" }, "2100-01-01T00:00:00Z")], blocks: [{ kind: "person", id: "p1" }] }) }));
    expect(d.eligible).toBe(false);
  });
});

describe("expiry (I9: +1y)", () => {
  it("an expired grant gives nothing", () => {
    expect(checkSharing(input({ item: item({ viewers: [g({ kind: "person", id: "p1" }, PAST)] }) })).eligible).toBe(false);
  });
  it("an expired zone assertion puts the person in no zone", () => {
    const graph: SharingGraph = { persons: { p1: { zone: { level: "close", expiresAt: PAST } } }, groups: {} };
    expect(checkSharing(input({ graph, item: item({ viewers: [g({ kind: "zone", level: "contact" })] }) })).eligible).toBe(false);
  });
  it("an unparseable expiry counts as expired", () => {
    expect(checkSharing(input({ item: item({ viewers: [g({ kind: "person", id: "p1" }, "not-a-date")] }) })).eligible).toBe(false);
  });
});

describe("group nesting is capped and cycle-safe", () => {
  it("stops at MAX_GROUP_DEPTH", () => {
    const groups: SharingGraph["groups"] = {};
    for (let i = 0; i < MAX_GROUP_DEPTH + 2; i++) groups[`g${i}`] = { memberOf: [`g${i + 1}`] };
    groups[`g${MAX_GROUP_DEPTH + 2}`] = {};
    const graph: SharingGraph = { persons: { p1: { groups: ["g0"] } }, groups };
    const reachable = item({ viewers: [g({ kind: "group", id: `g${MAX_GROUP_DEPTH}` })] });
    const tooFar = item({ viewers: [g({ kind: "group", id: `g${MAX_GROUP_DEPTH + 2}` })] });
    expect(checkSharing(input({ graph, item: reachable })).eligible).toBe(true);
    expect(checkSharing(input({ graph, item: tooFar })).eligible).toBe(false);
  });
  it("terminates on a cycle", () => {
    const graph: SharingGraph = { persons: { p1: { groups: ["a"] } }, groups: { a: { memberOf: ["b"] }, b: { memberOf: ["a"] } } };
    expect(checkSharing(input({ graph, item: item({ viewers: [g({ kind: "group", id: "b" })] }) })).eligible).toBe(true);
  });
});

describe("audit (I6) and purity", () => {
  it("names the grant path in human-readable lines", () => {
    const d = checkSharing(input({ item: item({ viewers: [g({ kind: "person", id: "p1" })] }) }));
    expect(d.audit.join("\n")).toContain("allowed");
    expect(d.audit.join("\n")).toContain("p1");
  });
  it("does not mutate its inputs", () => {
    const i = input({ graph: { persons: { p1: { tags: ["x"], groups: ["g"] } }, groups: { g: {} } }, item: item({ tags: ["t"], viewers: [g({ kind: "group", id: "g" })] }) });
    const before = JSON.stringify(i);
    checkSharing(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});

// ---------------------------------------------------------------- property tests

/** mulberry32: small seeded PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RUNS = 300;
function forAll(name: string, prop: (r: () => number, seed: number) => void): void {
  it(`property: ${name} (${RUNS} seeded runs)`, () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      try {
        prop(rng(seed), seed);
      } catch (e) {
        throw new Error(`failed at seed ${seed}: ${(e as Error).message}`);
      }
    }
  });
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const some = <T,>(r: () => number, xs: readonly T[], max: number): T[] => Array.from({ length: Math.floor(r() * (max + 1)) }, () => pick(r, xs));
const PEOPLE = ["p1", "p2", "p3", "p4"] as const;
const GROUPS = ["g1", "g2", "g3", "g4"] as const;
const TAGS = ["t1", "t2", "t3"] as const;
const PTAGS = ["n1", "n2"] as const;
const LEVELS = ["contact", "friend", "close"] as const;
const RANK = { contact: 1, friend: 2, close: 3 } as const;
const exp = (r: () => number): string => (r() < 0.7 ? FUTURE : PAST);

function genSubject(r: () => number): Subject {
  switch (Math.floor(r() * 4)) {
    case 0: return { kind: "person", id: pick(r, PEOPLE) };
    case 1: return { kind: "group", id: pick(r, GROUPS) };
    case 2: return { kind: "zone", level: pick(r, LEVELS) };
    default: return { kind: "person_tag", tag: pick(r, PTAGS) };
  }
}
function genGraph(r: () => number): SharingGraph {
  const persons: SharingGraph["persons"] = {};
  for (const p of PEOPLE) {
    if (r() < 0.2) continue; // some people are unknown to the graph
    persons[p] = {
      ...(r() < 0.8 ? { zone: { level: pick(r, LEVELS), expiresAt: exp(r) } } : {}),
      tags: some(r, PTAGS, 2),
      groups: some(r, GROUPS, 2),
    };
  }
  const groups: SharingGraph["groups"] = {};
  for (const gr of GROUPS) groups[gr] = { memberOf: some(r, GROUPS, 2) }; // cycles allowed on purpose
  return { persons, groups };
}
function genInput(r: () => number): SharingInput {
  return {
    graph: genGraph(r),
    tagGrants: some(r, TAGS, 3).map((tag) => ({ tag, grant: g(genSubject(r), exp(r)) })),
    item: {
      id: "i",
      tags: some(r, TAGS, 3),
      viewers: Array.from({ length: Math.floor(r() * 4) }, () => g(genSubject(r), exp(r))),
      blocks: [],
    },
    asker: pick(r, PEOPLE),
    now: NOW,
  };
}
const withBlock = (i: SharingInput, s: Subject): SharingInput => ({ ...i, item: { ...i.item, blocks: [...i.item.blocks, s] } });

describe("properties", () => {
  forAll("no grants at all => never eligible", (r) => {
    const i = genInput(r);
    expect(checkSharing({ ...i, tagGrants: [], item: { ...i.item, viewers: [] } }).eligible).toBe(false);
  });

  forAll("a block on the asker (person) always wins, whatever grants exist", (r) => {
    const i = genInput(r);
    expect(checkSharing(withBlock(i, { kind: "person", id: i.asker })).eligible).toBe(false);
  });

  forAll("a block on a group the asker directly belongs to always wins", (r) => {
    const i = genInput(r);
    const mine = i.graph.persons[i.asker]?.groups ?? [];
    if (mine.length === 0) return;
    expect(checkSharing(withBlock(i, { kind: "group", id: mine[0]! })).eligible).toBe(false);
  });

  forAll("adding a grant never revokes access (monotonic, blocks fixed)", (r) => {
    const i = genInput(r);
    const before = checkSharing(i).eligible;
    const after = checkSharing({ ...i, item: { ...i.item, viewers: [...i.item.viewers, g(genSubject(r), exp(r))] } }).eligible;
    if (before) expect(after).toBe(true);
  });

  forAll("raising the asker's zone never removes access gained through zone grants only", (r) => {
    const i = genInput(r);
    const zoneOnly: SharingInput = { ...i, tagGrants: [], item: { ...i.item, viewers: i.item.viewers.filter((v) => v.subject.kind === "zone") } };
    const person = zoneOnly.graph.persons[zoneOnly.asker];
    if (!person?.zone) return;
    const lower = checkSharing(zoneOnly).eligible;
    const raised = { ...person, zone: { level: "close" as const, expiresAt: FUTURE } };
    const higher = checkSharing({ ...zoneOnly, graph: { ...zoneOnly.graph, persons: { ...zoneOnly.graph.persons, [zoneOnly.asker]: raised } } }).eligible;
    if (lower) expect(higher).toBe(true);
    expect(RANK[raised.zone.level]).toBe(3);
  });

  forAll("after every grant has expired, nobody is eligible", (r) => {
    const i = genInput(r);
    const far = new Date("2100-01-01T00:00:00Z");
    expect(checkSharing({ ...i, now: far }).eligible).toBe(false);
  });

  forAll("deterministic and independent of grant order", (r) => {
    const i = genInput(r);
    const rev: SharingInput = { ...i, tagGrants: [...i.tagGrants].reverse(), item: { ...i.item, viewers: [...i.item.viewers].reverse() } };
    expect(checkSharing(rev).eligible).toBe(checkSharing(i).eligible);
    expect(checkSharing(i)).toEqual(checkSharing(i));
  });

  forAll("rule-scan cost depends on the policy, never on who asks or on the outcome (I3 groundwork)", (r) => {
    const i = genInput(r);
    const costs = new Set([...PEOPLE, "stranger"].map((asker) => checkSharing({ ...i, asker }).cost));
    expect(costs.size).toBe(1);
    expect(checkSharing(withBlock(i, { kind: "person", id: i.asker })).cost - 1).toBe(checkSharing(i).cost);
  });
});
