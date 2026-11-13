// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 42 signup-stripe: the paid AI plans. POST /api/billing/checkout, POST /api/billing/webhook, GET /api/billing/status
// (also reachable without the /api prefix). Node stdlib only; Stripe is spoken to over plain HTTPS (no SDK dependency).
//
// BillingProvider (the one coupling point; Mollie plugs in later by implementing the same four members):
//   id                                    'stripe' | 'mollie'
//   configured()                          true when the keys exist
//   createCheckout({plan, euro, email, ref}) -> {url}      a hosted Checkout page for a monthly subscription
//   verifyWebhook(rawBody, signatureHeader) -> event|null  null = not authentic
//   interpret(event) -> {kind:'activated'|'ended', ref?, subscriptionId?, customerId?}|null
//
// KEYS come from the environment only (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; config.mjs) and are never logged or stored.
// The store (BILLING_FILE, JSON, 0600, atomic rewrite) keeps per sign-up: ref, plan, email, sha256 of the device's claim, state, Stripe ids.
// The claim (32 random bytes made on the device) proves a status read is the device's own; it is stored hashed.

import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import { CapExceeded, jsonError, readSmallBody, refuse, sendJson, sha256Hex, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'
import { parseEmail } from './feedback.mjs'

/** The plans that cost money (own keys are free and never reach Checkout). Euro per month, the app's pricing.ts table. */
const PLANS = Object.freeze({ regular: { euro: 20, name: 'TrustWeb AI, Regular' }, friends: { euro: 15, name: 'TrustWeb AI, Friends' } })
const CLAIM_RE = /^[A-Za-z0-9_-]{43}$/
const REF_RE = /^TW-[2-9A-HJKMNP-Z]{6}$/
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const MAX_BODY = 4096
const MAX_WEBHOOK = 65536
const TOLERANCE_S = 300
const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions'

export function newRef() {
  let ref = 'TW-'
  for (let i = 0; i < 6; i += 1) ref += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)]
  return ref
}

/** Stripe over fetch. Signature scheme: header `t=<unix>,v1=<hex>[,v1=...]`, v1 = HMAC-SHA256(whsec, `${t}.${rawBody}`). */
export function stripeProvider({ secretKey, webhookSecret, returnUrl, fetchImpl = fetch, now = Date.now }) {
  return {
    id: 'stripe',
    configured: () => secretKey !== '',
    async createCheckout({ plan, euro, email, ref }) {
      const f = new URLSearchParams({
        mode: 'subscription',
        customer_email: email,
        client_reference_id: ref,
        success_url: `${returnUrl}?billing=done`,
        cancel_url: `${returnUrl}?billing=cancelled`,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'eur',
        'line_items[0][price_data][unit_amount]': String(Math.round(euro * 100)),
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][product_data][name]': plan.name,
        'metadata[ref]': ref,
        'subscription_data[metadata][ref]': ref,
      })
      const res = await fetchImpl(STRIPE_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: f.toString(),
        signal: AbortSignal.timeout(15000),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || typeof body?.url !== 'string') throw new Error(`stripe answered ${res.status}`)
      return { url: body.url }
    },
    verifyWebhook(raw, header) {
      if (webhookSecret === '' || typeof header !== 'string') return null
      const parts = header.split(',').map((p) => p.trim().split('='))
      const t = Number(parts.find(([k]) => k === 't')?.[1])
      if (!Number.isInteger(t) || Math.abs(Math.floor(now() / 1000) - t) > TOLERANCE_S) return null
      const want = crypto.createHmac('sha256', webhookSecret).update(`${t}.`).update(raw).digest()
      const ok = parts.some(([k, v]) => {
        if (k !== 'v1' || !/^[0-9a-f]{64}$/.test(v ?? '')) return false
        return crypto.timingSafeEqual(Buffer.from(v, 'hex'), want)
      })
      if (!ok) return null
      try { return JSON.parse(raw.toString('utf8')) } catch { return null }
    },
    interpret(event) {
      const o = event?.data?.object
      if (event?.type === 'checkout.session.completed') return { kind: 'activated', ref: o?.client_reference_id, subscriptionId: o?.subscription, customerId: o?.customer }
      if (event?.type === 'customer.subscription.deleted') return { kind: 'ended', ref: o?.metadata?.ref, subscriptionId: o?.id }
      return null
    },
  }
}

/** Mollie later: same interface, nothing wired. */
export const mollieStub = Object.freeze({
  id: 'mollie',
  configured: () => false,
  createCheckout: async () => { throw new Error('mollie is not wired yet') },
  verifyWebhook: () => null,
  interpret: () => null,
})

