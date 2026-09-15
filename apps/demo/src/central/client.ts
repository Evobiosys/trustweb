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
 *
 * ---------------------------------------------------------------------------
 * SIGNED WITHDRAW AND CLEAR (B-20 option A)
 * ---------------------------------------------------------------------------
 * `publish` registers this device's Ed25519 verification key with the
 * declaration; `withdraw` and `clearAll` sign a canonical message with the
 * matching private key, and the server acts only on records that key
 * published. See `./signing.ts`.
 *
 * The signing key is minted lazily inside `publish`, AFTER the mode check and
 * AFTER the residency gate: a device that never opted into the central layer
 * never generates key material, and `central_signing.test.ts` asserts that
 * rather than trusting the call order to stay put.
 */

import { centralMode } from './mode'
import { getOrCreateSigningKey, signClear, signWithdraw } from './signing'
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

  // First publish mints the device's signing key. Deliberately here and not at
  // module load or at boot: an opted-out device holds no central key material.
  const key = await getOrCreateSigningKey()
  const result = await fetchJson<PublishedRecord>('/declarations', {
    method: 'POST',
    body: JSON.stringify({ ...request, holderPubKey: key.publicKeyB64u }),
  })
  if (!result.ok) {
    const reason = (result.body as { reason?: string } | undefined)?.reason
    if (reason === 'sole-author-ack-required') return { kind: 'refused', reason }
    return { kind: 'error', status: result.status, message: 'publish failed' }
  }
  return { kind: 'ok', data: result.body }
}

/**
 * Withdraw one declaration. Signed with this device's key over
 * {action, target: id, authorCommitment, nonce, expiresAt}.
 *
 * `authorCommitment` is passed in rather than recomputed here because
 * `coarsen.ts` owns that derivation and the caller already has the value from
 * the publish it is undoing.
 */
export async function withdraw(id: string, authorCommitment: string): Promise<CentralResult<void>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  const key = await getOrCreateSigningKey()
  const signed = await signWithdraw(key, id, authorCommitment)
  const result = await fetchJson<void>(`/declarations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify(signed),
  })
  if (!result.ok) return { kind: 'error', status: result.status, message: withdrawErrorMessage(result) }
  return { kind: 'ok', data: undefined }
}

/**
 * Turns the server's refusal reason into something a holder can act on. A
 * failed withdraw or clear must never read as a shrug: this is the path a
 * holder walks when she thinks she overshared.
 */
function withdrawErrorMessage(result: { status: number; body?: unknown }): string {
  const reason = (result.body as { reason?: string } | undefined)?.reason
  if (result.status === 403 && reason === 'signature-required') {
    return 'the instance refused an unsigned request: this client is out of date'
  }
  if (result.status === 403 && reason) return `the instance refused the signature: ${reason}`
  if (result.status === 429) return 'too many withdrawals from this device just now, retry shortly'
  return 'withdraw failed'
}

/**
 * The backtrace half of the debrief's "you may have overshared" path: every
 * declaration this holder ever published centrally, with when and to which
 * jurisdiction instance.
 *
 * Unwraps the server's `{ declarations: [...] }` envelope so the caller gets
 * the array it asked for. (Found by the end-to-end test in
 * `central_backtrace_clear_e2e.test.ts`, which drives this adapter against the
 * real server: the earlier code returned the envelope itself while claiming to
 * return `BacktraceEntry[]`, so every UI reading `.length` would have seen
 * `undefined`.)
 *
 * NOT SIGNED, deliberately, and this is the one place the signing scheme does
 * not reach: an authorCommitment is not a secret, so anyone who learns one can
 * still enumerate that holder's declaration ids, timestamps and residency here.
 * Signing the read is a separate decision, tracked in the central handover's
 * threat notes -- do not read "withdraw and clear are signed" as "a leaked
 * commitment is now worthless".
 */
export async function backtrace(authorCommitment: string): Promise<CentralResult<BacktraceEntry[]>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  const result = await fetchJson<{ declarations: BacktraceEntry[] }>(
    `/declarations?authorCommitment=${encodeURIComponent(authorCommitment)}`,
  )
  if (!result.ok) return { kind: 'error', status: result.status, message: 'backtrace failed' }
  return { kind: 'ok', data: result.body?.declarations ?? [] }
}

/**
 * The direct channel to clear the app (demo-debrief requirement 4): withdraws
 * every central publication of one holder.
 *
 * The `authorCommitment` travels INSIDE the signed payload, never as a
 * top-level field the server could read without checking a signature -- a
 * commitment is a deterministic hash, not a secret, and that is exactly the
 * hole this scheme closes. Scope on the server is doubly bounded: the
 * commitment and the registered key must both match, so this erases only what
 * this device published.
 */
export async function clearAll(authorCommitment: string): Promise<CentralResult<void>> {
  if (centralMode() === 'off') return { kind: 'disabled' }

  const key = await getOrCreateSigningKey()
  const signed = await signClear(key, authorCommitment)
  const result = await fetchJson<void>('/clear', {
    method: 'POST',
    body: JSON.stringify(signed),
  })
  if (!result.ok) return { kind: 'error', status: result.status, message: withdrawErrorMessage(result) }
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
