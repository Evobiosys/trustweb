// Shared shapes for the central-index store and server.
//
// Deliberately duplicates the field shape of @resource-web/wot-policy's
// DeclarationFacets rather than importing it: store.ts (and its tests) must
// typecheck and run with zero dependency on wot-policy, since the two
// packages are built by different agents in parallel. TypeScript's
// structural typing makes this interface interchangeable with wot-policy's
// DeclarationFacets wherever both are in scope (server.ts).

export interface DeclarationFacets {
  category: string; // template category, e.g. 'accommodation.sublet'
  regionCode: string; // coarse region, e.g. 'AT-9'; never an address
  authorCommitment: string; // salted hash of the holder DID; equality-comparable, not reversible
  sensitive: boolean; // template flagged sensitive -> asker protection applies
}

/** A coarsened, holder-approved record as stored centrally. Never raw vault text. */
export interface PublishedDeclaration {
  id: string;
  facets: DeclarationFacets;
  /** Opaque base64url ciphertext. The server never decodes or reads this. */
  sealedBody: string;
  /**
   * The holder's Ed25519 verification key, registered WITH the declaration at
   * publish time (B-20 option A), base64url over the raw 32 bytes.
   *
   * On the declaration rather than in a side registry keyed by
   * authorCommitment, because that is what makes `POST /clear` scopeable: a
   * clear removes only the declarations whose registered key matches the one
   * that signed the request. A commitment-keyed registry could not express
   * that, and a holder who re-keys (new device, lost phone) would either
   * silently lose the ability to clear her old records or gain the ability to
   * clear records she never published.
   *
   * It is never returned by /query (see DeclarationHit) and never by the
   * backtrace listing: a per-holder constant in a hit list would let an asker
   * cluster hits by author and erode the floor the k-check just enforced.
   */
  holderPubKey: string;
  publishedAt: string; // ISO 8601
  instanceId: string;
  residency: 'AT' | 'EU';
}

/** What a /query hit exposes. Deliberately omits authorCommitment: returning it would let an
 *  asker cluster hits by author and erode the k-anonymity the floor just enforced. */
export interface DeclarationHit {
  id: string;
  category: string;
  regionCode: string;
  publishedAt: string;
  sealedBody: string;
}

export type StoreRecord =
  | { type: 'publish'; declaration: PublishedDeclaration }
  | { type: 'tombstone'; id: string; at: string };
