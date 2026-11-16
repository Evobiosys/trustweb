// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c connect-extras (stock data only, two phones over a REAL test relay, as event_qr_join.mjs): the full event after a QR connect, no server.
 * A hosts "Winter IYG" (place, conditions, themes) and shows its QR; the QR page says the rest follows from this phone.
 * B scans the SHORT code: after the ring choice B's event sheet carries the place A's device sent sealed; B joins and holds conditions + themes + organizer.
 * A third phone C scans too (the QR is still up): it gets the event as well. Nothing is read from a server (EVENT_QR_SERVER_LOOKUP stays false).
 * Ports: Vite 5456, TLS front 5457. TW_SHOTS=<dir>; TW_WIDE=1 for 1280x900.
 *   . /tmp/ipe_env.sh; cd apps/demo && TW_PORT=5456 ../../node_modules/.bin/tsx ../trustweb/test/e2e/connect_extras.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5456)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
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
    await setRecord(a.page, `r.events = [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', to: '2027-01-02', where: 'Gasthof Alpenrose, Hinterstoder, Austria', conditions: ${JSON.stringify('Bring warm clothes and an open mind. '.repeat(10))}, themes: ['trust', 'commons', 'regeneration'], organizer: 'Verein Beispiel', hosts: ['Anna'], createdAt: 1, attended: true }]`)
    await a.page.reload(); await a.page.waitForTimeout(1200)
    await openEventPage(a.page, 'e1')
    await a.page.locator('[data-event-qr]').click(); await a.page.waitForTimeout(1200)
    const payload = await a.page.getAttribute('[data-qr-modes]', 'data-payload')
    const words = await a.page.locator('[data-qr-words]').innerText()
    t.ok('A: the QR is short and carries no place', payload.length <= 450 && !payload.includes('Alpenrose'), String(payload.length))
    t.ok('A: the QR page says the rest follows from this phone, no server named', /follow from this phone/i.test(words) && !/server/i.test(words), words)
    await shot(a.page, 'connect-extras-a-qr.png')

    // B scans the short code
    const b = await newPhone(browser, server)
    const orgHits = []
    b.page.on('request', (r) => { if (/^\/(org|events?)\//.test(new URL(r.url()).pathname)) orgHits.push(r.url()) })
    await startPhone(b.page, 'Ben')
    await b.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
    t.ok('B: the connect add sheet shows first', await appears(b.page.locator('[data-connect-add]'), 20_000))
    await b.page.locator('[data-connect-add]').click()
    t.ok('B: the event sheet opens', await appears(b.page.locator('[data-event-join]'), 15_000))
    const title = await until(async () => { const h = await b.page.locator('.sheet h2, .overlay.on h2').allInnerTexts(); return h.find((x) => /Alpenrose/.test(x)) ?? null })
    t.ok('B: the sheet shows the place, which the short code lacks (it came from A\'s phone)', !!title, String(title))
    await shot(b.page, 'connect-extras-b-sheet.png')
    await b.page.locator('[data-event-join]').click(); await b.page.waitForTimeout(800)
    const held = await until(async () => { const e = (await record(b.page)).events?.find((x) => x.id === 'e1'); return e && e.conditions && e.themes?.length ? e : null })
    t.ok('B: the event B holds has place, conditions, themes and organizer', !!held && /Alpenrose/.test(held.where) && /warm clothes/.test(held.conditions) && held.themes.length === 3 && held.organizer === 'Verein Beispiel', JSON.stringify(held ?? {}).slice(0, 200))
    await shot(b.page, 'connect-extras-b-event.png')

    // C scans the same QR a bit later and joins from the sheet only after the envelope arrived; then C holds the full event too
    const c = await newPhone(browser, server)
    await startPhone(c.page, 'Cleo')
    await c.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
    await appears(c.page.locator('[data-connect-add]'), 20_000)
    await c.page.locator('[data-connect-add]').click()
    await appears(c.page.locator('[data-event-join]'), 15_000)
    await until(async () => (await c.page.locator('.sheet h2, .overlay.on h2').allInnerTexts()).some((x) => /Alpenrose/.test(x)))
    await c.page.locator('[data-event-join]').click(); await c.page.waitForTimeout(600)
    const heldC = await until(async () => (await record(c.page)).events?.find((x) => x.id === 'e1' && x.conditions) ?? null)
    t.ok('C: a second scan of the same code gets the full event too', !!heldC)

    t.ok('no server lookup: B made no request to an event or organizer route', orgHits.length === 0, orgHits.join(' '))
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
