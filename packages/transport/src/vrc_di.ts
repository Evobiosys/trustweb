// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// VRC as a W3C VC 2.0 + DTG credential with a Data Integrity proof (eddsa-rdfc-2022): the format a Keyring wallet
// (berkmancenter/keyring-wallet, keyring-bifold) verifies. EXPORT/IMPORT ONLY: vrc.ts (internal envelope, verifyVrc)
// is unchanged and keeps verifying legacy Ed25519Signature2020 VRCs.
//
// Built against keyring-bifold e83c8426faef6fc294195f8bfa9cfeb42b6ed847 (packages/vrc-shared dataIntegritySuite.ts and
// documentLoader.ts, packages/vrc-contexts relationshipContext.ts) and keyring-wallet bcc073d7f6525e85c8183a79b60d7680249198ae
// (2026-11-10). Alpha project, moving spec: re-pin on each Keyring release. DTG registry context: v1, sha256 pinned in
// vrc_di_contexts.ts.
//
// IDENTITY: a VRC names only did:peer:0 RELATIONSHIP DIDs (one key per edge, key only, no endpoint). The device
// did:peer:2 (endpoint inside) never appears in a credential; it stays in transport and the vault.
//
// HONEST LABELING (I7): self-asserted pairwise. No witness, no revocation, no status list. RelationshipCredential in
// the DTG registry carries only issuer + credentialSubject.id, so the trust level is NOT exported.
//
// Verification is fully offline: contexts come from vrc_di_contexts.ts, did:peer:0 resolves from the DID string, any
// other URL is refused. Runs in node and in the browser: no fs, and the code in this package that the browser bundle
// reaches uses no Buffer (did_identity.ts keeps Buffer in functions this module never calls, which esbuild drops). The
// bundled third-party libraries mention Buffer only in their node variants or unused branches: the 245 KB esbuild
// browser bundle ran export + import with globalThis.Buffer deleted (wave41 review-fix D13). Under node (vitest) the
// libraries resolve to their node builds, which do use Buffer.
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58btc } from "multiformats/bases/base58";
import { base64url } from "multiformats/bases/base64";
import jsigs from "@digitalcredentials/jsonld-signatures";
import { DataIntegrityProof } from "@digitalcredentials/data-integrity";
import { cryptosuite } from "@digitalcredentials/eddsa-rdfc-2022-cryptosuite";
import { decodeEd25519Multibase, encodeEd25519Multibase } from "./did_identity.js";
import {
  CREDENTIALS_V2_CONTEXT_DOCUMENT,
  CREDENTIALS_V2_CONTEXT_URL,
  DTG_REGISTRY_CONTEXT_V1_TEXT,
  DTG_REGISTRY_CONTEXT_V1_URL,
  STANDARD_CONTEXTS,
  THIRD_CONTEXTS,
} from "./vrc_di_contexts.js";
import type { VrcVerifyResult } from "./vrc.js";

const DID_PEER_0 = "did:peer:0";
const CRYPTOSUITE = "eddsa-rdfc-2022";
const VRC_TYPE = ["VerifiableCredential", "DTGCredential", "RelationshipCredential"];
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000; // I9: expires_at +1y on edges

