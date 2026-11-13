// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 42 signup-stripe: /api/billing/{checkout,webhook,status} against a FAKE Stripe (an injected fetch). No real key exists in this repo:
// the keys below are made-up test strings. No fixed port (ephemeral), so the file may run beside the other suites.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { call, withServer } from './helpers.mjs'

const SECRET = 'sk_test_FAKE-KEY-FOR-TESTS-ONLY'
const WHSEC = 'whsec_FAKEFAKEFAKEFAKEFAKE0123'
const CLAIM = 'A'.repeat(43)
const EMAIL = 'anna@example.org'

/** A fake Stripe: records every request; answers a Checkout Session, or `fail` status. */
function fakeStripe({ fail = 0 } = {}) {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, init, form: new URLSearchParams(init.body) })
    if (fail) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: fail })
    const id = `cs_test_${seen.length}`
    return new Response(JSON.stringify({ id, url: `https://checkout.stripe.com/c/pay/${id}` }), { status: 200 })
  }
  return { seen, fetchImpl }
}

const options = (dir, stripe, extra = {}) => ({
  billingFile: path.join(dir, 'billing.json'),
  stripeSecretKey: SECRET,
  stripeWebhookSecret: WHSEC,
  billingFetchImpl: stripe.fetchImpl,
  billingReturnUrl: 'https://app.example.test/',
  ...extra,
})
const withBilling = (stripe, extra, body) => withServer(0, (dir) => options(dir, stripe, extra), async (ctx) => body({ ...ctx, port: ctx.srv.port }))

