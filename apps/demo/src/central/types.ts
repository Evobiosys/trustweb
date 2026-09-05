/**
 * Wire and result shapes for the opt-in central-RAG client adapter.
 *
 * Pure data, same discipline as `../types.ts`: no DOM, no IndexedDB, no
 * network here. Everything the adapter (`client.ts`, `coarsen.ts`,
 * `consent.ts`) needs to describe a request or a result lives in this file.
 */

// ---------------------------------------------------------------------------
// DeclarationFacets -- duplicated from @resource-web/wot-policy on purpose
// ---------------------------------------------------------------------------

/**
 * Mirrors `@resource-web/wot-policy`'s `DeclarationFacets` (handover
 * section 3) field-for-field. Duplicated here rather than imported because
 * that package may not be built yet when this unit builds (handover, unit
 * U4 note) -- U1 (policy core) and U4 (this adapter) are developed in
 * parallel against the same fixed shape. If `DeclarationFacets` ever changes
 * shape in `packages/wot-policy/src`, this copy MUST change with it; there
 * is no type-level link enforcing that, only this comment.
 */
export interface DeclarationFacets {
  /** Template category, e.g. 'accommodation.sublet'. */
  category: string
  /** Coarse region, e.g. 'AT-9'. Never an address. */
  regionCode: string
  /** Salted hash of the holder DID; equality-comparable, not reversible. */
  authorCommitment: string
  /** Template flagged sensitive -> asker protection applies. */
  sensitive: boolean
}

// ---------------------------------------------------------------------------
// API sketch (handover section 4)
// ---------------------------------------------------------------------------

/** Body of `POST /declarations`. */
export interface PublishRequest {
  facets: DeclarationFacets
  /** Base64url-framed, AES-GCM-sealed holder abstraction. See coarsen.ts. */
  sealedBody: string
  /** D27/F-07 single-author acknowledgement. Required only when the server
   *  would otherwise refuse with `409 { reason: 'sole-author-ack-required' }`. */
  soleAuthorAck?: boolean
}

/** Success response of `POST /declarations` (`201`). */
export interface PublishedRecord {
  id: string
  publishedAt: number
  instanceId: string
  residency: string
}

/** One row of the holder's own backtrace listing, `GET /declarations?authorCommitment=`. */
export interface BacktraceEntry {
  id: string
  publishedAt: number
  instanceId: string
  residency: string
}

/** One hit in a `POST /query` response above floor. The server never returns
 *  identity fields here -- only the coarse facets and the still-sealed body,
 *  the same two things it stored. */
export interface QueryHit {
  id: string
  facets: DeclarationFacets
  sealedBody: string
}

/**
 * `POST /query` response shape. `hits` may legitimately be empty -- I3
 * requires the below-floor, declined and no-match cases to be
 * indistinguishable from each other and from a genuine empty result, so an
 * empty array here carries no information about WHY it is empty.
 */
export interface QueryResponse {
  hits: QueryHit[]
}

/** The jurisdiction config, as served verbatim by `GET /jurisdiction`
 *  (handover section 1). Only the fields the client adapter reads are
 *  declared here; U3 owns the authoritative shape. */
export interface JurisdictionConfig {
  instanceId: string
  residency: string
  operatorContact?: string
  lawfulBasis?: string
  retentionDays?: number
}

/** Reasons the adapter or the server can refuse an operation before/instead
 *  of completing it. */
export type CentralRefusalReason = 'residency-not-allowed' | 'sole-author-ack-required'

/**
 * The one result shape every `client.ts` entry point returns.
 *
 * `'disabled'` -- `centralMode() === 'off'`. No network touched.
 * `'refused'`  -- a policy refusal decided before or instead of a request
 *                 completing (residency not allowed, sole-author-ack missing).
 * `'error'`    -- the request reached the server but it responded with
 *                 something other than success, or the transport itself failed.
 * `'ok'`       -- success, carrying the endpoint's own response shape as `data`.
 */
export type CentralResult<T> =
  | { kind: 'disabled' }
  | { kind: 'refused'; reason: CentralRefusalReason }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'ok'; data: T }
