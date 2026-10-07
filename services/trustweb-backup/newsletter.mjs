// Forwarding of a newsletter opt-in to the existing subscriber service (wave 2, P14/P15).
//
// The join form of the front door (scripts/tw-front-door/tw_site.py, newsletter_script) posts
//   POST https://subscriber.questhub.eco/subscribe   {"email", "project":"questhub", "source":"trustweb", "gdpr":true}
// and the service answers with a confirmation mail (double opt-in), so a mistyped or foreign address confirms nothing.
// This module posts the same body from the server, and only for an entry whose newsletter box was ticked (feedback.mjs decides).
// The URL comes from SUBSCRIBER_URL only (never from a request); unset or not http(s) = forwarding off, the opt-in stays in the feedback file.

const BODY_CONSTANTS = Object.freeze({ project: 'questhub', source: 'trustweb', gdpr: true })

/** Result of one forward, for the log line only (never the address). */
export const ForwardOutcome = Object.freeze({ Sent: 'sent', Rejected: 'rejected', Failed: 'failed', Off: 'off' })

/** True for an absolute http(s) URL. */
export function isForwardUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Returns {forward(email) -> Promise<{outcome, status?}>}. Never throws, never logs the address, never follows a redirect.
 * A subscriber that is down or slow costs at most `timeoutMs` and never changes the answer to the visitor.
 */
export function createNewsletterForwarder({ cfg, fetchImpl = fetch }) {
  const url = isForwardUrl(cfg.subscriberUrl) ? cfg.subscriberUrl : ''

  async function forward(email) {
    if (url === '') return { outcome: ForwardOutcome.Off }
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...BODY_CONSTANTS }),
        redirect: 'error',
        signal: AbortSignal.timeout(cfg.subscriberTimeoutMs),
      })
      await response.body?.cancel().catch(() => {}) // the answer carries nothing we use; free the socket
      return { outcome: response.ok ? ForwardOutcome.Sent : ForwardOutcome.Rejected, status: response.status }
    } catch {
      return { outcome: ForwardOutcome.Failed }
    }
  }

  return { forward, enabled: url !== '' }
}
