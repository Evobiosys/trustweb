// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 signup-stripe, MCP parity: what the app's "Your AI > Sign up" does, as tools. billing_plans and billing_status read; billing_checkout_link
 * (offered only with writes on) asks the server for a hosted Stripe Checkout page and keeps the sign-up (ref + the device's claim) in the record's
 * advanced.ai.bill, the same place the app keeps it, so the app shows the same plan. The claim never leaves the record; no Stripe key is ever here.
 * Self-contained on purpose: node loads this file directly, so it imports only pricing.ts (no imports of its own).
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { BILLING_PLANS, PLAN_NOTES, type BillingPlan } from '../../trustweb/src/billing/pricing.ts'
import type { Tool } from './protocol.ts'

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
type Bill = { plan: string; ref: string; email: string; claim: string; state: string }
type Rec = { advanced?: { ai?: { bill?: Bill } & Record<string, unknown> } } & Record<string, unknown>

export interface BillingToolsOptions { file: string; write: boolean; apiBase: string; fetchImpl?: Fetch }

const NAMES: Record<BillingPlan, string> = { regular: 'Regular', friends: 'Friends', own: 'Own keys' }
const EMAIL = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/

export function billingTools(o: BillingToolsOptions): Tool[] {
  const net: Fetch = o.fetchImpl ?? ((url, init) => fetch(url, init))
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  /** Not the edit stream: the record's people are unchanged, only the device's own sign-up note is added. Atomic replace. */
  const save = (r: Rec): void => { const tmp = o.file + '.tmp'; writeFileSync(tmp, JSON.stringify(r)); renameSync(tmp, o.file) }
  async function call<T>(url: string, init: Parameters<Fetch>[1]): Promise<T> {
    const res = await net(url, init)
    const body = await res.json().catch(() => null) as { message?: string; error?: unknown } | null
    if (!res.ok) throw new Error(body?.message ?? (typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`))
    return body as T
  }
  const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

  const read: Tool[] = [
    {
      name: 'billing_plans', description: 'The AI plans: id, name, euro per month and a one-line note (Friends: pay for what you use, at most 15 €). Own keys are free.',
      inputSchema: schema({}),
      run: () => BILLING_PLANS.map((p) => ({ id: p.id, name: NAMES[p.id], euroPerMonth: p.euro, note: PLAN_NOTES[p.id] })),
    },
    {
      name: 'billing_status', description: 'The state of the paid AI plan signed up for on this device: none, pending (payment not confirmed yet), active or ended.',
      inputSchema: schema({}),
      run: async () => {
        const r = load()
        const bill = r.advanced?.ai?.bill
        if (!bill) return { state: 'none' }
        const s = await call<{ state: string; plan: string }>(`${o.apiBase}/api/billing/status?ref=${encodeURIComponent(bill.ref)}`, { method: 'GET', headers: { 'X-TW-Claim': bill.claim } })
        if (s.state !== bill.state) { bill.state = s.state; save(r) }
        return { state: s.state, plan: s.plan, ref: bill.ref }
      },
    },
  ]
  const write: Tool[] = [{
    name: 'billing_checkout_link', description: 'Sign up for a paid AI plan: returns the hosted Checkout page (Stripe) to open and pay on. Use billing_status afterwards.',
    inputSchema: schema({ plan: { type: 'string', description: 'regular or friends' }, email: { type: 'string', description: 'the email Checkout is prefilled with' } }, ['plan', 'email']),
    run: async (a) => {
      const plan = a.plan === 'regular' || a.plan === 'friends' ? a.plan : null
      if (!plan) throw new Error('plan must be regular or friends (own keys are free: nothing to buy)')
      const email = typeof a.email === 'string' ? a.email.trim() : ''
      if (!EMAIL.test(email) || email.length > 254) throw new Error('email is not a valid address')
      const claim = randomBytes(32).toString('base64url')
      const r = await call<{ ref: string; url: string }>(`${o.apiBase}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, email, claim }) })
      if (typeof r.url !== 'string' || !r.url.startsWith('https://')) throw new Error('the payment page did not open')
      const rec = load()
      const ai = (rec.advanced ??= {}).ai ??= { preset: 'custom', baseUrl: '', apiKey: '', model: '' }
      ai.bill = { plan, ref: r.ref, email, claim, state: 'pending' }
      save(rec)
      return { ref: r.ref, url: r.url }
    },
  }]
  return o.write ? [...read, ...write] : read
}
