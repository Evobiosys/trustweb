// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 signup-stripe: the device side of /api/billing. Pure, fetch injected, no DOM, no key: Checkout is hosted by Stripe. */
import { call, type Fetch } from '../ai_subscription'
import { PLAN_NOTES, type BillingPlan } from './pricing'

export interface CheckoutReply { ref: string; url: string }
export interface BillingStatus { state: 'pending' | 'active' | 'ended'; plan: 'regular' | 'friends' }

/** Starts a Checkout. Throws with the server's message; the returned url is https or this throws (the app opens it). */
export async function startCheckout(fetchFn: Fetch, base: string, o: { plan: Exclude<BillingPlan, 'own'>; email: string; claim: string }): Promise<CheckoutReply> {
  const r = await call<CheckoutReply>(fetchFn, `${base}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: o.plan, email: o.email.trim(), claim: o.claim }) })
  if (typeof r?.url !== 'string' || !r.url.startsWith('https://')) throw new Error('The payment page did not open. Try again.')
  return r
}

export const billingStatus = (fetchFn: Fetch, base: string, ref: string, claim: string): Promise<BillingStatus> =>
  call(fetchFn, `${base}/api/billing/status?ref=${encodeURIComponent(ref)}`, { method: 'GET', headers: { 'X-TW-Claim': claim } })

/** The one-sentence explanation shown with a plan ('' for plans that need none). */
export const planNote = (plan: BillingPlan): string => PLAN_NOTES[plan]
