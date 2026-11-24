// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-shared-resource (stock data only, three phones over a REAL test relay, as a44d_event_joined.mjs): Hanna (host) has the community IYG and its
 * event "Winter OG"; Anna and Ben join through her event QR, so each is connected to Hanna only. Hanna adds ONE resource "For the event and its community":
 * Anna and Ben see it in the event's Resources AND in the community's Resources (read-only, "by Hanna"); an edit of Hanna's reaches both; switching it
 * off retracts it for both; an event-private resource never leaves Hanna. 360x780 (TW_WIDE=1: 1280x900).
 *   cd apps/demo && TW_PORT=5483 TW_VITE=<vite.js> TW_CHROMIUM_EXE=<chromium> PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/iyg_shared_resource.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5483)
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
const TAGS = JSON.stringify([{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }])
const resOf = async (page, text) => (await record(page)).inventory.find((i) => i.text === text)

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
/** The scoped Resources screen of one scope: event mode of e1, or the community chip IYG. */
async function showScope(page, scope) {
  await setRecord(page, `r.uiRings = { ...(r.uiRings || {}), ${scope === 'event' ? "eventMode: 'e1', show: []" : "eventMode: undefined, show: ['tag:iyg']"} }`)
  await page.reload(); await page.waitForTimeout(1500)
  await page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
  await page.locator('.tabs [data-go="inventory"]').first().evaluate((n) => n.click()); await page.waitForTimeout(600)
}
const inView = (page, scope, id) => page.locator(`[data-scoped-resources="${scope}"] [data-item="${id}"]`).count().then((n) => n === 1)

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
    await h.page.evaluate((tags) => localStorage.setItem('trustweb.v1.colourtags', tags), TAGS)
    await setRecord(h.page, `r.events = [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', to: '2027-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], communityId: 'iyg' }]; r.extData = { ...(r.extData || {}), 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: ['me'] } } } }; r.twSettings = { ...(r.twSettings || {}), extensions: { 'community-mighty': true } }`)
    await h.page.reload(); await h.page.waitForTimeout(1200)
    const guests = []
    for (const name of ['Anna', 'Ben']) {
      await openEventPage(h.page, 'e1')
      await h.page.locator('[data-event-qr]').click(); await h.page.waitForTimeout(1200)
      const payload = await h.page.getAttribute('[data-qr-modes]', 'data-payload')
      const g = await newPhone(browser, server)
      await startPhone(g.page, name)
      await g.page.evaluate((tags) => localStorage.setItem('trustweb.v1.colourtags', tags), TAGS)
      await g.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
      t.ok(`${name}: the connect add sheet shows`, await appears(g.page.locator('[data-connect-add]'), 20_000))
      await g.page.locator('[data-connect-add]').click()
      await appears(g.page.locator('[data-event-join]'), 15_000)
      await g.page.locator('[data-event-join]').click(); await g.page.waitForTimeout(600)
      t.ok(`H: ${name} is joined on Hanna's device`, !!(await until(async () => (await record(h.page)).people.find((p) => p.name === name && p.events?.includes('e1') && p.fields?.iyg === 'true'))))
      await h.page.reload(); await h.page.waitForTimeout(1200)
      await h.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
      guests.push({ name, ...g })
    }
    const [a, b] = guests

    // Hanna adds ONE resource for the event and its community (event Resources add row)
    await showScope(h.page, 'event')
    await h.page.locator('[data-rs-add]').click(); await h.page.waitForTimeout(200)
    t.ok('H: the event add row offers "For the event and its community"', /For the event and its community/.test(await h.page.locator('[data-rs-add-audience]').innerText()))
    await h.page.locator('[data-rs-add-audience]').selectOption('both:e1')
    const [sb, ib] = await Promise.all([h.page.locator('[data-rs-add-audience]').boundingBox(), h.page.locator('[data-rs-add-input]').boundingBox()])   // D-P06: no control overlays another
    t.ok('H: the pick and the input do not overlap; no sideways scroll', !!sb && !!ib && !(sb.x < ib.x + ib.width - 0.5 && ib.x < sb.x + sb.width - 0.5 && sb.y < ib.y + ib.height - 0.5 && ib.y < sb.y + sb.height - 0.5) && await h.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), JSON.stringify([sb, ib]))
    await h.page.locator('[data-rs-add-input]').fill('Sled guide'); await h.page.keyboard.press('Enter'); await h.page.waitForTimeout(500)
    const mine = await resOf(h.page, 'Sled guide')
    t.ok('H: one item, both scopes, synced', mine?.synced === true && mine.communityId === 'iyg' && mine.eventId === 'e1' && JSON.stringify(mine.eventIds) === '["e1"]', JSON.stringify(mine))
    // an event-private resource of Hanna's stays with her
    await h.page.locator('[data-rs-add]').click(); await h.page.waitForTimeout(200)
    await h.page.locator('[data-rs-add-input]').fill('Private to Hanna'); await h.page.keyboard.press('Enter'); await h.page.waitForTimeout(400)
    await shot(h.page, 'iyg-shared-resource-h-event.png')

    for (const g of [a, b]) {
      const got = await until(async () => resOf(g.page, 'Sled guide'))
      t.ok(`${g.name}: the resource arrived (sealed res over the relay)`, !!got && got.sharedBy === 'Hanna' && got.communityId === 'iyg' && got.eventIds?.[0] === 'e1', JSON.stringify(got))
      t.ok(`${g.name}: the private one did not`, !(await resOf(g.page, 'Private to Hanna')))
      await showScope(g.page, 'event')
      t.ok(`${g.name}: shows in the event's Resources`, await inView(g.page, 'event', got?.id))
      await shot(g.page, `iyg-shared-resource-${g.name.toLowerCase()}-event.png`)
      await showScope(g.page, 'community')
      t.ok(`${g.name}: shows in the community's Resources`, await inView(g.page, 'community', got?.id))
      await shot(g.page, `iyg-shared-resource-${g.name.toLowerCase()}-community.png`)
      await g.page.locator(`[data-item="${got?.id}"]`).first().click(); await g.page.waitForTimeout(400)
      t.ok(`${g.name}: its sheet is read-only, "Shared by Hanna"`, (await g.page.locator('[data-rs-received]').count()) === 1 && /Shared by Hanna/.test(await g.page.locator('.sheet').innerText()) && (await g.page.locator('[data-item-switch]').count()) === 0)
      await g.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
    }

    // Hanna renames it (edited in her record; the next save notices it) and adds a second one: both reach Anna and Ben
    await setRecord(h.page, `r.inventory.find((i) => i.text === 'Sled guide').text = 'Sled guide 2027'`)
    await showScope(h.page, 'event')
    await h.page.locator('[data-rs-add]').click(); await h.page.waitForTimeout(200)
    await h.page.locator('[data-rs-add-audience]').selectOption('both:e1')
    await h.page.locator('[data-rs-add-input]').fill('Second tip'); await h.page.keyboard.press('Enter'); await h.page.waitForTimeout(500)
    for (const g of [a, b]) {
      t.ok(`${g.name}: the new title arrived (one item, same id)`, !!(await until(async () => (await record(g.page)).inventory.filter((i) => i.id === mine.id && i.text === 'Sled guide 2027').length === 1)))
      t.ok(`${g.name}: the second resource arrived`, !!(await until(async () => resOf(g.page, 'Second tip'))))
      await showScope(g.page, 'event')
      t.ok(`${g.name}: the event view shows the new title`, /Sled guide 2027/.test(await g.page.locator('[data-scoped-resources="event"]').innerText()))
      await showScope(g.page, 'community')
      t.ok(`${g.name}: the community view shows the new title`, /Sled guide 2027/.test(await g.page.locator('[data-scoped-resources="community"]').innerText()))
    }

    // Hanna switches it off: gone for both
    await showScope(h.page, 'event')
    await h.page.locator(`[data-item="${mine.id}"]`).first().click(); await h.page.waitForTimeout(400)
    await h.page.locator(`[data-item-switch="${mine.id}"]`).click(); await h.page.waitForTimeout(500)
    for (const g of [a, b]) {
      t.ok(`${g.name}: retracted (hidden, kept as retractedAt)`, !!(await until(async () => (await record(g.page)).inventory.find((i) => i.id === mine.id)?.retractedAt !== undefined)))
      await showScope(g.page, 'event')
      t.ok(`${g.name}: gone from the event view`, !(await inView(g.page, 'event', mine.id)))
      await showScope(g.page, 'community')
      t.ok(`${g.name}: gone from the community view`, !(await inView(g.page, 'community', mine.id)))
      await shot(g.page, `iyg-shared-resource-${g.name.toLowerCase()}-retracted.png`)
    }
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
