// The provider chain: one provider with the same shape as the single ones ({name, timeoutMs, supports, transcribe}), made of
// several links tried in order (today: Berget, then OpenRouter as the fallback). Because it IS one provider to transcribe.mjs, the
// job is charged once on our budgets however many links it takes.
//
// A link is skipped when it cannot take the file type (supports(ext) false): its API is never called. A link that FAILS hands over
// to the next only when the failure looks like an outage of that provider, not like something wrong with the request or the account:
//   - the link's own deadline passed, or the call failed without an answer (connection refused, reset, unreadable body): outage
//   - the provider answered 5xx: outage
//   - 4xx (bad request, bad key, no credit, ...) and 429 (busy, come back later): NOT an outage, the job ends there. Falling
//     through on a 4xx would send the same audio to a second (possibly US, paid) provider for a problem that is ours to fix.
// Each link has its own deadline (AbortSignal.any of the chain's overall deadline and the link's timeoutMs), so a slow first link cannot
// eat the second one's time. When the overall deadline passes the chain stops at once (nobody is left to try).
// `onFallback(failure)` runs before the next link starts, so the caller can count a failure that may still have been billed.

import { ProviderError, ProviderFailure } from './transcribe_provider.mjs'

/** True when a failed link looks like an outage of that provider (see above). */
export function isOutage(failure) {
  if (failure.kind === ProviderFailure.Timeout) return true
  return failure.kind === ProviderFailure.Error && (failure.status === null || failure.status >= 500)
}

/** The failure as a ProviderError that says which provider it came from and whether that provider may have taken the job. */
function describeFailure(err, provider, linkSignal, linkJob) {
  const failure = err instanceof ProviderError ? err : new ProviderError(linkSignal.aborted ? ProviderFailure.Timeout : ProviderFailure.Error)
  if (linkSignal.aborted) failure.kind = ProviderFailure.Timeout
  failure.accepted = linkJob.accepted
  failure.provider = provider.name
  return failure
}

export function createProviderChain({ links, onFallback = () => {} }) {
  const supports = (ext) => links.some((p) => p.supports(ext))

  async function transcribe(spool, request, signal, job) {
    const usable = links.filter((p) => p.supports(request.ext))
    let failure = new ProviderError(ProviderFailure.Error) // no link can take this file type: nothing was sent anywhere
    for (const [index, provider] of usable.entries()) {
      const linkJob = { accepted: false }
      const linkSignal = AbortSignal.any([signal, AbortSignal.timeout(provider.timeoutMs)])
      try {
        const transcript = await provider.transcribe(spool, request, linkSignal, linkJob)
        job.accepted = job.accepted || linkJob.accepted
        return { ...transcript, servedBy: provider.name, fellBackFrom: index === 0 ? null : failure.provider }
      } catch (err) {
        failure = describeFailure(err, provider, linkSignal, linkJob)
        job.accepted = job.accepted || linkJob.accepted
        const hasNext = index < usable.length - 1
        if (signal.aborted || !hasNext || !isOutage(failure)) throw failure
        onFallback(failure)
      }
    }
    throw failure
  }

  return {
    name: links.map((p) => p.name).join('+'),
    timeoutMs: links.reduce((sum, p) => sum + p.timeoutMs, 0),
    supports,
    transcribe,
  }
}
