// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// The @digitalcredentials packages ship no types; only the surface vrc_di.ts uses is declared.
declare module "@digitalcredentials/jsonld-signatures" {
  const jsigs: {
    sign(doc: object, options: { suite: unknown; purpose: unknown; documentLoader: unknown }): Promise<Record<string, any>>;
    verify(
      doc: object,
      options: { suite: unknown; purpose: unknown; documentLoader: unknown },
    ): Promise<{ verified: boolean; error?: { message?: string; errors?: Array<{ message?: string }> } }>;
    purposes: { AssertionProofPurpose: new () => unknown };
  };
  export default jsigs;
}
declare module "@digitalcredentials/data-integrity" {
  export class DataIntegrityProof {
    constructor(options: {
      cryptosuite: unknown;
      date?: string | Date;
      signer?: { id: string; algorithm: string; sign(args: { data: Uint8Array }): Promise<Uint8Array> };
    });
  }
}
declare module "@digitalcredentials/eddsa-rdfc-2022-cryptosuite" {
  export const cryptosuite: unknown;
}
