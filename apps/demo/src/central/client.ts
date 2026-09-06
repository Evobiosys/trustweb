/**
 * Client for the opt-in central index (handover section 4).
 *
 * ---------------------------------------------------------------------------
 * OFF BY DEFAULT, PROVABLY
 * ---------------------------------------------------------------------------
 * Every exported entry point below starts with
 * `if (centralMode() === 'off') return { kind: 'disabled' }` as its very
 * first statement, before any URL string is built and before `fetch` is
 * named. This is not "off means don't bother sending it" -- it is "off means
 * the network is never touched": no `fetch()` call is constructed, no
 * `centralOrigin()`/path template is evaluated, nothing. See
 * `central_adapter.test.ts`, which stubs `globalThis.fetch` with a spy that
 * throws and asserts it is never invoked while the mode is off.
 *
 * ---------------------------------------------------------------------------
 * RESIDENCY GATE
 * ---------------------------------------------------------------------------
 * Before any publish, the client checks the instance's residency (`GET
 * /jurisdiction`) against an allowlist, default `['AT', 'EU']`, and refuses
 * with `{ kind: 'refused', reason: 'residency-not-allowed' }` rather than
 * sending the declaration. This runs only for `publish` -- `withdraw`,
 * `backtrace`, `clearAll` and `queryCentral` do not create new central
 * exposure, so they are not gated the same way.
 *
 * ---------------------------------------------------------------------------
 * SEALED SENDER
 * ---------------------------------------------------------------------------
 * `queryCentral` strips the asker identity fields (`askerDid`, `askerLabel`)
 * out of the request body BEFORE it is built whenever `facets.sensitive` is
 * `true` -- the fields are never assigned onto the body object at all, not
 * assigned-then-deleted.
 */

import { centralMode } from './mode'
import type {
  BacktraceEntry,
  CentralResult,
  DeclarationFacets,
  JurisdictionConfig,
  PublishRequest,
  PublishedRecord,
  QueryResponse,
} from './types'

export const DEFAULT_RESIDENCY_ALLOWLIST: readonly string[] = ['AT', 'EU']
const DEFAULT_ORIGIN = 'http://127.0.0.1:4187'

function centralOrigin(): string {
  return import.meta.env?.VITE_WOT_CENTRAL_ORIGIN || DEFAULT_ORIGIN
}

type FetchOutcome<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body?: unknown }

async function fetchJson<T>(path: string, init?: RequestInit): Promise<FetchOutcome<T>> {
  const res = await fetch(`${centralOrigin()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  if (!res.ok) return { ok: false, status: res.status, body }
  return { ok: true, status: res.status, body: body as T }
}

/**
 * Fetch `GET /jurisdiction` and check its `residency` against `allowlist`.
 * Returns a refusal/error `CentralResult` to short-circuit the caller, or
 * `null` when residency is allowed. Only called from `publish` -- see the
 * module doc comment.
 */
async function checkResidency<T>(
  allowlist: readonly string[],
): Promise<CentralResult<T> | null> {
  const result = await fetchJson<JurisdictionConfig>('/jurisdiction')
  if (!result.ok) {
    return { kind: 'error', status: result.status, message: 'jurisdiction check failed' }
  }
  if (!allowlist.includes(result.body.residency)) {
    return { kind: 'refused', reason: 'residency-not-allowed' }
  }
  return null
}

export async function publish(
  request: PublishRequest,
  opts?: { residencyAllowlist?: readonly string[] },
): Promise<CentralResult<PublishedRecord>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  const refusal = await checkResidency<PublishedRecord>(
    opts?.residencyAllowlist ?? DEFAULT_RESIDENCY_ALLOWLIST,
  )
  if (refusal) return refusal

  const result = await fetchJson<PublishedRecord>('/declarations', {
    method: 'POST',
    body: JSON.stringify(request),
  })
  if (!result.ok) {
    const reason = (result.body as { reason?: string } | undefined)?.reason
    if (reason === 'sole-author-ack-required') return { kind: 'refused', reason }
    return { kind: 'error', status: result.status, message: 'publish failed' }
  }
  return { kind: 'ok', data: result.body }
}

export async function withdraw(id: string, signedProof: string): Promise<CentralResult<void>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  const result = await fetchJson<void>(`/declarations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ proof: signedProof }),
  })
  if (!result.ok) return { kind: 'error', status: result.status, message: 'withdraw failed' }
  return { kind: 'ok', data: undefined }
}

export async function backtrace(authorCommitment: string): Promise<CentralResult<BacktraceEntry[]>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  const result = await fetchJson<BacktraceEntry[]>(
    `/declarations?authorCommitment=${encodeURIComponent(authorCommitment)}`,
  )
  if (!result.ok) return { kind: 'error', status: result.status, message: 'backtrace failed' }
  return { kind: 'ok', data: result.body }
}

/** The direct channel to clear the app (demo-debrief requirement 4):
 *  withdraws every central publication of one holder. */
export async function clearAll(authorCommitment: string, signedProof: string): Promise<CentralResult<void>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  const result = await fetchJson<void>('/clear', {
    method: 'POST',
    body: JSON.stringify({ authorCommitment, proof: signedProof }),
  })
  if (!result.ok) return { kind: 'error', status: result.status, message: 'clear failed' }
  return { kind: 'ok', data: undefined }
}

export async function queryCentral(
  facets: DeclarationFacets,
  asker?: { askerDid?: string; askerLabel?: string },
): Promise<CentralResult<QueryResponse>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  // Sealed sender: when the template is sensitive, the asker identity
  // fields are never assigned onto the body at all -- see the module doc
  // comment.
  const body: { facets: DeclarationFacets; askerDid?: string; askerLabel?: string } = { facets }
  if (!facets.sensitive) {
    if (asker?.askerDid) body.askerDid = asker.askerDid
    if (asker?.askerLabel) body.askerLabel = asker.askerLabel
  }

  const result = await fetchJson<QueryResponse>('/query', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!result.ok) return { kind: 'error', status: result.status, message: 'query failed' }
  return { kind: 'ok', data: result.body }
}
