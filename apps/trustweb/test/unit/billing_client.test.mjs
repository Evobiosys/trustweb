// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 signup-stripe: the device side of /api/billing (fetch injected) and the "no key in the client" scan. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { billingStatus, planNote, startCheckout } from '../../src/billing/billing_client.ts'

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })
const spy = (r) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return r }; return { f, calls } }

describe('startCheckout', () => {
  it('POSTs plan, email and claim as JSON; returns ref and the hosted Checkout url', async () => {
    const s = spy(reply(200, { ref: 'TW-ABC234', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }))
    const out = await startCheckout(s.f, 'https://app.example', { plan: 'friends', email: ' a@b.de ', claim: 'C'.repeat(43) })
    expect(out).toEqual({ ref: 'TW-ABC234', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    expect(s.calls[0].url).toBe('https://app.example/api/billing/checkout')
    expect(s.calls[0].init.method).toBe('POST')
    expect(JSON.parse(s.calls[0].init.body)).toEqual({ plan: 'friends', email: 'a@b.de', claim: 'C'.repeat(43) })
  })
  it('throws with the server message', async () => {
    await expect(startCheckout(spy(reply(503, { error: 'not_configured', message: 'This feature is not switched on.' })).f, '', { plan: 'regular', email: 'a@b.de', claim: 'x' })).rejects.toThrow('This feature is not switched on.')
  })
  it('refuses a Checkout url that is not https (the app opens it)', async () => {
    await expect(startCheckout(spy(reply(200, { ref: 'TW-ABC234', url: 'javascript:alert(1)' })).f, '', { plan: 'regular', email: 'a@b.de', claim: 'x' })).rejects.toThrow()
  })
})

describe('billingStatus', () => {
  it('GETs with the claim header', async () => {
    const s = spy(reply(200, { state: 'active', plan: 'friends' }))
    expect(await billingStatus(s.f, '', 'TW-ABC234', 'C'.repeat(43))).toEqual({ state: 'active', plan: 'friends' })
    expect(s.calls[0].url).toBe('/api/billing/status?ref=TW-ABC234')
    expect(s.calls[0].init.headers['X-TW-Claim']).toBe('C'.repeat(43))
  })
})

describe('planNote', () => {
  it('Friends carries the one-sentence hot-adjust note, the others none', () => {
    expect(planNote('friends')).toMatch(/15 €/)
    expect(planNote('friends')).toMatch(/3 months/)
    expect(planNote('regular')).toBe('')
    expect(planNote('own')).toBe('')
  })
})

describe('no Stripe key in the client', () => {
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs|html)$/.test(n) ? [p] : [] })
  it('no sk_/rk_/pk_live/whsec_ literal anywhere in apps/trustweb/src', () => {
    const bad = walk(path.resolve('src')).filter((f) => /\b(sk|rk)_(test|live)_|pk_live_|whsec_/.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })
})
