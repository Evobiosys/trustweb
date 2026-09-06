// Inbound-vouch route (Finding 1). Proves the direction trustExport() does
// not provide: a voucher signs, the holder assembles a presentation, and a
// relying party verifies k distinct vouchers fully offline.
import { describe, it, expect } from "vitest";
import { createIdentity } from "./did_identity.js";
import {
  issueInboundVouch,
  buildVouchPresentation,
  verifyInboundVouches,
  VOUCH_RELATIONSHIP,
  VOUCH_K,
} from "./inbound_vouch.js";

function identity(port: number) {
  return createIdentity(`http://127.0.0.1:${port}/didcomm`);
}

describe("inbound vouch route", () => {
  it("issues a vouch with the vouch relationship label, not trustExport's outbound one", () => {
    const voucher = identity(1);
    const holder = identity(2);
    const vouch = issueInboundVouch(voucher, holder.did);
    expect(vouch.issuer).toBe(voucher.did);
    expect(vouch.credentialSubject.id).toBe(holder.did);
    expect(vouch.credentialSubject.relationship).toBe(VOUCH_RELATIONSHIP);
    expect(vouch.credentialSubject.relationship).not.toBe("trusted");
  });

  it("a voucher signs, the holder exports inbound, a relying party verifies k distinct vouchers offline", () => {
    const holder = identity(1);
    const voucherA = identity(2);
    const voucherB = identity(3);

    // Each voucher signs independently and hands the VRC to the holder out
    // of band — nothing here calls a daemon or any network endpoint.
    const vouchFromA = issueInboundVouch(voucherA, holder.did, "met at repair café");
    const vouchFromB = issueInboundVouch(voucherB, holder.did);

    // The holder collects both into one presentation.
    const presentation = buildVouchPresentation(holder.did, [vouchFromA, vouchFromB]);
    expect(presentation.subject).toBe(holder.did);
    expect(presentation.credentials).toHaveLength(2);

    // A relying party verifies entirely offline (no daemon, no network).
    const result = verifyInboundVouches(presentation, { k: VOUCH_K });
    expect(result.meetsThreshold).toBe(true);
    expect(result.distinctVouchers.sort()).toEqual([voucherA.did, voucherB.did].sort());
    expect(result.rejected).toEqual([]);
  });

  it("a forged vouch fails and does not count toward the threshold", () => {
    const holder = identity(1);
    const voucherA = identity(2);
    const attacker = identity(3);

    const legit = issueInboundVouch(voucherA, holder.did);
    const real = issueInboundVouch(attacker, holder.did);
    // Forge: relabel the issuer to someone else's DID, keep the attacker's signature.
    const impersonator = identity(4);
    const forged = { ...real, issuer: impersonator.did };

    const presentation = buildVouchPresentation(holder.did, [legit, forged]);
    const result = verifyInboundVouches(presentation, { k: 2 });

    expect(result.meetsThreshold).toBe(false); // only 1 of 2 verified
    expect(result.distinctVouchers).toEqual([voucherA.did]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].issuer).toBe(impersonator.did);
  });

  it("rejects a vouch whose signed body was tampered with after issuance", () => {
    const holder = identity(1);
    const voucherA = identity(2);
    const vouch = issueInboundVouch(voucherA, holder.did);
    const tampered = { ...vouch, credentialSubject: { ...vouch.credentialSubject, relationship: "trusted" } };

    const presentation = buildVouchPresentation(holder.did, [tampered]);
    const result = verifyInboundVouches(presentation);

    expect(result.distinctVouchers).toEqual([]);
    expect(result.meetsThreshold).toBe(false);
    expect(result.rejected).toHaveLength(1);
  });

  it("buildVouchPresentation drops a credential about a different subject", () => {
    const holder = identity(1);
    const someoneElse = identity(2);
    const voucherA = identity(3);

    const vouchForHolder = issueInboundVouch(voucherA, holder.did);
    const vouchForSomeoneElse = issueInboundVouch(voucherA, someoneElse.did);

    const presentation = buildVouchPresentation(holder.did, [vouchForHolder, vouchForSomeoneElse]);
    expect(presentation.credentials).toEqual([vouchForHolder]);
  });

  it("does not count the same issuer twice even with two vouches", () => {
    const holder = identity(1);
    const voucherA = identity(2);
    const first = issueInboundVouch(voucherA, holder.did, "first meeting");
    const second = issueInboundVouch(voucherA, holder.did, "second meeting");

    const presentation = buildVouchPresentation(holder.did, [first, second]);
    const result = verifyInboundVouches(presentation, { k: 2 });

    expect(result.distinctVouchers).toEqual([voucherA.did]);
    expect(result.meetsThreshold).toBe(false); // 1 distinct voucher, k = 2
  });

  it("counts only anchor-set issuers when an anchor set is given (anti-Sybil)", () => {
    const holder = identity(1);
    const anchor = identity(2);
    const freeAccount1 = identity(3);
    const freeAccount2 = identity(4);

    const fromAnchor = issueInboundVouch(anchor, holder.did);
    const fromFree1 = issueInboundVouch(freeAccount1, holder.did);
    const fromFree2 = issueInboundVouch(freeAccount2, holder.did);

    const presentation = buildVouchPresentation(holder.did, [fromAnchor, fromFree1, fromFree2]);

    // Without an anchor set: three freely-minted-looking DIDs "meet" k=2 —
    // exactly the theatre the proposal warns about.
    const noAnchor = verifyInboundVouches(presentation, { k: 2 });
    expect(noAnchor.meetsThreshold).toBe(true);

    // With an anchor set containing only `anchor`: the two free accounts do
    // not count, so k=2 is not met even though 3 vouches were presented.
    const withAnchor = verifyInboundVouches(presentation, { k: 2, anchorDids: [anchor.did] });
    expect(withAnchor.distinctVouchers).toEqual([anchor.did]);
    expect(withAnchor.meetsThreshold).toBe(false);
    expect(withAnchor.rejected).toHaveLength(2);
  });

  it("clamps k up to the floor of 2 even if a caller asks for less", () => {
    const holder = identity(1);
    const voucherA = identity(2);
    const vouch = issueInboundVouch(voucherA, holder.did);
    const presentation = buildVouchPresentation(holder.did, [vouch]);

    // Asking for k=1 (or 0, or negative) must not make a single vouch "enough".
    expect(verifyInboundVouches(presentation, { k: 1 }).meetsThreshold).toBe(false);
    expect(verifyInboundVouches(presentation, { k: 0 }).meetsThreshold).toBe(false);
    expect(verifyInboundVouches(presentation, { k: -5 }).meetsThreshold).toBe(false);
  });

  it("VOUCH_K defaults to 2, distinct from network-access's k-anonymity DEFAULT_K", () => {
    expect(VOUCH_K).toBe(2);
  });
});
