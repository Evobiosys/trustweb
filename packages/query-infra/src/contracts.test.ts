import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContractError,
  MIN_K,
  createContract,
  currentContractsView,
  effectiveK,
  effectiveKFor,
  listAllContractsRaw,
  revokeContract,
  verifyContract,
} from "./contracts.js";
import { loadOrCreateSecret } from "./templates.js";
import { DEFAULT_K, MIN_K as MIN_K_FROM_NETWORK_ACCESS } from "@resource-web/network-access";

let dir: string;
let secretPath: string;
let storePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "na-contracts-"));
  secretPath = join(dir, "peer_contracts.secret");
  storePath = join(dir, "peer_contracts.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DEFAULT_K", () => {
  // One floor for the workspace, exported by @resource-web/network-access.
  // The fork's 7 (Jakob, 2026-08-25) is recorded in that module's comment and
  // is retuned by the C-08 prevalence run, not here.
  it("is the trunk floor of 3, read from the one exported constant", () => {
    expect(DEFAULT_K).toBe(3);
  });
});

describe("MIN_K is tied to DEFAULT_K", () => {
  // The point of these three cases is the RELATIONSHIP, not the number. When
  // C-08 retunes DEFAULT_K, a hard-coded 2 would silently widen the gap the
  // mutual-flag guardrail is supposed to keep narrow; these fail instead.
  it("is exactly one step below the default, never below 2", () => {
    expect(MIN_K).toBe(Math.max(2, DEFAULT_K - 1));
  });

  it("always leaves the default strictly above it, so lowering means something", () => {
    expect(MIN_K).toBeLessThan(DEFAULT_K);
    expect(MIN_K).toBeGreaterThanOrEqual(2);
  });

  it("is the very same constant contracts.ts re-exports, not a second copy", () => {
    expect(MIN_K).toBe(MIN_K_FROM_NETWORK_ACCESS);
    // and, at today's DEFAULT_K of 3, still the value the port carried across
    expect(MIN_K).toBe(2);
  });
});

describe("effectiveKFor — no contract on file", () => {
  it("falls back to the default for an unknown peer", () => {
    expect(effectiveKFor([], "anna@example.org")).toBe(DEFAULT_K);
    expect(effectiveKFor([], "anna@example.org", 12)).toBe(12);
  });
});

describe("createContract", () => {
  it("appends a signed, verifiable record raising k above the default — no mutual flag needed", () => {
    const c = createContract(secretPath, storePath, {
      peer_id: "trusted-org@example.org",
      k_floor: 12,
      mutual: false,
      reference: "https://consensu.al/agreements/abc123",
    });
    expect(c.id).toBeTruthy();
    expect(c.sig).toBeTruthy();
    const secret = loadOrCreateSecret(secretPath);
    expect(verifyContract(secret, c)).toBe(true);
    const view = currentContractsView(storePath, secret);
    expect(view).toHaveLength(1);
    expect(view[0]!.k_floor).toBe(12);
    expect(view[0]!.reference).toBe("https://consensu.al/agreements/abc123");
  });

  it("rejects an empty peer_id and a non-integer k_floor", () => {
    expect(() =>
      createContract(secretPath, storePath, { peer_id: "  ", k_floor: 8, mutual: false }),
    ).toThrow(ContractError);
    expect(() =>
      createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 3.5, mutual: false }),
    ).toThrow(ContractError);
  });

  it("refuses k_floor below MIN_K even with mutual:true — k=1 identifies individuals outright", () => {
    expect(() =>
      createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 1, mutual: true }),
    ).toThrow(ContractError);
    expect(() =>
      createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 0, mutual: true }),
    ).toThrow(ContractError);
  });

  it("mutual-flag requirement: refuses to lower k below the default without mutual:true", () => {
    expect(() =>
      createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: DEFAULT_K - 1, mutual: false }),
    ).toThrow(ContractError);
  });

  it("mutual-flag requirement: allows lowering k below the default when mutual:true", () => {
    const c = createContract(secretPath, storePath, {
      peer_id: "close-friend@example.org",
      k_floor: MIN_K,
      mutual: true,
    });
    expect(c.k_floor).toBe(MIN_K);
    expect(c.mutual).toBe(true);
  });

  it("allows exactly matching the default without mutual:true", () => {
    const c = createContract(secretPath, storePath, {
      peer_id: "a@b.org",
      k_floor: DEFAULT_K,
      mutual: false,
    });
    expect(c.k_floor).toBe(DEFAULT_K);
  });
});

