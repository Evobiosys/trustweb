// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b event-qr-join (stock data only, two phones over a REAL test relay, as in_person_connect.mjs):
 * A (host of "Winter IYG") shows the event QR: short, no "Switch an option off". B scans it: the connect add sheet with the ring choice comes FIRST,
 * the event sheet only after it; B joins and sees the normal event view (not the edit form). Both end in each other's web.
 * A pasted host link opens the event's edit view; a held ask of one person is listed on their page.
 * Ports: Vite 5441, TLS front 5442. TW_SHOTS=<dir>; TW_WIDE=1 for 1280x900.
 *   . /tmp/ipe_env.sh; cd apps/demo && TW_PORT=5441 ../../node_modules/.bin/tsx ../trustweb/test/e2e/event_qr_join.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5441)
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

    // A: host of an event with long conditions, themes and a place
    const a = await newPhone(browser, server)
    await startPhone(a.page, 'Anna')
    await setRecord(a.page, `r.events = [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', to: '2027-01-02', where: 'Gasthof Alpenrose, Hinterstoder, Austria', conditions: ${JSON.stringify('Bring warm clothes and an open mind. '.repeat(10))}, themes: ['trust', 'commons', 'regeneration'], organizer: 'Verein Beispiel', hosts: ['Anna'], createdAt: 1, attended: true }]`)
    await a.page.reload(); await a.page.waitForTimeout(1200)
    await openEventPage(a.page, 'e1')
    await a.page.locator('[data-event-qr]').click(); await a.page.waitForTimeout(1200)
    const payload = await a.page.getAttribute('[data-qr-modes]', 'data-payload')
    const words = await a.page.locator('[data-qr-words]').innerText()
    t.ok('A: the event QR is short (<= 450 chars) though the event is long', payload.length <= 450 && payload.includes('connect=') && payload.includes('#evs='), String(payload.length))
    t.ok('A: the code is drawn and the text names what was left out, no "option" advice', (await a.page.locator('.qrwrap canvas').count()) === 1 && /conditions/i.test(words) && !/option/i.test(words), words)
    await shot(a.page, 'event-qr-join-a-qr.png')

    // B scans it: ring choice first, then the event sheet
    const b = await newPhone(browser, server)
    await startPhone(b.page, 'Ben')
    await b.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
    t.ok('B: the connect add sheet with the ring choice shows first', await appears(b.page.locator('[data-connect-add]'), 20_000))
    t.ok('B: the event sheet does not open over it', (await b.page.locator('[data-event-join]').count()) === 0)
    await shot(b.page, 'event-qr-join-b-ring.png')
    await b.page.locator('[data-connect-add]').click()
    t.ok('B: after Add the event sheet opens directly', await appears(b.page.locator('[data-event-join]'), 15_000))
    await shot(b.page, 'event-qr-join-b-event-sheet.png')
    await b.page.locator('[data-event-join]').click(); await b.page.waitForTimeout(600)
    t.ok('B: the event opens in the normal view, not the edit form', (await b.page.locator('[data-event-save]').count()) === 0 && (await b.page.locator('[data-event-edit]').count()) === 1)
    await shot(b.page, 'event-qr-join-b-event.png')
    const rb = await record(b.page)
    t.ok('B: A is in B\'s web and the event is held', rb.people.some((p) => p.name === 'Anna') && rb.events.some((e) => e.id === 'e1' && e.name === 'Winter IYG'))
    t.ok('A: B arrives in A\'s web', !!(await until(async () => (await record(a.page)).people.some((p) => p.name === 'Ben'))))

    // a host link opens the edit view
    await b.page.goto(ORIGIN + '/#ev_host=' + Buffer.from(JSON.stringify({ kind: 'host', id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: '' })).toString('base64url'))
    await b.page.reload()
    t.ok('B: a host link opens the event\'s edit view', await appears(b.page.locator('[data-event-save]'), 15_000))
    await shot(b.page, 'event-qr-join-b-edit.png')

    // A2: a held ask of one person is listed on their page and can be answered late
    const ra = await record(a.page)
    const ben = ra.people.find((p) => p.name === 'Ben')
    await setRecord(a.page, `r.heldAsks = [{ qid: 'q1', peerId: ${JSON.stringify(ben.peerId)}, text: 'Do you know a good plumber?', fromName: 'Ben', through: [], doorName: null, relayed: false, matches: [], receivedAt: Date.now() - 86400000 * 2, deadline: Date.now() - 86400000 * 2 + 120000, lateMode: true }]`)
    await a.page.reload(); await a.page.waitForTimeout(1500)
    // the restored prompt of the held ask covers the screen on start: put it aside (the ask stays held), as a person who dismissed it would
    await a.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
    await a.page.locator(`[data-pid="${ben.id}"]`).last().click(); await a.page.waitForTimeout(500)
    await a.page.locator(`[data-card-open="${ben.id}"]`).click().catch(() => {}); await a.page.waitForTimeout(500)
    const row = a.page.locator(`[data-past-asks="${ben.id}"]`)
    await row.scrollIntoViewIfNeeded().catch(() => {})
    t.ok('A: Ben\'s page lists his open ask with its age', (await row.count()) === 1 && /plumber/.test(await row.innerText()) && /2 days ago/.test(await row.innerText()))
    await shot(a.page, 'event-qr-join-a-past-asks.png')
    await a.page.locator('[data-past-ask-answer="q1"]').click(); await a.page.waitForTimeout(800)
    t.ok('A: "Answer now" shows the ask\'s prompt again', await appears(a.page.locator('.overlay.on .ask-q', { hasText: 'plumber' }), 8000))

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
