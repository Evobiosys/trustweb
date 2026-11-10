// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as jsigs from "@digitalcredentials/jsonld-signatures";
import { DataIntegrityProof } from "@digitalcredentials/data-integrity";
import { cryptosuite } from "@digitalcredentials/eddsa-rdfc-2022-cryptosuite";
import { createIdentity } from "./did_identity.js";
import { issueVrc, verifyVrc } from "./vrc.js";
import { createRelationshipKey, exportVrcDi, importVrcDi, offlineDocumentLoader, relationshipKeyFromJson, relationshipKeyToJson } from "./vrc_di.js";
import { CREDENTIALS_V2_CONTEXT_URL, DTG_REGISTRY_CONTEXT_V1_URL } from "./vrc_di_contexts.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function exported() {
  const issuer = createRelationshipKey();
  const subject = createRelationshipKey();
  const vrc = await exportVrcDi(issuer, { subjectDid: subject.did, validFrom: "2026-11-10T00:00:00Z", validUntil: "2027-11-10T00:00:00Z" });
  return { issuer, subject, vrc };
}

describe("relationship key", () => {
  it("is a key-only did:peer:0 (no endpoint, no device DID)", () => {
    const k = createRelationshipKey();
    expect(k.did).toMatch(/^did:peer:0z6Mk[1-9A-HJ-NP-Za-km-z]+$/);
    expect(k.did.length).toBeLessThan(80);
    expect(createRelationshipKey().did).not.toBe(k.did);
  });
  it("survives a JSON round trip", () => {
    const k = createRelationshipKey();
    const back = relationshipKeyFromJson(relationshipKeyToJson(k));
    expect(back.did).toBe(k.did);
    expect(Array.from(back.secretKey)).toEqual(Array.from(k.secretKey));
  });
});

describe("exportVrcDi", () => {
  it("emits the VC 2.0 + DTG profile Keyring reads", async () => {
    const { issuer, subject, vrc } = await exported();
    expect(vrc["@context"]).toEqual([CREDENTIALS_V2_CONTEXT_URL, DTG_REGISTRY_CONTEXT_V1_URL]);
    expect(vrc.type).toEqual(["VerifiableCredential", "DTGCredential", "RelationshipCredential"]);
    expect(vrc.issuer).toBe(issuer.did);
    expect(vrc.issuerScope).toBe("pairwise");
    expect(vrc.credentialSubject).toEqual({ id: subject.did });
    expect(vrc.validFrom).toBe("2026-11-10T00:00:00Z");
    expect(vrc.proof.type).toBe("DataIntegrityProof");
    expect(vrc.proof.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(vrc.proof.proofPurpose).toBe("assertionMethod");
    expect(vrc.proof.proofValue).toMatch(/^z/);
    expect(vrc.proof.verificationMethod).toBe(`${issuer.did}#${issuer.did.slice("did:peer:0".length)}`);
  });
  it("carries only did:peer:0 relationship DIDs, never a device did:peer:2 or an endpoint", async () => {
    const device = createIdentity("https://a.example/didcomm");
    const { vrc } = await exported();
    const text = JSON.stringify(vrc);
    expect(text).not.toContain("did:peer:2");
    expect(text).not.toContain(device.did);
    expect(text).not.toContain("didcomm");
  });
  it("refuses a subject that is not a did:peer:0", async () => {
    const device = createIdentity("https://a.example/didcomm");
    await expect(exportVrcDi(createRelationshipKey(), { subjectDid: device.did })).rejects.toThrow(/did:peer:0/);
  });
});

describe("importVrcDi", () => {
  it("round trip: valid, names issuer and subject", async () => {
    const { issuer, subject, vrc } = await exported();
    expect(await importVrcDi(vrc, { now: NOW })).toEqual({ valid: true, issuer: issuer.did, subject: subject.did });
  });
  it.each([
    ["subject", (v: any) => (v.credentialSubject.id = createRelationshipKey().did)],
    ["issuer", (v: any) => (v.issuer = createRelationshipKey().did)],
    ["validUntil", (v: any) => (v.validUntil = "2099-01-01T00:00:00Z")],
    ["type", (v: any) => (v.type = ["VerifiableCredential", "DTGCredential", "MembershipCredential"])],
    ["proofValue", (v: any) => (v.proof.proofValue = v.proof.proofValue.slice(0, -2) + "zz")],
  ])("tampering %s is invalid", async (_name, mutate) => {
    const { vrc } = await exported();
    const bad = clone(vrc);
    mutate(bad);
    const r = await importVrcDi(bad, { now: NOW });
    expect(r.valid).toBe(false);
    expect(r.reason).toBeTruthy();
  });
  it("rejects an expired and a not-yet-valid credential", async () => {
    const { vrc } = await exported();
    expect((await importVrcDi(vrc, { now: new Date("2028-01-01T00:00:00Z") })).reason).toMatch(/expired/);
    expect((await importVrcDi(vrc, { now: new Date("2026-01-01T00:00:00Z") })).reason).toMatch(/not yet valid/);
  });
  it("rejects a legacy Ed25519Signature2020 VRC, which the old verifyVrc still accepts", async () => {
    const a = createIdentity("https://a.example/didcomm");
    const b = createIdentity("https://b.example/didcomm");
    const legacy = issueVrc(a, { peerDid: b.did, relationship: "trusted" });
    expect(verifyVrc(legacy).valid).toBe(true);
    const r = await importVrcDi(legacy, { now: NOW });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/DataIntegrityProof/);
  });
  it("rejects non-objects and VRCs of the wrong shape", async () => {
    expect((await importVrcDi("nope")).valid).toBe(false);
    const { vrc } = await exported();
    const wrongCtx = clone(vrc);
    wrongCtx["@context"] = [DTG_REGISTRY_CONTEXT_V1_URL, CREDENTIALS_V2_CONTEXT_URL];
    expect((await importVrcDi(wrongCtx, { now: NOW })).reason).toMatch(/@context/);
  });
  it("offline loader refuses an unknown context and never reaches the network", async () => {
    const { issuer, vrc } = await exported();
    const withUnknown = clone(vrc);
    withUnknown["@context"] = [...vrc["@context"], "https://evil.example/ctx/v1"];
    const r = await importVrcDi(withUnknown, { now: NOW });
    expect(r.valid).toBe(false);
    await expect(offlineDocumentLoader("https://evil.example/ctx/v1")).rejects.toThrow(/unknown|offline/i);
    await expect(offlineDocumentLoader("https://www.w3.org/ns/credentials/v2")).resolves.toBeTruthy();
    await expect(offlineDocumentLoader(issuer.did)).resolves.toBeTruthy();
    await expect(offlineDocumentLoader("did:web:example.com")).rejects.toThrow();
  });
});