describe("effectiveKFor / effectiveK — contract override applies", () => {
  it("uses the contract's k_floor when one exists for the peer (raised floor)", () => {
    createContract(secretPath, storePath, { peer_id: "org@example.org", k_floor: 15, mutual: false });
    const k = effectiveK(storePath, secretPath, "org@example.org");
    expect(k).toBe(15);
  });

  it("uses the contract's lowered k_floor when mutual:true", () => {
    createContract(secretPath, storePath, { peer_id: "friend@example.org", k_floor: MIN_K, mutual: true });
    const k = effectiveK(storePath, secretPath, "friend@example.org");
    expect(k).toBe(MIN_K);
  });

  it("matches across the two requester-string shapes the system uses (bare email vs 'Name <email>')", () => {
    createContract(secretPath, storePath, { peer_id: "anna@example.org", k_floor: 10, mutual: false });
    const secret = loadOrCreateSecret(secretPath);
    const contracts = currentContractsView(storePath, secret);
    expect(effectiveKFor(contracts, "Anna <anna@example.org>")).toBe(10);
    expect(effectiveKFor(contracts, "ANNA@EXAMPLE.ORG")).toBe(10);
  });

  it("falls back to the default for a peer with no contract on file", () => {
    createContract(secretPath, storePath, { peer_id: "someone-else@example.org", k_floor: 15, mutual: false });
    expect(effectiveK(storePath, secretPath, "anna@example.org")).toBe(DEFAULT_K);
  });
});

describe("effectiveKFor — read-time half of the mutual guardrail", () => {
  it("does not honor a stored non-mutual contract as a downgrade even if it was legal when created", () => {
    // Simulates a contract legally created when the default was lower (e.g.
    // k_floor:5, mutual:false, created against a defaultK of 3) that must
    // NOT silently become a lowering contract once the default rises to 7 —
    // the mutual flag is a property of the system, not the moment of
    // creation.
    const c = createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 5, mutual: false }, 3);
    expect(c.k_floor).toBe(5); // legal against defaultK=3 at creation time

    const secret = loadOrCreateSecret(secretPath);
    const contracts = currentContractsView(storePath, secret);
    // Read against the real default (7): the stored k_floor (5) is below it
    // and mutual is false, so it must clamp UP to 7, not leak the 5.
    expect(effectiveKFor(contracts, "a@b.org", 7)).toBe(7);
  });

  it("still honors a mutual:true contract's lower floor regardless of the current default", () => {
    const c = createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 2, mutual: true }, 3);
    expect(c.k_floor).toBe(2);
    const secret = loadOrCreateSecret(secretPath);
    const contracts = currentContractsView(storePath, secret);
    expect(effectiveKFor(contracts, "a@b.org", 7)).toBe(2);
  });
});

describe("revokeContract", () => {
  it("appends a superseding record instead of rewriting the original line (Graffiti latest-wins)", () => {
    const c = createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 10, mutual: false });
    const revoked = revokeContract(secretPath, storePath, c.id);
    expect(revoked.supersedes).toBe(c.id);
    expect(revoked.revoked).toBe(true);

    const secret = loadOrCreateSecret(secretPath);
    const view = currentContractsView(storePath, secret);
    expect(view.find((x) => x.id === c.id)).toBeUndefined();
    expect(view.find((x) => x.id === revoked.id)).toBeUndefined(); // revoked head excluded too
    expect(effectiveK(storePath, secretPath, "a@b.org")).toBe(DEFAULT_K); // back to default once revoked
  });

  it("throws for an unknown or already-revoked id", () => {
    expect(() => revokeContract(secretPath, storePath, "no-such-id")).toThrow(ContractError);
    const c = createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 10, mutual: false });
    revokeContract(secretPath, storePath, c.id);
    expect(() => revokeContract(secretPath, storePath, c.id)).toThrow(ContractError);
  });
});

describe("tamper resistance", () => {
  it("a hand-edited (unsigned-for) line is dropped from currentContractsView, never lowers k", () => {
    const c = createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 9, mutual: false });
    // Hand-edit the line on disk without re-signing — e.g. someone dropping
    // in a bare k_floor:1 line to try to defeat the floor.
    const tampered = { ...c, k_floor: 1, mutual: true };
    writeFileSync(storePath, `${JSON.stringify(tampered)}\n`);

    const secret = loadOrCreateSecret(secretPath);
    expect(currentContractsView(storePath, secret)).toHaveLength(0);
    expect(listAllContractsRaw(storePath)).toHaveLength(1); // still visible in the raw audit trail
    expect(effectiveK(storePath, secretPath, "a@b.org")).toBe(DEFAULT_K); // never trusts the tampered value
  });

  it("skips malformed lines when reading the raw log rather than throwing", () => {
    createContract(secretPath, storePath, { peer_id: "a@b.org", k_floor: 10, mutual: false });
    writeFileSync(storePath, "not json at all\n", { flag: "a" });
    expect(() => listAllContractsRaw(storePath)).not.toThrow();
    expect(listAllContractsRaw(storePath)).toHaveLength(1);
  });
});
