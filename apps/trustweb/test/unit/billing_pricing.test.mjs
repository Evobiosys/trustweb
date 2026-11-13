// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 signup-stripe: pricing engine phase 1 (P01). Table tests; euro amounts, cents precision. */
import { BILLING_PLANS, PRICES, monthlyBill, nextHistory } from '../../src/billing/pricing.ts'

describe('plans', () => {
  it('regular 20, friends 15 (the high mark), own keys free; the list is in display order', () => {
    expect(PRICES).toEqual({ regular: 20, friends: 15, own: 0 })
    expect(BILLING_PLANS.map((p) => p.id)).toEqual(['regular', 'friends', 'own'])
  })
})

describe('monthlyBill', () => {
  const fresh = {}
  const table = [
    // [name, plan, usage, history, charge, refunds, newRunning, alert]
    ['friends first month, used 6 of 15: pays 15, 9 returned as 3+3+3, running bill 6', 'friends', 6, fresh, 15, [3, 3, 3], 6, undefined],
    ['friends month 2 (running 6, credits 3,3,3), used 6: pays 3', 'friends', 6, { runningBill: 6, credits: [3, 3, 3] }, 3, [], 6, undefined],
    ['friends month 4 (running 6, no credits left), used 6: pays 6', 'friends', 6, { runningBill: 6, credits: [] }, 6, [], 6, undefined],
    ['friends used 10 against running 6: no retro charge, running rises to 10', 'friends', 10, { runningBill: 6, credits: [] }, 6, [], 10, undefined],
    ['friends used 2 against running 6: 4 returned as 1.33+1.33+1.34', 'friends', 2, { runningBill: 6, credits: [] }, 6, [1.34, 1.33, 1.33], 2, undefined],
    ['friends odd cents: 15 - 5.5 = 9.5 -> 3.17+3.17+3.16', 'friends', 5.5, fresh, 15, [3.17, 3.17, 3.16], 5.5, undefined],
    ['friends used 0: all 15 returned as 5+5+5, running 0', 'friends', 0, fresh, 15, [5, 5, 5], 0, undefined],
    ['friends used 18 > high mark 15: running capped at 15, alert 3 over, extra credits offered', 'friends', 18, fresh, 15, [], 15, { kind: 'over-plan', overEur: 3, offer: 'extra-credits' }],
    ['friends credit larger than the bill never makes a negative charge', 'friends', 3, { runningBill: 3, credits: [5] }, 0, [], 3, undefined],
    ['regular used 5: pays 20 flat, nothing returned', 'regular', 5, fresh, 20, [], 20, undefined],
    ['regular used 25: pays 20, alert 5 over', 'regular', 25, fresh, 20, [], 20, { kind: 'over-plan', overEur: 5, offer: 'extra-credits' }],
    ['own keys: free, no alert whatever the use', 'own', 99, fresh, 0, [], 0, undefined],
  ]
  it.each(table)('%s', (_n, plan, usage, history, charge, refunds, running, alert) => {
    const r = monthlyBill(plan, usage, history)
    expect(r.charge).toBe(charge)
    expect(r.refundsScheduled).toEqual(refunds)
    expect(r.newRunningBill).toBe(running)
    expect(r.alert).toEqual(alert)
  })

  it('refunds always add up to the difference, to the cent', () => {
    for (const used of [0, 0.01, 1.01, 7.77, 14.99]) {
      const r = monthlyBill('friends', used, {})
      expect(Math.round(r.refundsScheduled.reduce((a, b) => a + b, 0) * 100)).toBe(Math.round((15 - used) * 100))
    }
  })

  it('rejects a negative or non-finite use', () => {
    expect(() => monthlyBill('friends', -1, {})).toThrow()
    expect(() => monthlyBill('friends', Number.NaN, {})).toThrow()
  })
})

describe('nextHistory: three months as Jakob dictated (used 6 each month)', () => {
  it('pays 15, then 3, 3, 3, then 6', () => {
    let h = {}
    const paid = []
    for (let m = 0; m < 5; m += 1) {
      const r = monthlyBill('friends', 6, h)
      paid.push(r.charge)
      h = nextHistory(h, r)
    }
    expect(paid).toEqual([15, 3, 3, 3, 6])
  })
})