const post = (port, url, payload, headers = {}) => call(port, { method: 'POST', url, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) })
const checkout = (port, over = {}, url = '/api/billing/checkout') => post(port, url, { plan: 'friends', email: EMAIL, claim: CLAIM, ...over })
const status = (port, ref, claim = CLAIM) => call(port, { url: `/api/billing/status?ref=${ref}`, headers: { 'X-TW-Claim': claim } })
function webhook(port, event, { secret = WHSEC, t = Math.floor(Date.now() / 1000), sig } = {}) {
  const raw = JSON.stringify(event)
  const v1 = sig ?? crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  return call(port, { method: 'POST', url: '/api/billing/webhook', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` }, body: raw })
}
const completed = (ref, extra = {}) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', client_reference_id: ref, customer: 'cus_1', subscription: 'sub_1', ...extra } } })

test('checkout: Friends builds a hosted subscription Checkout with the email prefilled, 15 EUR a month', async () => {
  const stripe = fakeStripe()
  await withBilling(stripe, {}, async ({ port, dir }) => {
    const r = await checkout(port)
    assert.equal(r.status, 200)
    assert.match(r.json.ref, /^TW-[2-9A-HJKMNP-Z]{6}$/)
    assert.match(r.json.url, /^https:\/\/checkout\.stripe\.com\//)
    const s = stripe.seen[0]
    assert.equal(s.url, 'https://api.stripe.com/v1/checkout/sessions')
    assert.equal(s.init.headers.Authorization, `Bearer ${SECRET}`)
    assert.equal(s.form.get('mode'), 'subscription')
    assert.equal(s.form.get('customer_email'), EMAIL)
    assert.equal(s.form.get('client_reference_id'), r.json.ref)
    assert.equal(s.form.get('line_items[0][price_data][unit_amount]'), '1500')
    assert.equal(s.form.get('line_items[0][price_data][currency]'), 'eur')
    assert.equal(s.form.get('line_items[0][price_data][recurring][interval]'), 'month')
    assert.equal(s.form.get('success_url'), 'https://app.example.test/?billing=done')
    const file = await fs.readFile(path.join(dir, 'billing.json'), 'utf8')
    assert.ok(!file.includes(CLAIM) && !file.includes(SECRET), 'the claim is stored hashed, the key never')
    assert.equal(((await fs.stat(path.join(dir, 'billing.json'))).mode & 0o777), 0o600)
  })
})

test('checkout: Regular is 20 EUR; /billing/* without the /api prefix answers too', async () => {
  const stripe = fakeStripe()
  await withBilling(stripe, {}, async ({ port }) => {
    assert.equal((await checkout(port, { plan: 'regular' }, '/billing/checkout')).status, 200)
    assert.equal(stripe.seen[0].form.get('line_items[0][price_data][unit_amount]'), '2000')
  })
})

test('checkout: bad plan, own keys (free), bad email, bad claim, bad body are 400 and never reach Stripe', async () => {
  const stripe = fakeStripe()
  await withBilling(stripe, { billingPerHour: 100 }, async ({ port }) => {
    for (const over of [{ plan: 'gold' }, { plan: 'own' }, { email: 'nope' }, { email: 'a b@c.de' }, { claim: 'short' }, { claim: 'A'.repeat(42) + '!' }]) {
      assert.equal((await checkout(port, over)).status, 400, JSON.stringify(over))
    }
    assert.equal((await call(port, { method: 'POST', url: '/api/billing/checkout', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400)
    assert.equal(stripe.seen.length, 0)
  })
})

test('checkout: no key -> 503 not_configured; Mollie stays a stub behind the same interface', async () => {
  const stripe = fakeStripe()
  await withBilling(stripe, { stripeSecretKey: '' }, async ({ port }) => assert.equal((await checkout(port)).status, 503))
  await withBilling(stripe, { billingProvider: 'mollie' }, async ({ port }) => assert.equal((await checkout(port)).status, 503))
  assert.equal(stripe.seen.length, 0)
})

test('checkout: Stripe failing -> 502 and no row is kept as pending forever', async () => {
  const stripe = fakeStripe({ fail: 500 })
  await withBilling(stripe, {}, async ({ port, dir }) => {
    const r = await checkout(port)
    assert.equal(r.status, 502)
    assert.ok(!r.text.includes('boom'))
    const rows = JSON.parse(await fs.readFile(path.join(dir, 'billing.json'), 'utf8').catch(() => '{"rows":{}}')).rows
    assert.equal(Object.keys(rows).length, 0)
  })
})

test('checkout: 5 an hour per address, then 429', async () => {
  await withBilling(fakeStripe(), {}, async ({ port }) => {
    for (let i = 0; i < 5; i += 1) assert.equal((await checkout(port)).status, 200)
    assert.equal((await checkout(port)).status, 429)
  })
})

test('status: pending until the webhook; wrong claim and unknown ref look the same (404)', async () => {
  await withBilling(fakeStripe(), {}, async ({ port }) => {
    const { ref } = (await checkout(port)).json
    assert.deepEqual((await status(port, ref)).json, { state: 'pending', plan: 'friends' })
    const wrong = await status(port, ref, 'B'.repeat(43))
    const unknown = await status(port, 'TW-AAAAAA')
    assert.equal(wrong.status, 404)
    assert.equal(unknown.status, 404)
    assert.equal(wrong.text, unknown.text)
  })
})

test('webhook: checkout.session.completed activates the account; replay is harmless; the app sees the plan', async () => {
  await withBilling(fakeStripe(), {}, async ({ port }) => {
    const { ref } = (await checkout(port)).json
    assert.equal((await webhook(port, completed(ref))).status, 200)
    assert.equal((await webhook(port, completed(ref))).status, 200)
    assert.deepEqual((await status(port, ref)).json, { state: 'active', plan: 'friends' })
  })
})

test('webhook: a subscription that ends marks the account ended', async () => {
  await withBilling(fakeStripe(), {}, async ({ port }) => {
    const { ref } = (await checkout(port)).json
    await webhook(port, completed(ref))
    const gone = await webhook(port, { id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1' } } })
    assert.equal(gone.status, 200)
    assert.equal((await status(port, ref)).json.state, 'ended')
  })
})

test('webhook: an event for an unknown ref or an unrelated type is acknowledged (200) and changes nothing', async () => {
  await withBilling(fakeStripe(), {}, async ({ port }) => {
    assert.equal((await webhook(port, completed('TW-ZZZZZZ'))).status, 200)
    assert.equal((await webhook(port, { id: 'evt_3', type: 'charge.refunded', data: { object: {} } })).status, 200)
  })
})

test('webhook: wrong secret, forged v1, missing header and a stale timestamp are 400 and change nothing', async () => {
  await withBilling(fakeStripe(), {}, async ({ port }) => {
    const { ref } = (await checkout(port)).json
    assert.equal((await webhook(port, completed(ref), { secret: 'whsec_other_other_other_other' })).status, 400)
    assert.equal((await webhook(port, completed(ref), { sig: 'ab'.repeat(32) })).status, 400)
    assert.equal((await webhook(port, completed(ref), { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400)
    assert.equal((await call(port, { method: 'POST', url: '/api/billing/webhook', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(completed(ref)) })).status, 400)
    assert.equal((await status(port, ref)).json.state, 'pending')
  })
})

test('webhook: without a webhook secret nothing is trusted (503)', async () => {
  await withBilling(fakeStripe(), { stripeWebhookSecret: '' }, async ({ port }) => assert.equal((await webhook(port, completed('TW-AAAAAA'))).status, 503))
})

test('the secret key is never logged', async () => {
  await withBilling(fakeStripe(), {}, async ({ port, lines }) => {
    await checkout(port)
    assert.ok(!lines.join('\n').includes(SECRET))
  })
})

test('config reads STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY from the environment; absent = empty (the fake/503 path stays the default)', async () => {
  const { loadConfig } = await import('../config.mjs')
  const keep = { s: process.env.STRIPE_SECRET_KEY, p: process.env.STRIPE_PUBLISHABLE_KEY }
  try {
    process.env.STRIPE_SECRET_KEY = SECRET
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_FAKEFAKEFAKE0123'
    const c = loadConfig({})
    assert.equal(c.stripeSecretKey, SECRET)
    assert.equal(c.stripePublishableKey, 'pk_test_FAKEFAKEFAKE0123')
    delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_PUBLISHABLE_KEY
    const none = loadConfig({})
    assert.equal(none.stripeSecretKey, '')
    assert.equal(none.stripePublishableKey, '')
  } finally {
    for (const [k, v] of [['STRIPE_SECRET_KEY', keep.s], ['STRIPE_PUBLISHABLE_KEY', keep.p]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
})
