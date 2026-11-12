// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Regenerates keyring_style_vrc.json: VRCs signed the way keyring-bifold signs them, WITHOUT using src/vrc_di.ts.
// Mirrors (a) EddsaRdfc2022DataIntegritySuite in packages/vrc-shared/src/dataIntegritySuite.ts (signer = {...key.signer(),
// id, algorithm}), (b) buildVrcCredential in packages/core/src/modules/vrc/vrc-manager.ts (VC 2.0, issuerScope pairwise,
// 5 min backdated validFrom) and (c) the did:peer:0 resolution of packages/vrc-shared/src/documentLoader.ts.
// NOT issued by a running Keyring wallet (needs Credo + Askar + a device); it is the Keyring stack re-run by hand.
// Usage: npx tsx test-fixtures/keyring/make_keyring_style_vrc.mts <keyring-bifold sha>   (keyring-bifold clone checked out at that sha)
import { writeFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58btc } from "multiformats/bases/base58";
import jsigs from "@digitalcredentials/jsonld-signatures";
import { DataIntegrityProof } from "@digitalcredentials/data-integrity";
import { cryptosuite } from "@digitalcredentials/eddsa-rdfc-2022-cryptosuite";
import { CREDENTIALS_V2_CONTEXT_DOCUMENT, CREDENTIALS_V2_CONTEXT_URL, DTG_REGISTRY_CONTEXT_V1_TEXT, DTG_REGISTRY_CONTEXT_V1_URL, STANDARD_CONTEXTS, THIRD_CONTEXTS } from "../../src/vrc_di_contexts.js";

const sha = process.argv[2];
if (!sha) throw new Error("usage: make_keyring_style_vrc.mts <keyring-bifold sha>");
const HARDWARE_EVIDENCE_CONTEXT_URL = "https://www.firstperson.network/hardware-evidence/v1";

const fp = (pub: Uint8Array) => base58btc.encode(Uint8Array.from([0xed, 0x01, ...pub])); // z6Mk… fingerprint
const seeded = (n: number) => { const sk = new Uint8Array(32).fill(n); const pk = ed25519.getPublicKey(sk); return { sk, pk, did: `did:peer:0${fp(pk)}` }; };
const issuer = seeded(7);
const counterparty = seeded(9);

// Keyring's loader: did:peer:0 -> Ed25519VerificationKey2018 inside a DID document
const loader = async (url: string) => {
  const did = url.split("#")[0];
  if (did.startsWith("did:peer:0")) {
    const fingerprint = did.slice("did:peer:0".length);
    const raw = base58btc.decode(fingerprint).slice(2);
    const vm = { id: `${did}#${fingerprint}`, type: "Ed25519VerificationKey2018", controller: did, publicKeyBase58: base58btc.baseEncode(raw) };
    const ctx = ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/ed25519-2018/v1"];
    const doc = { "@context": ctx, id: did, verificationMethod: [vm], authentication: [vm.id], assertionMethod: [vm.id] };
    return { contextUrl: null, documentUrl: url, document: url.includes("#") ? { ...vm, "@context": ctx } : doc };
  }
  const known: Record<string, object> = { [CREDENTIALS_V2_CONTEXT_URL]: CREDENTIALS_V2_CONTEXT_DOCUMENT, [DTG_REGISTRY_CONTEXT_V1_URL]: JSON.parse(DTG_REGISTRY_CONTEXT_V1_TEXT), ...STANDARD_CONTEXTS, ...THIRD_CONTEXTS };
  if (!known[url]) throw new Error(`no context for ${url}`);
  return { contextUrl: null, documentUrl: url, document: known[url] };
};

async function issue(id: string, contexts: string[], created: Date) {
  const vm = `${issuer.did}#${issuer.did.slice("did:peer:0".length)}`;
  const key = { signer: () => ({ sign: async ({ data }: { data: Uint8Array }) => ed25519.sign(data, issuer.sk) }) };
  const suite = new DataIntegrityProof({ cryptosuite, date: created, signer: { ...key.signer(), id: vm, algorithm: "Ed25519" } });
  const credential = {
    "@context": contexts,
    id,
    type: ["VerifiableCredential", "DTGCredential", "RelationshipCredential"],
    issuer: issuer.did,
    issuerScope: "pairwise",
    validFrom: new Date(created.getTime() - 5 * 60 * 1000).toISOString(),
    validUntil: new Date(created.getTime() + 365 * 24 * 3600 * 1000).toISOString(),
    credentialSubject: { id: counterparty.did },
  };
  return jsigs.sign(credential, { suite, purpose: new jsigs.purposes.AssertionProofPurpose(), documentLoader: loader });
}

const created = new Date("2026-11-10T12:00:00.000Z");
const out = {
  source: `keyring-bifold ${sha} (suite + credential shape + did:peer:0 loader mirrored; not a running wallet)`,
  vrcs: {
    plain: await issue("urn:uuid:keyring-style-plain", [CREDENTIALS_V2_CONTEXT_URL, DTG_REGISTRY_CONTEXT_V1_URL], created),
    evidenceContext: await issue("urn:uuid:keyring-style-evidence-ctx", [CREDENTIALS_V2_CONTEXT_URL, DTG_REGISTRY_CONTEXT_V1_URL, HARDWARE_EVIDENCE_CONTEXT_URL], created),
  },
};
writeFileSync(new URL("keyring_style_vrc.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
