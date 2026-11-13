// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 signup-stripe, end to end on a stock dev server with the billing API faked in the browser (no Stripe, no key):
 * AI button -> plans (Regular, Friends, Own keys) -> Friends -> the hot-adjust note -> email -> Continue to Checkout (the request, then the
 * navigation to the hosted page) -> back in the app the plan shows pending, then Active once the status route says so.
 *   cd apps/trustweb && PLAYWRIGHT_PACKAGE=<playwright-core>/index.mjs CHROMIUM_PATH=<chrome-headless-shell> TW_PORT=5421 TW_SHOTS=<dir> node test/e2e/signup_stripe.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5421)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const errors = []
const vite = await startVite(PORT)
const browser = await launch()
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `signup-stripe-${name}.png`) }) } }
const disjoint = (a, b) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5
/** startPhone of the harness clicks before a cold dev server has attached the handlers; wait for the network to settle first. */
async function start(page) {
  await page.goto(vite.base, { waitUntil: 'networkidle' })
  await page.getByLabel('Your first name').fill('Ana')
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.locator('[data-ai-button]').waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}
/** The sparkle: Your AI directly (assistant off, as in the stock build), or the assistant's explanation with its link to the plans. */
async function openPlans(page) {
  await page.locator('[data-ai-button]').click()
  await page.locator('[data-ai-group="sub"], [data-assistant-plans]').first().waitFor()
  if (await page.locator('[data-assistant-plans]').count()) await page.locator('[data-assistant-plans]').click()
  await page.locator('[data-ai-group="sub"]').waitFor()
}
const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test_e2e'

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const page = await newPhone(browser, errors, { viewport: { width: w, height: h } })
    await page.context().addInitScript(() => { const st = document.createElement('style'); st.textContent = '.twf-ok{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.append(st)) })
    await start(page)
    const posted = []
    let state = 'pending'
    await page.route('**/api/billing/checkout', async (route) => { posted.push(JSON.parse(route.request().postData())); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ref: 'TW-ABC234', url: CHECKOUT }) }) })
    await page.route('**/api/billing/status**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state, plan: 'friends' }) }))
    await page.route(CHECKOUT, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout (test)</h1>' }))

    await openPlans(page)
    const plans = await page.locator('[data-ai-plan]').allInnerTexts()
    c.ok(`${w}: Regular 20 €, Friends 15 €, Own keys free, in order`, plans.length === 3 && /Regular[\s\S]*20 €/.test(plans[0]) && /Friends[\s\S]*15 €/.test(plans[1]) && /Own keys[\s\S]*Free/.test(plans[2]), plans.join(' | '))
    c.ok(`${w}: no Wise instruction anywhere`, !(await page.content()).includes('Wise'))
    c.ok(`${w}: buttons underlined`, await page.locator('[data-ai-signup], [data-ai-own]').evaluateAll((b) => b.length === 3 && b.every((x) => getComputedStyle(x).textDecorationLine.includes('underline'))))
    c.ok(`${w}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await shot(page, `${w}-plans`)

    await page.locator('[data-ai-signup="friends"]').click()
    const note = await page.locator('[data-ai-note]').innerText()
    c.ok(`${w}: Friends sheet carries the hot-adjust sentence`, /at most 15 €/.test(note) && /next 3 months/.test(note), note)
    const boxes = await Promise.all(['[data-ai-back]', 'h3', '[data-ai-note]', '[data-ai-email]', '[data-ai-checkout]'].map((s) => page.locator(s).first().boundingBox()))
    c.ok(`${w}: sheet controls do not overlap each other`, boxes.every((b, i) => b && boxes.every((o, j) => i === j || !o || disjoint(b, o))), JSON.stringify(boxes))
    await shot(page, `${w}-sheet`)

    await page.locator('[data-ai-email]').fill('nope')
    await page.locator('[data-ai-checkout]').click()
    c.ok(`${w}: a bad email is refused before any request`, posted.length === 0 && (await page.locator('[data-ai-signup-error]').innerText()).length > 0)
    await page.locator('[data-ai-email]').fill('anna@example.org')
    await Promise.all([page.waitForURL(CHECKOUT), page.locator('[data-ai-checkout]').click()])
    c.ok(`${w}: the request carries plan, email and a claim; the app goes to the hosted Checkout`, posted.length === 1 && posted[0].plan === 'friends' && posted[0].email === 'anna@example.org' && posted[0].claim.length === 43)

    await page.goto(vite.base, { waitUntil: 'networkidle' })   // Stripe sends the person back to the app
    await page.locator('[data-ai-button]').waitFor({ timeout: 20_000 })
    await openPlans(page)
    await page.locator('[data-ai-bill-state]').waitFor()
    c.ok(`${w}: back in the app the plan waits for confirmation`, (await page.locator('[data-ai-bill-state]').getAttribute('data-ai-bill-state')) === 'pending')
    state = 'active'
    await page.locator('[data-ai-check-now]').click()
    await page.locator('[data-ai-bill-state="active"]').waitFor()
    c.ok(`${w}: once the server says active, the app shows the active plan`, /Active: Friends/.test(await page.locator('[data-ai-bill-state="active"]').innerText()))
    c.ok(`${w}: an active plan offers no second sign-up`, (await page.locator('[data-ai-signup]').count()) === 0)
    await shot(page, `${w}-active`)
    await page.context().close()
  }
} finally {
  await browser.close(); vite.stop()
}
c.ok('no page errors', errors.length === 0, errors.join(' | '))
console.log(`${c.passes} passed, ${c.failures} failed`)
process.exit(c.failures ? 1 : 0)
