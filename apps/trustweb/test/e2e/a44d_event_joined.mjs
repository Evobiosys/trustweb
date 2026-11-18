// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 4c (stock data only, two phones over a REAL test relay, as event_qr_join.mjs): Anna hosts the community event "Winter OG" and
 * shows its QR; Ben scans it, adds Anna and joins. Ben's device sends a sealed `joined`; on Anna's device Ben is marked joined: her event page lists
 * him under Joining, and (community audience, the default) he carries the community tag. 360x780; TW_WIDE=1 for 1280x900.
 *   cd apps/demo && TW_PORT=5487 TW_VITE=<vite.js> TW_CHROMIUM_EXE=<chromium> PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/a44d_event_joined.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5441)
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

async function main() {
  const app = await startApp(PORT, { audiences: [ORIGIN] })
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch([...front.browserArgs])
    const server = fakeConnectServer(ORIGIN)
    const a = await newPhone(browser, server)
    await startPhone(a.page, 'Anna')
    await setRecord(a.page, `r.events = [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', to: '2027-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Anna'], communityId: 'iyg' }]; r.extData = { ...(r.extData || {}), 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: ['me'] } } } }`)
    await a.page.reload(); await a.page.waitForTimeout(1200)
    await openEventPage(a.page, 'e1')
    t.ok('A: before: nobody joins', (await a.page.locator('[data-event-joining]').getAttribute('data-event-joining')) === '0')
    await a.page.locator('[data-event-qr]').click(); await a.page.waitForTimeout(1200)
    const payload = await a.page.getAttribute('[data-qr-modes]', 'data-payload')
    const b = await newPhone(browser, server)
    await startPhone(b.page, 'Ben')
    await b.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
    t.ok('B: the connect add sheet shows first', await appears(b.page.locator('[data-connect-add]'), 20_000))
    await b.page.locator('[data-connect-add]').click()
    t.ok('B: the event sheet says who will see that I joined', await appears(b.page.locator('[data-event-join-note]'), 15_000))
    await shot(b.page, 'answers-44d-joined-b-sheet.png')
    await b.page.locator('[data-event-join]').click(); await b.page.waitForTimeout(600)
    const joined = await until(async () => (await record(a.page)).people.find((p) => p.name === 'Ben' && p.events?.includes('e1')))
    t.ok('A: Ben is marked joined on Anna\'s device (sealed joined envelope)', !!joined)
    t.ok('A: as an acquainted community member (community audience, the default)', joined?.fields?.iyg === 'true', JSON.stringify(joined?.fields))
    await a.page.reload(); await a.page.waitForTimeout(1200)
    await a.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
    await openEventPage(a.page, 'e1')
    t.ok('A: the event page lists Ben under Joining', (await a.page.locator('[data-event-joining-list] [data-person-chip]').count()) === 1 && /Ben/.test(await a.page.locator('[data-event-joining-list]').innerText()))
    await shot(a.page, 'answers-44d-joined-a-page.png')
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