describe("cross-verification with the @digitalcredentials stack (what Keyring runs)", () => {
  async function verifyWithKeyringStack(vrc: unknown) {
    const suite = new DataIntegrityProof({ cryptosuite });
    const j = (jsigs as any).default;
    return j.verify(vrc, { suite, purpose: new j.purposes.AssertionProofPurpose(), documentLoader: offlineDocumentLoader }) as Promise<{ verified: boolean }>;
  }
  it("our export verifies", async () => {
    expect((await verifyWithKeyringStack((await exported()).vrc)).verified).toBe(true);
  });
  it("a tampered export does not", async () => {
    const bad = clone((await exported()).vrc);
    bad.credentialSubject.id = createRelationshipKey().did;
    expect((await verifyWithKeyringStack(bad)).verified).toBe(false);
  });
});

describe("Keyring-stack fixture (test-fixtures/keyring/)", () => {
  const fixture = JSON.parse(readFileSync(new URL("../test-fixtures/keyring/keyring_style_vrc.json", import.meta.url), "utf8")) as { source: string; vrcs: Record<string, any> };
  const at = new Date("2026-11-10T12:00:00Z");
  it("records the Keyring sha it was built against", () => {
    expect(fixture.source).toMatch(/keyring-bifold [0-9a-f]{40}/);
  });
  it.each(["plain", "evidenceContext"])("imports %s: valid, issuer and subject are did:peer:0", async (name) => {
    const vrc = fixture.vrcs[name];
    const r = await importVrcDi(vrc, { now: at });
    expect(r).toEqual({ valid: true, issuer: vrc.issuer, subject: vrc.credentialSubject.id });
    expect(r.issuer).toMatch(/^did:peer:0z6Mk/);
  });
  it("issuerScope is covered by the proof", async () => {
    const bad = clone(fixture.vrcs.plain);
    bad.issuerScope = "public";
    expect((await importVrcDi(bad, { now: at })).valid).toBe(false);
  });
  it("our export has the same shape as the Keyring one (same keys, same context list)", async () => {
    const ours = (await exported()).vrc;
    const theirs = fixture.vrcs.plain;
    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).filter((k) => k !== "id").sort());
    expect(ours["@context"]).toEqual(theirs["@context"]);
    expect(ours.issuerScope).toBe(theirs.issuerScope);
  });
});
