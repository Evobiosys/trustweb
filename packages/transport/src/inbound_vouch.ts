// Inbound-vouch route — Finding 1, UH-findings handover 2026-09-06
// (DEVLOG/community-wot/wot-findings_of-WebOfTrust_handover.md).
//
// trustExport() (agent-daemon/src/main.ts, GET /api/trust/export?format=vrc)
// mints VRCs where the CALLER is the issuer: "here is who I trust"
// (outbound). A holder proving standing to a relying party needs the
// opposite: "here are k people who vouched for ME" (inbound). Nothing
// before this module produced, collected, or verified that shape.
// trustExport() itself is UNCHANGED by this file.
//
// Route chosen — option (i) of the handover's three candidates: OUT-OF-BAND
// VRC HANDOVER. A voucher issues a VRC about the holder (issueVrc already
// supports this; the "direction" is only which DID plays credentialSubject)
// and hands it to the holder by any channel outside this daemon (QR, paste,
// file). The holder collects these into one VouchPresentation and gives
// THAT to a relying party, who verifies it fully offline with the exports
// below — no daemon, no network call, on either side. Chosen because it is
// the only one of the three that needs NO new server component: issueVrc
// and verifyVrc already work symmetrically in either direction; only the
// collection/verification shape was missing.
//
// The other two candidates, NOT built here, with their trade-offs:
//  - A "collect my vouches" screen in apps/demo: friendlier UX (no manual
//    copy-paste per voucher), but it is a new UI surface on the WoT side
//    that does not exist yet, and it still needs this same
//    VouchPresentation shape underneath it — this module is a prerequisite
//    for that screen, not an alternative to it.
//  - Wait for cred-provider: the cleanest long-term shape (persisted,
//    listable, revocable credentials via CredentialProvider /
//    VerifiablePresentation, packages/transport/src/credential_provider.ts
//    on that branch) but the branch is unmerged, has a known D21 numbering
//    conflict against gating-ui, and per the UH proposal's own defer list
//    should not be designed against yet. When it lands, the shapes below
//    are what it should converge on.
//
// HONEST LABELING: inherits vrc.ts's own limits — self-asserted pairwise, no
// witness, no revocation/status list, canonicalized by deterministic
// key-sorted JSON rather than URDNA2015 (see vrc.ts's header). A `true`
// result here means "these are k distinct DIDs that really signed a vouch
// about this subject", not "k trustworthy humans vouched for this subject" —
// that additional claim needs an anchor set (see `anchorDids` below), which
// this module supports but does not choose for its caller.
import { issueVrc, verifyVrc, type VerifiableRelationshipCredential } from "./vrc.js";
import type { Identity } from "./did_identity.js";

/**
 * The relationship label an inbound vouch VRC carries in
 * `credentialSubject.relationship` — deliberately distinct from
 * trustExport's outbound `"trusted"` label, so the two directions are never
 * confused by grep, by a relying party reading raw JSON, or by a future
 * traversal that walks both.
 */
export const VOUCH_RELATIONSHIP = "vouches-for";

/**
 * Finding 2: the vouch-count k for credential presentation. DISTINCT from
 * packages/network-access's k-anonymity DEFAULT_K/MIN_K (distinct AUTHORS in
 * an aggregate display, docs/k-parameters.md's "k1") and from
 * feat/trust-weighting's DEFAULT_MIN_CONTRIBUTORS (trust-distance weighting,
 * "k3"). VOUCH_K answers "how many distinct vouchers must a holder present
 * before a relying party treats them as vouched-for" (docs/k-parameters.md's
 * "k2"). UH-configurable: UH's own MIN_K_THRESHOLD floor is 2 and its
 * proposal argues 3 is more defensible for owner contact details
 * specifically — either is a product decision for the relying party, not
 * something this module should decide. Never below 2 regardless (see
 * `verifyInboundVouches`'s clamp): at k = 1 "vouched for" means "one person
 * said so", which is not meaningfully different from unvouched.
 */
export const VOUCH_K = 2;

/** The hard minimum verifyInboundVouches will honor, however low a caller asks — same reasoning as network-access's MIN_K, one floor per k, never shared. */
const MIN_VOUCH_K = 2;