export function createBilling({ cfg, clientOf, withLock, fetchImpl }) {
  const provider = cfg.billingProvider === 'mollie'
    ? mollieStub
    : stripeProvider({ secretKey: cfg.stripeSecretKey, webhookSecret: cfg.stripeWebhookSecret, returnUrl: cfg.billingReturnUrl, fetchImpl, now: cfg.now })
  const limiter = createWindowLimiter({ limit: cfg.billingPerHour, windowMs: 3600000, now: cfg.now })

  async function load() {
    try {
      const rows = JSON.parse(await fsp.readFile(cfg.billingFile, 'utf8'))?.rows
      return rows !== null && typeof rows === 'object' ? rows : {}
    } catch (err) {
      if (err.code === 'ENOENT') return {}
      throw err
    }
  }
  async function save(rows) {
    const tmp = `${cfg.billingFile}.tmp`
    await fsp.writeFile(tmp, JSON.stringify({ v: 1, rows }), { mode: 0o600 })
    await fsp.rename(tmp, cfg.billingFile)
  }
  const update = (change) => withLock('billing-file', async () => {
    const rows = await load()
    const out = await change(rows)
    if (out !== false) await save(rows)
    return out
  })

  async function readJson(req, res, max) {
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return refuse(req, res, 415, 'unsupported_media')
    try { return JSON.parse((await readSmallBody(req, max)).toString('utf8')) } catch (err) {
      return err instanceof CapExceeded ? refuse(req, res, 413, 'too_large') : jsonError(res, 400, 'bad_request', { field: 'body' })
    }
  }

  async function checkout(req, res) {
    if (!provider.configured() || cfg.billingFile === '') return jsonError(res, 503, 'not_configured')
    const hit = limiter.hit(ipKey(clientOf(req)))
    if (hit.limited) return tooManyRequests(res, 'rate_limited', hit.retryAfter)
    const body = await readJson(req, res, MAX_BODY)
    if (typeof body !== 'object' || body === null) return res.writableEnded ? 400 : jsonError(res, 400, 'bad_request', { field: 'body' })
    const plan = Object.hasOwn(PLANS, body.plan) ? PLANS[body.plan] : null
    if (plan === null) return jsonError(res, 400, 'bad_request', { field: 'plan' })
    const email = parseEmail(body.email)
    if (email === null) return jsonError(res, 400, 'bad_request', { field: 'email' })
    if (typeof body.claim !== 'string' || !CLAIM_RE.test(body.claim)) return jsonError(res, 400, 'bad_request', { field: 'claim' })
    let ref = ''
    const stored = await update(async (rows) => {
      if (Object.keys(rows).length >= cfg.billingMax) return false
      do ref = newRef(); while (rows[ref])
      rows[ref] = { ref, plan: body.plan, email, claim_sha256: sha256Hex(body.claim), state: 'pending', created_at: new Date(cfg.now()).toISOString() }
      return true
    })
    if (stored === false) return jsonError(res, 507, 'storage_full')
    try {
      const { url } = await provider.createCheckout({ plan, euro: plan.euro, email, ref })
      sendJson(res, 200, { ref, url })
      return 200
    } catch {
      cfg.log('billing checkout: provider failed')
      await update((rows) => { delete rows[ref] })
      return jsonError(res, 502, 'provider_error')
    }
  }

  async function webhook(req, res) {
    if (!provider.configured() || cfg.billingFile === '' || cfg.stripeWebhookSecret === '') return jsonError(res, 503, 'not_configured')
    let raw
    try { raw = await readSmallBody(req, MAX_WEBHOOK) } catch (err) {
      return err instanceof CapExceeded ? refuse(req, res, 413, 'too_large') : jsonError(res, 400, 'bad_request')
    }
    const event = provider.verifyWebhook(raw, req.headers['stripe-signature'])
    if (event === null) return jsonError(res, 400, 'bad_request', { field: 'signature' })
    const act = provider.interpret(event)
    if (act !== null) {
      const hit = await update((rows) => {
        const row = (act.ref && rows[act.ref]) || Object.values(rows).find((r) => act.subscriptionId && r.stripe_subscription_id === act.subscriptionId)
        if (!row) return false
        const state = act.kind === 'activated' ? 'active' : 'ended'
        if (row.state === state) return false
        row.state = state
        if (act.subscriptionId) row.stripe_subscription_id = act.subscriptionId
        if (act.customerId) row.stripe_customer_id = act.customerId
        return true
      })
      cfg.log(`billing webhook ${act.kind}${hit ? '' : ' (no change)'}`)
    }
    sendJson(res, 200, { received: true })
    return 200
  }

  async function status(req, res, query) {
    if (cfg.billingFile === '') return jsonError(res, 503, 'not_configured')
    const ref = new URLSearchParams(query).get('ref') ?? ''
    const claim = String(req.headers['x-tw-claim'] ?? '')
    const row = REF_RE.test(ref) ? (await load())[ref] : undefined
    const mine = row !== undefined && CLAIM_RE.test(claim) && crypto.timingSafeEqual(Buffer.from(row.claim_sha256, 'hex'), Buffer.from(sha256Hex(claim), 'hex'))
    if (!mine) return jsonError(res, 404, 'not_found')
    sendJson(res, 200, { state: row.state, plan: row.plan })
    return 200
  }

  /** pathname is /api/billing/<x> or /billing/<x>; query is the raw part after "?". */
  async function handle(req, res, pathname, query) {
    const name = pathname.replace(/^\/api/, '').slice('/billing/'.length)
    const route = { checkout: ['POST', checkout], webhook: ['POST', webhook], status: ['GET', status] }[name]
    if (!route) return jsonError(res, 404, 'not_found')
    if (req.method !== route[0]) return jsonError(res, 405, 'method_not_allowed', {}, { Allow: route[0] })
    return route[1](req, res, query)
  }

  return { handle, provider }
}

export const isBillingPath = (p) => /^(\/api)?\/billing\//.test(p)
