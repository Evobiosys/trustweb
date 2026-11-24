// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-event-ask (stock data only, THREE phones over a REAL test relay, ports 5494-5496): guests join Hanna's event by its QR only (no record edit
 * on Anna, Ben, Dora; Hanna's record is her own setup, the host switched "Ask for support" on). Entry (a): Anna asks from the event page ("Ask the
 * people here for support"); entry (b): Dora asks from the general Ask form with the event as an "Also include" chip. Both reach the other guests
 * through Hanna; Ben answers "I'm here". An old guest copy (the event as joined before this build) is also covered. 360x780; TW_WIDE=1 for 1280x900.
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 5494)
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



const reopen = async (page) => { await page.reload(); await page.waitForTimeout(1500); await page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on'))) }
const cardText = (page) => page.locator('[data-support-card]').first().innerText().catch(() => '')

async function main() {
  const app = await startApp(PORT, { audiences: [ORIGIN] })
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch([...front.browserArgs])
    const server = fakeConnectServer(ORIGIN)
    const h = await newPhone(browser, server)
    await startPhone(h.page, 'Hanna')
    await setRecord(h.page, `r.events = [{ id: 'e1', name: 'Winter IYG', from: '2025-12-30', to: '2036-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], showAll: true, offers: { support: true } }]`)
    await reopen(h.page)
    const guests = []
    for (const name of ['Anna', 'Ben', 'Dora']) {
      const g = await newPhone(browser, server)
      await startPhone(g.page, name)
      await openEventPage(h.page, 'e1')
      await h.page.locator('[data-event-qr]').click(); await h.page.waitForTimeout(1200)
      const payload = await h.page.getAttribute('[data-qr-modes]', 'data-payload')
      await g.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
      if (await appears(g.page.locator('[data-connect-add]'), 8_000)) await g.page.locator('[data-connect-add]').click()
      t.ok(`${name}: the event join sheet shows`, await appears(g.page.locator('[data-event-join]'), 15_000))
      await g.page.locator('[data-event-join]').click(); await g.page.waitForTimeout(800)
      await acceptAdd(g.page).catch(() => {})
      await reopen(h.page)
      guests.push({ name, ...g })
    }
    const [a, b, d] = guests
    t.ok('guests: no record edit was made (one connection each: Hanna)', (await Promise.all(guests.map(async (g) => (await record(g.page)).peers.length))).every((n) => n === 1))
    for (const g of guests) t.ok(`${g.name}: knows the event with Hanna as host`, !!(await until(async () => (await record(g.page)).events.find((e) => e.id === 'e1')?.hosts?.includes('Hanna'), 40_000)))
    // an event joined BEFORE this build: the guest copy never held anything about asks (strip it on Dora's phone)
    await setRecord(d.page, `for (const e of r.events) delete e.offers`)

    // (a) Anna: the event page
    await reopen(a.page); await openEventPage(a.page, 'e1')
    const btn = a.page.locator('[data-event-ask-support]')
    const aHas = await appears(btn, 8_000)
    t.ok('(a) Anna: the event page shows "Ask the people here for support"', aHas, JSON.stringify((await record(a.page)).events))
    if (aHas) {
      await btn.click(); await a.page.waitForTimeout(600)
      t.ok('(a) Anna: the event is an Also include chip', await appears(a.page.locator('[data-aud-chip="event:e1"]'), 3000))
      await a.page.locator('[data-support-chip="listen"]').click()
      await a.page.locator('[data-support-send]').click(); await a.page.waitForTimeout(800)
      await a.page.keyboard.press('Escape')
    }
    for (const g of [b, d]) {
      await g.page.locator('[data-mode="personal"]').click({ timeout: 3000 }).catch(() => {})
      t.ok(`(a) ${g.name} gets Anna's ask "via Hanna"`, !!(await until(async () => { await g.page.reload(); await g.page.waitForTimeout(700); return /Anna could use support.*\(via Hanna\)/s.test(await cardText(g.page)) }, 60_000)), JSON.stringify((await record(g.page)).supportIn))
    }
    await shot(a.page, 'iyg-event-ask-a.png')

    // (b) Dora (old copy): the general Ask form, Also include the event
    await reopen(d.page)
    await d.page.locator('[data-open-query]:visible').first().click(); await d.page.waitForTimeout(500)
    await d.page.locator('[data-ask-mode="support"]').click(); await d.page.waitForTimeout(400)
    await d.page.locator('[data-aud-input="add"]').fill('#event:win'); await d.page.waitForTimeout(250)
    const pick = d.page.locator('[data-aud-found="add"] [data-aud-pick="event:e1"]')
    const bHas = await appears(pick, 4000)
    t.ok('(b) Dora: #event:win offers the event', bHas)
    if (bHas) {
      await pick.click(); await d.page.waitForTimeout(300)
      await d.page.locator('[data-support-chip="listen"]').click()
      await d.page.locator('[data-support-send]').click(); await d.page.waitForTimeout(800)
      await d.page.keyboard.press('Escape')
      for (const g of [a, b]) t.ok(`(b) ${g.name} gets Dora's ask "via Hanna"`, !!(await until(async () => { await g.page.reload(); await g.page.waitForTimeout(700); return /Dora could use support.*\(via Hanna\)/s.test((await g.page.locator('[data-support-card]').allInnerTexts()).join(' ')) }, 60_000)), JSON.stringify((await record(g.page)).supportIn))
    }
    // the reply path: Ben says "I'm here" to Dora's ask (through Hanna), Dora's record names him
    await b.page.locator('[data-support-here]').first().evaluate((n) => n.click()); await b.page.waitForTimeout(800)
    t.ok('(b) Dora: the open ask names Ben (answered through the host)', !!(await until(async () => (await record(d.page)).supportAsks?.[0]?.hereVia?.includes('Ben'), 40_000)), JSON.stringify((await record(d.page)).supportAsks))
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