export interface VouchPresentation {
  /** The DID this presentation is about. Every credential in it must name this as `credentialSubject.id`. */
  subject: string;
  /** VRCs issued by vouchers, each `vouches-for` this subject. */
  credentials: VerifiableRelationshipCredential[];
}

/**
 * Issues one inbound vouch: `voucher` vouches FOR `subjectDid`. Returns the
 * signed VRC for the voucher to hand to the subject out of band (QR, paste,
 * file) — this function does not transmit anything and does not touch the
 * voucher's own trust-edge store (a vouch is a standalone assertion, not a
 * trust edge; the voucher need not have a `TrustEdge` to the subject at all).
 */
export function issueInboundVouch(voucher: Identity, subjectDid: string, metContext?: string): VerifiableRelationshipCredential {
  return issueVrc(voucher, { peerDid: subjectDid, relationship: VOUCH_RELATIONSHIP, metContext });
}

/**
 * Holder-side: assembles a presentation from VRCs collected out of band.
 * Drops (silently) any credential not actually about `subjectDid` — a
 * relying party must never receive a vouch about someone else bundled in by
 * mistake or malice; `verifyInboundVouches` re-checks this independently as
 * defense in depth, since a relying party may build a `VouchPresentation` by
 * hand rather than through this function.
 */
export function buildVouchPresentation(subjectDid: string, collectedVouches: VerifiableRelationshipCredential[]): VouchPresentation {
  return {
    subject: subjectDid,
    credentials: collectedVouches.filter((v) => v.credentialSubject.id === subjectDid),
  };
}

export interface VouchRejection {
  /** The credential's stated issuer (not necessarily who really signed it). */
  issuer: string;
  reason: string;
}

export interface VouchVerificationResult {
  /** Issuer DIDs whose vouch verified, is about the presentation's subject, and (if an anchor set was given) is on it. Deduplicated — a second vouch from the same issuer does not count twice. */
  distinctVouchers: string[];
  /** True when distinctVouchers.length >= the effective k (see options). */
  meetsThreshold: boolean;
  /** One entry per credential that failed verification or was filtered out, for diagnostics only — never treat a rejected issuer as vouched. */
  rejected: VouchRejection[];
}

export interface VerifyInboundVouchesOptions {
  /** Vouch-count k. Defaults to VOUCH_K; clamped up to MIN_VOUCH_K regardless of what is passed. */
  k?: number;
  /**
   * Restrict counting to these issuer DIDs — the "anchor set" the UH
   * proposal requires (§3, "Anchors, not raw counts"): without one, counting
   * distinct issuer DIDs is theatre, since DIDs are free to mint. Omitted:
   * any distinct verified issuer counts, which is appropriate only for a
   * relying party that has its own separate Sybil defense.
   */
  anchorDids?: string[];
}

/**
 * Verifies a VouchPresentation ENTIRELY OFFLINE: no daemon call, no network
 * — pure Ed25519 verification against each issuer's did:peer:2, exactly the
 * way `verifyVrc` already verifies the outbound direction. A relying party
 * (UH or anyone else) calls this directly against a bundle a holder
 * presented; nothing here depends on this daemon, or any daemon, running.
 */
export function verifyInboundVouches(presentation: VouchPresentation, opts: VerifyInboundVouchesOptions = {}): VouchVerificationResult {
  const k = Math.max(MIN_VOUCH_K, opts.k ?? VOUCH_K);
  const anchorSet = opts.anchorDids ? new Set(opts.anchorDids) : undefined;
  const distinctVouchers = new Set<string>();
  const rejected: VouchRejection[] = [];

  for (const credential of presentation.credentials) {
    if (credential.credentialSubject.id !== presentation.subject) {
      rejected.push({ issuer: credential.issuer, reason: "credential is not about this presentation's subject" });
      continue;
    }
    const result = verifyVrc(credential);
    if (!result.valid || result.issuer === undefined) {
      rejected.push({ issuer: credential.issuer, reason: result.reason ?? "signature verification failed" });
      continue;
    }
    if (anchorSet !== undefined && !anchorSet.has(result.issuer)) {
      rejected.push({ issuer: result.issuer, reason: "issuer is not in the anchor set" });
      continue;
    }
    distinctVouchers.add(result.issuer);
  }

  return { distinctVouchers: [...distinctVouchers], meetsThreshold: distinctVouchers.size >= k, rejected };
}
