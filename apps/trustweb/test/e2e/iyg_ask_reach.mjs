// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-ask-reach (stock data only, three phones over a REAL test relay): host Hana shows the event QR; Anna and Ben each scan it, so Anna-Hana and Ben-Hana
 * are connected and Anna-Ben are not. Anna opens "Ask the people here for support" on the event page (the event preselected), sends: Hana's device passes it on once;
 * Ben's card reads "Anna could use support ... (via Hana)"; Ben taps "I'm here"; Anna's line names Ben (answered through the host).
 *   cd apps/demo && TW_PORT=5482 TW_VITE=<vite.js> TW_CHROMIUM_EXE=<chromium> PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/iyg_ask_reach.mjs
 * TW_WIDE=1 for 1280x900, TW_SHOTS=<dir> for screens.
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5482)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS ?? process.env.SHOTS
const VIEW = process.env.TW_WIDE ? { width: 1280, height: 900 } : { width: 360, height: 780 }
const t = tally()
const errors = []
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 25_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
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

/** Scans the host's event QR: connects to the host and joins the event. */
async function scanAndJoin(phone, payload) {
  await phone.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
  await appears(phone.page.locator('[data-connect-add]'), 20_000)
  await phone.page.locator('[data-connect-add]').click()
  await appears(phone.page.locator('[data-event-join]'), 15_000)
  await phone.page.locator('[data-event-join]').click(); await phone.page.waitForTimeout(800)
  await phone.page.goto(ORIGIN + '/'); await phone.page.waitForTimeout(1200)
}

async function main() {
  const app = await startApp(PORT, { audiences: [ORIGIN] })
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch([...front.browserArgs])
    const server = fakeConnectServer(ORIGIN)
    const h = await newPhone(browser, server)
    await startPhone(h.page, 'Hana')
    await setRecord(h.page, `r.events = [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', to: '2027-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hana'], offers: { support: true } }]`)
    await h.page.reload(); await h.page.waitForTimeout(1200)
    await openEventPage(h.page, 'e1')
    await h.page.locator('[data-event-qr]').click(); await h.page.waitForTimeout(1200)
    const payload = await h.page.getAttribute('[data-qr-modes]', 'data-payload')
    const a = await newPhone(browser, server)
    await startPhone(a.page, 'Anna')
    await scanAndJoin(a, payload)
    const b = await newPhone(browser, server)
    await startPhone(b.page, 'Ben')
    await scanAndJoin(b, payload)
    const hr = await until(async () => { const r = await record(h.page); return r.people.filter((p) => p.events?.includes('e1') && p.peerId).length >= 2 ? r : null })
    t.ok('H: Anna and Ben are both connected and joined', !!hr, JSON.stringify((await record(h.page)).people.map((p) => [p.name, p.events])))
    const ar = await record(a.page)
    t.ok('A: knows Hana only (not Ben)', ar.people.some((p) => p.name === 'Hana') && !ar.people.some((p) => p.name === 'Ben'))

    await setRecord(a.page, `for (const e of r.events) e.offers = { ...e.offers, support: true }`)   // the host's "Ask for support" switch
    await a.page.reload(); await a.page.waitForTimeout(1200)
    // Anna: event page -> Ask the people here for support (the event preselected)
    await openEventPage(a.page, 'e1')
    await a.page.locator('[data-event-ask-support]').click(); await a.page.waitForTimeout(500)
    t.ok('A: the event is preselected as an Also include chip', await appears(a.page.locator('[data-aud-chips="add"] [data-aud-chip="event:e1"]'), 3000))
    t.ok('A: the line says Hana passes it on', /Hana passes it on to everyone at Winter OG/.test(await a.page.locator('[data-support-passon]').innerText().catch(() => '')))
    const box = async (sel) => a.page.locator(sel).first().boundingBox()
    const [pb, sb] = [await box('[data-support-passon]'), await box('[data-support-send]')]
    t.ok('A: the line does not overlap the Send button (D-P06)', !!pb && !!sb && (pb.y + pb.height <= sb.y || sb.y + sb.height <= pb.y), JSON.stringify([pb, sb]))
    await shot(a.page, `iyg-ask-reach-sender${process.env.TW_WIDE ? '-1280' : ''}.png`)
    t.ok('A: Hana is a recipient', (await a.page.locator('[data-support-count]').getAttribute('data-support-count')) === '1')
    await a.page.locator('[data-support-chip="listen"]').click()
    await a.page.locator('[data-support-send]').click(); await a.page.waitForTimeout(800)
    await a.page.keyboard.press('Escape')

    // Ben: the relayed card
    await b.page.reload(); await b.page.waitForTimeout(500)
    const card = b.page.locator('[data-support-card]')
    t.ok('B: the relayed ask arrives as a card', await until(async () => { await b.page.reload(); await b.page.waitForTimeout(700); return (await card.count()) > 0 }, 40_000))
    const text = await card.first().innerText().catch(() => '')
    t.ok('B: reads "Anna could use support ... (via Hana)"', /Anna could use support.*\(via Hana\)/s.test(text), text)
    await shot(b.page, `iyg-ask-reach-receiver${process.env.TW_WIDE ? '-1280' : ''}.png`)
    t.ok('H: passed it on once (Ben has exactly one card)', (await card.count()) === 1)
    await b.page.locator('[data-support-here]').first().evaluate((n) => n.click()); await b.page.waitForTimeout(800)

    // Anna: "who answered" names Ben
    const named = await until(async () => (await record(a.page)).supportAsks?.[0]?.hereVia?.includes('Ben'))
    t.ok('A: Ben answered through the host (hereVia)', !!named)
    await a.page.reload(); await a.page.waitForTimeout(1000)
    t.ok('A: the open-ask line names Ben', /Ben/.test(await a.page.locator('[data-support-line]').first().innerText().catch(() => '')))
    await shot(a.page, `iyg-ask-reach-answer${process.env.TW_WIDE ? '-1280' : ''}.png`)
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
