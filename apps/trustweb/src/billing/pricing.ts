// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 signup-stripe, pricing engine phase 1 (policy P01, Jakob 2026-11-12). Pure: no I/O, no clock.
 * Regular 20 EUR a month, flat. Friends: 15 EUR is the HIGH MARK; the running bill follows the real use. When a month's use
 * stays below the running bill, the difference comes back as 3 equal deductions over the next 3 months and the running bill
 * drops to that use (no inflation adjustment). Own keys: free. Use above the plan raises an alert that offers extra credits.
 * Reading of the dictation (see the result report): "used 6 of 15 -> give back 9 as 3, 3, 3, then pay 3, 3, 3 and the bill is 6".
 */
export type BillingPlan = 'regular' | 'friends' | 'own'

export const PRICES: Record<BillingPlan, number> = { regular: 20, friends: 15, own: 0 }
/** Display order of the plan chooser. */
export const BILLING_PLANS: readonly { id: BillingPlan; euro: number }[] = [
  { id: 'regular', euro: PRICES.regular },
  { id: 'friends', euro: PRICES.friends },
  { id: 'own', euro: PRICES.own },
]

export const REFUND_MONTHS = 3

/** The one-sentence explanation shown beside a plan ('' = none). Plain text, shared by the app and the MCP tools (no import here: node loads this file). */
export const PLAN_NOTES: Record<BillingPlan, string> = {
  regular: '',
  friends: 'You pay for what you use, at most 15 € a month: if a month costs less, the difference comes back over the next 3 months and your bill follows your use.',
  own: '',
}

export interface BillingHistory {
  /** The bill carried into this month (absent: the plan's price). */
  runningBill?: number
  /** Deductions queued; credits[0] applies to THIS month's charge. */
  credits?: number[]
}
export interface OverPlanAlert { kind: 'over-plan'; overEur: number; offer: 'extra-credits' }
export interface MonthlyBill { charge: number; refundsScheduled: number[]; newRunningBill: number; alert?: OverPlanAlert }

const cents = (eur: number): number => Math.round(eur * 100)
const eur = (c: number): number => c / 100

/** `totalCents` in `parts` equal shares; the remainder cents go to the earliest shares. */
function split(totalCents: number, parts: number): number[] {
  const base = Math.floor(totalCents / parts)
  const extra = totalCents - base * parts
  return Array.from({ length: parts }, (_, i) => eur(base + (i < extra ? 1 : 0)))
}

/** The month's result for `plan` after `usageEur` of real use (the projected use serves as well for the heads-up). */
export function monthlyBill(plan: BillingPlan, usageEur: number, history: BillingHistory): MonthlyBill {
  if (!Number.isFinite(usageEur) || usageEur < 0) throw new Error('usage must be a number of euro, 0 or more')
  const mark = PRICES[plan]
  if (plan === 'own') return { charge: 0, refundsScheduled: [], newRunningBill: 0 }
  const running = cents(history.runningBill ?? mark)
  const charge = Math.max(0, running - cents(history.credits?.[0] ?? 0))
  const used = cents(usageEur)
  const over = used - cents(mark)
  const alert: OverPlanAlert | undefined = over > 0 ? { kind: 'over-plan', overEur: eur(over), offer: 'extra-credits' } : undefined
  if (plan === 'regular') return { charge: eur(charge), refundsScheduled: [], newRunningBill: mark, ...(alert ? { alert } : {}) }
  const refund = Math.max(0, running - used)
  return {
    charge: eur(charge),
    refundsScheduled: refund > 0 ? split(refund, REFUND_MONTHS) : [],
    newRunningBill: eur(Math.min(used, cents(mark))),
    ...(alert ? { alert } : {}),
  }
}

/** The history for the next month: this month's credit is spent, the new deductions join the queue. */
export function nextHistory(history: BillingHistory, result: MonthlyBill): BillingHistory {
  const left = (history.credits ?? []).slice(1)
  const n = Math.max(left.length, result.refundsScheduled.length)
  const credits = Array.from({ length: n }, (_, i) => eur(cents(left[i] ?? 0) + cents(result.refundsScheduled[i] ?? 0)))
  return { runningBill: result.newRunningBill, credits }
}