/** One Ed25519 key per edge, published only as a key-only did:peer:0. */
export interface RelationshipKey {
  did: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface DiVrc {
  "@context": string[];
  type: string[];
  issuer: string;
  issuerScope: string;
  validFrom: string;
  validUntil: string;
  credentialSubject: { id: string };
  proof: { type: "DataIntegrityProof"; cryptosuite: string; created: string; verificationMethod: string; proofPurpose: "assertionMethod"; proofValue: string };
  [extra: string]: unknown;
}

export interface ExportVrcDiArgs {
  /** The counterparty's relationship DID (did:peer:0) for this edge. */
  subjectDid: string;
  validFrom?: string;
  validUntil?: string;
}

function didFromPublicKey(publicKey: Uint8Array): string {
  return DID_PEER_0 + encodeEd25519Multibase(publicKey);
}

export function createRelationshipKey(): RelationshipKey {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { did: didFromPublicKey(publicKey), secretKey, publicKey };
}

export function relationshipKeyToJson(key: RelationshipKey): string {
  return JSON.stringify({ did: key.did, secretKey: base64url.baseEncode(key.secretKey) });
}

export function relationshipKeyFromJson(json: string): RelationshipKey {
  const raw = JSON.parse(json) as { did?: unknown; secretKey?: unknown };
  if (typeof raw.did !== "string" || typeof raw.secretKey !== "string") throw new Error("malformed relationship key");
  const secretKey = base64url.baseDecode(raw.secretKey);
  const publicKey = ed25519.getPublicKey(secretKey);
  if (didFromPublicKey(publicKey) !== raw.did) throw new Error("relationship key does not match its DID");
  return { did: raw.did, secretKey, publicKey };
}

/** The public key inside a did:peer:0 (throws on any other DID). */
function publicKeyOfDidPeer0(did: string): Uint8Array {
  if (!did.startsWith(DID_PEER_0)) throw new Error(`not a did:peer:0 DID: ${did.slice(0, 24)}`);
  return decodeEd25519Multibase(did.slice(DID_PEER_0.length));
}

const verificationMethodId = (did: string): string => `${did}#${did.slice(DID_PEER_0.length)}`;

/** Resolves a did:peer:0 the way Keyring's loader does: Ed25519VerificationKey2018 inside a DID document. */
function didPeer0Document(did: string): { document: Record<string, any>; verificationMethod: Record<string, any> } {
  const publicKey = publicKeyOfDidPeer0(did);
  const verificationMethod = {
    id: verificationMethodId(did),
    type: "Ed25519VerificationKey2018",
    controller: did,
    publicKeyBase58: base58btc.baseEncode(publicKey),
  };
  const document = {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/ed25519-2018/v1"],
    id: did,
    verificationMethod: [verificationMethod],
    authentication: [verificationMethod.id],
    assertionMethod: [verificationMethod.id],
  };
  return { document, verificationMethod };
}

// A Map, not an object: "__proto__" / "constructor" must never resolve to a prototype member (review D2).
const CONTEXT_DOCUMENTS = new Map<string, object>([
  [CREDENTIALS_V2_CONTEXT_URL, CREDENTIALS_V2_CONTEXT_DOCUMENT],
  [DTG_REGISTRY_CONTEXT_V1_URL, JSON.parse(DTG_REGISTRY_CONTEXT_V1_TEXT) as object],
  ...Object.entries(STANDARD_CONTEXTS),
  ...Object.entries(THIRD_CONTEXTS),
]);
const isThirdContext = (url: unknown): boolean => typeof url === "string" && Object.hasOwn(THIRD_CONTEXTS, url);
const MAX_CONTEXTS = 4; // credentials/v2, DTG registry, at most two allowlisted extras
const SKEW_MS = 5 * 60 * 1000; // clock skew tolerated on validFrom only

/** Offline JSON-LD document loader: bundled contexts and did:peer:0 only. Anything else throws (no network, ever). */
export async function offlineDocumentLoader(url: string): Promise<{ contextUrl: null; documentUrl: string; document: object }> {
  const bare = url.split("#")[0];
  if (bare.startsWith(DID_PEER_0)) {
    const { document, verificationMethod } = didPeer0Document(bare);
    // a DID URL with a fragment dereferences to the verification method, which the suite reads with its own contexts
    const target = url.includes("#") ? { ...verificationMethod, "@context": document["@context"] } : document;
    if (url.includes("#") && verificationMethod.id !== url) throw new Error(`verification method not found: ${url}`);
    return { contextUrl: null, documentUrl: url, document: target };
  }
  const context = CONTEXT_DOCUMENTS.get(url);
  if (context === undefined) throw new Error(`offline loader: unknown document ${url.slice(0, 80)}`);
  return { contextUrl: null, documentUrl: url, document: context };
}

function suiteFor(key: RelationshipKey | undefined, created: string): DataIntegrityProof {
  return new DataIntegrityProof({
    cryptosuite,
    date: created,
    signer: key && {
      id: verificationMethodId(key.did),
      algorithm: "Ed25519",
      sign: async ({ data }) => ed25519.sign(data, key.secretKey),
    },
  });
}

const purpose = () => new jsigs.purposes.AssertionProofPurpose();

/** Issues a VRC from `key` (this edge's relationship key) about `args.subjectDid`. */
export async function exportVrcDi(key: RelationshipKey, args: ExportVrcDiArgs): Promise<DiVrc> {
  publicKeyOfDidPeer0(args.subjectDid); // throws unless a did:peer:0
  const validFrom = args.validFrom ?? new Date().toISOString();
  const unsigned = {
    "@context": [CREDENTIALS_V2_CONTEXT_URL, DTG_REGISTRY_CONTEXT_V1_URL],
    type: VRC_TYPE,
    issuer: key.did,
    // DTG cred-spec: REQUIRED; "pairwise" = the issuer DID is minted for this one counterparty only
    issuerScope: "pairwise",
    validFrom,
    validUntil: args.validUntil ?? new Date(Date.parse(validFrom) + ONE_YEAR_MS).toISOString(),
    credentialSubject: { id: args.subjectDid },
  };
  return (await jsigs.sign(unsigned, { suite: suiteFor(key, validFrom), purpose: purpose(), documentLoader: offlineDocumentLoader })) as DiVrc;
}

export interface ImportVrcDiOptions {
  now?: Date;
}

const fail = (reason: string): VrcVerifyResult => ({ valid: false, reason });

/**
 * Verifies a VRC in the Keyring profile. `valid: true` means "this relationship key signed this" (self-asserted),
 * inside its validFrom..validUntil window. Never throws.
 */
export async function importVrcDi(input: unknown, options: ImportVrcDiOptions = {}): Promise<VrcVerifyResult> {
  try {
    if (typeof input !== "object" || input === null) return fail("not a credential object");
    const vrc = input as Partial<DiVrc>;
    const proof = vrc.proof;
    if (proof?.type !== "DataIntegrityProof" || proof.cryptosuite !== CRYPTOSUITE) {
      return fail(`unsupported proof: need DataIntegrityProof / ${CRYPTOSUITE}`);
    }
    const ctx = vrc["@context"];
    if (!Array.isArray(ctx) || ctx[0] !== CREDENTIALS_V2_CONTEXT_URL || ctx[1] !== DTG_REGISTRY_CONTEXT_V1_URL) {
      return fail("@context must start with credentials/v2 then the DTG registry context");
    }
    const extras = ctx.slice(2);
    if (ctx.length > MAX_CONTEXTS || !extras.every(isThirdContext) || new Set(extras).size !== extras.length) {
      return fail(`@context may add at most ${MAX_CONTEXTS - 2} distinct allowlisted contexts after the first two`);
    }
    if (!Array.isArray(vrc.type) || !VRC_TYPE.every((t) => vrc.type?.includes(t))) return fail("type must be a DTG RelationshipCredential");
    if (typeof vrc.issuer !== "string") return fail("issuer must be a did:peer:0");
    publicKeyOfDidPeer0(vrc.issuer);
    if (proof.verificationMethod !== verificationMethodId(vrc.issuer)) return fail("proof verificationMethod does not match issuer");
    const subject = vrc.credentialSubject?.id;
    if (typeof subject !== "string") return fail("credentialSubject.id missing");
    if (Object.keys(vrc.credentialSubject ?? {}).length !== 1) return fail("credentialSubject may carry only id");
    publicKeyOfDidPeer0(subject);
    // validity window is mandatory: NaN compares false both ways, so a missing/garbage date would never expire
    const validFrom = typeof vrc.validFrom === "string" ? Date.parse(vrc.validFrom) : NaN;
    const validUntil = typeof vrc.validUntil === "string" ? Date.parse(vrc.validUntil) : NaN;
    if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil)) return fail("invalid validity window: validFrom and validUntil are required dates");

    const result = await jsigs.verify(vrc as object, { suite: suiteFor(undefined, proof.created), purpose: purpose(), documentLoader: offlineDocumentLoader });
    if (!result.verified) {
      return fail(result.error?.errors?.[0]?.message ?? result.error?.message ?? "signature verification failed");
    }
    const now = (options.now ?? new Date()).getTime();
    if (validFrom > now + SKEW_MS) return fail("credential not yet valid");
    if (validUntil <= now) return fail("credential expired");
    return { valid: true, issuer: vrc.issuer, subject };
  } catch (err) {
    return fail((err as Error).message);
  }
}
