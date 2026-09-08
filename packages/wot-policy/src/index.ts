// packages/wot-policy — the single source of truth for the anonymity floor and
// asker protection, imported identically by the client and the central-index
// server, so the server can never be more permissive than the device.
//
// Zero runtime dependencies. Node stdlib and Web Crypto only (neither is
// actually needed by this module today, but the constraint is structural,
// not incidental — this package must remain embeddable in either a browser
// bundle or a bare `node:http` server).
//
// Zero imports from apps/demo. CENTRAL_K_FLOOR below is this package's own
// constant; it must never be wired to apps/demo's `kThreshold` scaffolding
// (the `kThreshold: 1` sites in the demo are a different unit's contended
// files, C-03).

/**
 * The central-index layer's own anonymity floor. Not the demo's kThreshold,
 * and not `@resource-web/network-access`'s `DEFAULT_K` (3) either -- this is
 * a separate, deliberately stricter floor for the central (hosted) layer,
 * renamed from `K_FLOOR_DEFAULT` in the k-standardize pass (2026-09-08) so
 * the name says whose floor this is instead of implying it is THE floor.
 * The two constants disagreeing (7 here, 3 in DEFAULT_K) is a real, known
 * gap, not drift -- see docs/k-parameters.md's k4 section for the ❗ open
 * question of whether Jakob keeps 7 or aligns this with DEFAULT_K.
 */
export const CENTRAL_K_FLOOR = 7

/**
 * Coarse, holder-approved facets a `PublishedDeclaration` is indexed under.
 * Never a street address, never verbatim free text — see handover §1 for the
 * full "never leaves the device" list. This type describes only what the
 * central index is allowed to see and match on.
 */
export interface DeclarationFacets {
  /** Template category, e.g. 'accommodation.sublet'. */
  category: string
  /** Coarse region, e.g. 'AT-9'; never an address. */
  regionCode: string
  /** Salted hash of the holder DID: equality-comparable, not reversible. */
  authorCommitment: string
  /** Template flagged sensitive -> asker protection applies. */
  sensitive: boolean
}

export interface FloorInput {
  /** Records already matching the query facets. */
  candidates: DeclarationFacets[]
  /** Defaults to CENTRAL_K_FLOOR. */
  kFloor?: number
}

export type FloorVerdict =
  | { kind: 'above'; distinctAuthors: number }
  | { kind: 'below'; distinctAuthors: number }

/**
 * The anonymity floor counts DISTINCT AUTHORS, never records.
 *
 * Counting records does not anonymise anyone: seven records from one holder
 * clear a floor of seven, and every one of them traces back to her. The
 * floor exists so that what is returned cannot be traced to a single person,
 * which only distinct voices can provide. Mirrors the house rule already
 * proven in apps/demo/src/match/lexical.ts:165-171, restated here as this
 * package's own logic (no import from that file).
 */
export function evaluateFloor(input: FloorInput): FloorVerdict {
  const kFloor = input.kFloor ?? CENTRAL_K_FLOOR
  const authors = new Set<string>()
  for (const candidate of input.candidates) {
    authors.add(candidate.authorCommitment)
  }
  const distinctAuthors = authors.size
  return distinctAuthors >= kFloor
    ? { kind: 'above', distinctAuthors }
    : { kind: 'below', distinctAuthors }
}

/**
 * Single-author rule (D27 / F-07). A higher k constant does not give real
 * k-anonymity to a declaration whose (category, regionCode) facet pair can
 * structurally only ever have come from one author. Such a declaration must
 * be refused at publish time unless the holder gave explicit per-declaration
 * consent, recorded as `soleAuthorAck: true` on the publish request.
 *
 * True when the set of distinct `authorCommitment` values seen for this
 * exact (category, regionCode) pair — the candidate's own commitment plus
 * whatever the corpus already holds for that pair — has at most one member.
 * An empty or single-author corpus for that pair is exactly the defect: the
 * declaration is traceable to one person no matter how large kFloor is.
 */
export function requiresSoleAuthorAck(
  facets: DeclarationFacets,
  corpus: DeclarationFacets[],
): boolean {
  const authors = new Set<string>()
  authors.add(facets.authorCommitment)
  for (const record of corpus) {
    if (record.category === facets.category && record.regionCode === facets.regionCode) {
      authors.add(record.authorCommitment)
    }
  }
  return authors.size <= 1
}

/**
 * Asker protection: strips the asker identity from anything the holder or
 * the server will see when the template is flagged sensitive. Returns a new,
 * equal-shaped object when not sensitive — never mutates the input either
 * way.
 */
export function protectAsker<T extends { askerDid?: string; askerLabel?: string }>(
  payload: T,
  sensitive: boolean,
): T {
  const copy = { ...payload }
  if (!sensitive) return copy
  const { askerDid, askerLabel, ...rest } = copy
  return rest as T
}

// I3. The one and only response body for below-k, declined and no-match
// alike. A distinct body, a 404, or a faster no-match path for any one of
// these three cases breaks I3 and is a stop-and-flag defect — every call
// site must construct its "no" by calling indistinguishableNo(), never by
// hand-building JSON.
const INDISTINGUISHABLE_NO_SOURCE: Uint8Array = new TextEncoder().encode(
  JSON.stringify({ ok: false }),
)

/**
 * I3. Byte-identical across every below-k, declined and no-match construction
 * site. Returns a fresh copy each call so a caller may transfer the buffer
 * without corrupting the shared source.
 */
export function indistinguishableNo(): Uint8Array {
  return INDISTINGUISHABLE_NO_SOURCE.slice()
}

/**
 * I3 timing half. Resolves no earlier than t0 + budgetMs regardless of how
 * much or little work the caller did in between, so a fast decline and a
 * slow lookup are not distinguishable by response latency. Matches the house
 * style of apps/demo/src/gate.ts's settleAt (restated here, not imported —
 * this package must not depend on apps/demo).
 */
export function settleAt(t0: number, budgetMs: number): Promise<void> {
  const target = t0 + budgetMs
  const remaining = target - Date.now()
  if (remaining <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, remaining))
}

/** Default response budget for every central-index endpoint (handover §4). */
export const CENTRAL_BUDGET_MS = 900
