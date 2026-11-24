// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-roster (stock data only, THREE phones over a REAL test relay, as a44d_event_joined.mjs): Hanna hosts; Anna and Ben each connect only to her
 * and join. Anna and Ben are NOT connected to each other. (1) event "Winter OG" with "Everyone can see everyone": each sees the other under
 * People at this event, "via Hanna"; (2) event of an intimate community without that flag: the same. 360x780; TW_WIDE=1 for 1280x900.
 *   cd apps/demo && TW_PORT=5481 TW_VITE=<vite.js> TW_CHROMIUM_EXE=<chromium> PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/a44d_event_joined.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5481)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS ?? process.env.SHOTS
const VIEW = process.env.TW_WIDE ? { width: 1280, height: 900 } : { width: 360, height: 780 }
const t = tally()
const errors = []
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const appears = (locator, ms = 10_000) => locator.waitFor({ timeout: ms }).then(() => true, () => false)
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const setRecord = (page, fn) => page.evaluate((src) => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); new Function('r', src)(r); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, fn)

async function newPhone(browser, server) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: !process.env.TW_WIDE, ignoreHTTPSErrors: true })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await ctx.addInitScript(() => { addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.twf, .twf-ok { display: none !important }'; document.head.append(s) }) })
  await server.install(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return { ctx, page }
}

async function startPhone(page, name) {
  await page.goto(ORIGIN + '/')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1500)
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

const openEventPage = async (page, id) => {
  await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
  if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').evaluate((n) => n.click())
  await page.waitForTimeout(200)
  await page.locator(`[data-event="${id}"]`).evaluate((n) => n.click()); await page.waitForTimeout(400)
}

async function guestJoins(browser, server, name, payload) {
  const g = await newPhone(browser, server)
  await startPhone(g.page, name)
  await g.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
  if (!(await appears(g.page.locator('[data-connect-add]'), 20_000))) throw new Error(name + ': no connect sheet')
  await g.page.locator('[data-connect-add]').click()
  if (!(await appears(g.page.locator('[data-event-join]'), 15_000))) throw new Error(name + ': no join button')
  await g.page.locator('[data-event-join]').click(); await g.page.waitForTimeout(600)
  return g
}

async function scenario(browser, server, label, evId, hostRecord) {
  const h = await newPhone(browser, server)
  await startPhone(h.page, 'Hanna')
  await setRecord(h.page, hostRecord)
  await h.page.reload(); await h.page.waitForTimeout(1200)
  await openEventPage(h.page, evId)
  await h.page.locator('[data-event-qr]').click(); await h.page.waitForTimeout(1200)
  const payload = await h.page.getAttribute('[data-qr-modes]', 'data-payload')
  const a = await guestJoins(browser, server, 'Anna', payload)
  const b = await guestJoins(browser, server, 'Ben', payload)
  if (label === 'intimate') { // iyg-reviewfix F1: without the host's showAll only a guest who shows 'open' is named; the new mode reaches the host as a fresh rsvp
    for (const g of [a, b]) { await openEventPage(g.page, evId); await g.page.locator('[data-event-visibility-opt="open"]').evaluate((n) => n.click()); await g.page.waitForTimeout(600) }
  }
  const peers = async (p) => (await record(p)).peers.length
  t.ok(label + ': Anna and Ben are each connected only to Hanna', (await peers(a.page)) === 1 && (await peers(b.page)) === 1)
  for (const [me, other, otherName] of [[a, b, 'Ben'], [b, a, 'Anna']]) {
    const got = await until(async () => (await record(me.page)).people.find((p) => p.name === otherName && p.via))
    t.ok(label + ': ' + (otherName === 'Ben' ? 'Anna' : 'Ben') + ' receives ' + otherName + ' as a via person (seen.event ' + evId + ')', got?.seen?.event === evId, JSON.stringify(got))
    await me.page.reload(); await me.page.waitForTimeout(1200)
    await me.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
    await openEventPage(me.page, evId)
    const row = me.page.locator('[data-event-people-list] [data-person-chip]', { hasText: new RegExp('^' + otherName) })
    t.ok(label + ': People at this event lists ' + otherName + ' "via Hanna"', (await row.count()) === 1 && /via Hanna/.test(await row.innerText()))
    await shot(me.page, `iyg-roster-${label}-${otherName === 'Ben' ? 'anna' : 'ben'}.png`)
    if (label === 'showall') {
      await row.click(); await me.page.waitForTimeout(500)
      t.ok(label + ': tap opens the seen-through card (Ask Hanna to introduce)', /Ask Hanna to introduce/.test(await me.page.locator('body').innerText()))
      await me.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
    }
  }
  await h.ctx.close(); await a.ctx.close(); await b.ctx.close()
}

async function main() {
  const app = await startApp(PORT, { audiences: [ORIGIN] })
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch([...front.browserArgs])
    const server = fakeConnectServer(ORIGIN)
    const ev = (extra) => `r.events = [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', to: '2027-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], ${extra} }]`
    await scenario(browser, server, 'showall', 'e1', ev('showAll: true'))
    await scenario(browser, server, 'intimate', 'e1', ev("communityId: 'iyg'") + `; r.extData = { ...(r.extData || {}), 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: ['me'], intimate: true } } } }`)
    t.ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser?.close()
    await front?.stop?.()
    await app.stop()
  }
  console.log(t.failures ? `FAILED ${t.failures}` : 'ALL PASS')
  process.exit(t.failures ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
