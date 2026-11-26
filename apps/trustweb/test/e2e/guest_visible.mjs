// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * hotfix guest-visible (stock data only, FOUR phones over a REAL test relay, as iyg_roster.mjs): Hanna hosts an event with "Everyone can see everyone".
 * Anna and Ben are blank browsers that open an event LINK (no connect, no QR): (1) the plain link from the event page (Anna), (2) the link trimmed the way a
 * chat invite is, without the did (Ben, opened BEFORE the onboarding finishes), (3) a host who hides the name: nothing in the link reaches her (Cleo is
 * never listed). Expected: Hanna lists Anna and Ben; Anna and Ben see each other "via Hanna"; Cleo stays unknown. 360x780; TW_WIDE=1 for 1280x900.
 *   cd apps/demo && TW_PORT=5430 TW_VITE=<vite.js> TW_CHROMIUM_EXE=<chromium> PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/guest_visible.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5430)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS ?? process.env.SHOTS
const VIEW = process.env.TW_WIDE ? { width: 1280, height: 900 } : { width: 360, height: 780 }
const t = tally()
const errors = []
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 30_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 300)) }
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
async function onboard(page, name) {
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}
const openEventPage = async (page, id) => {
  await page.evaluate(() => document.querySelectorAll('.overlay.on, .sheet.on, .sheet-veil.on').forEach((n) => n.classList.remove('on')))
  await page.locator('.tabs [data-go="events"]').first().evaluate((n) => n.click()); await page.waitForTimeout(300)
  if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').evaluate((n) => n.click())
  await page.waitForTimeout(200)
  await page.locator(`[data-event="${id}"]`).evaluate((n) => n.click()); await page.waitForTimeout(400)
}
const copiedLink = async (page) => {
  await page.evaluate(() => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (x) => { window.__clip.push(x); return Promise.resolve() } }, configurable: true }) })
  await page.locator('[data-event-share]').first().evaluate((n) => n.click()); await page.waitForTimeout(600)
  return (await page.evaluate(() => window.__clip)).at(-1)
}
const byOf = (link) => JSON.parse(Buffer.from(link.split('#ev=')[1].split('&')[0], 'base64url').toString()).by
const withoutDid = (link) => {
  const o = JSON.parse(Buffer.from(link.split('#ev=')[1].split('&')[0], 'base64url').toString()); delete o.by.did
  return link.split('#ev=')[0] + '#ev=' + Buffer.from(JSON.stringify(o)).toString('base64url')
}
/** A guest opens `link`; `first` = before the onboarding (the fragment must survive it). */
async function guestOpens(browser, server, name, link, first) {
  const g = await newPhone(browser, server)
  const hash = link.slice(link.indexOf('#'))
  if (first) { await g.page.goto(ORIGIN + '/' + hash); await g.page.waitForLoadState('networkidle').catch(() => {}); await g.page.waitForTimeout(1200); await onboard(g.page, name) }
  else { await g.page.goto(ORIGIN + '/'); await g.page.waitForLoadState('networkidle').catch(() => {}); await g.page.waitForTimeout(1200); await onboard(g.page, name); await g.page.goto('about:blank'); await g.page.goto(ORIGIN + '/' + hash) }
  const sheet = await appears(g.page.locator('[data-event-join]'), 25_000)
  t.ok(name + ': the join sheet opens from the link', sheet)
  if (sheet) { await g.page.locator('[data-event-join]').click(); await g.page.waitForTimeout(600) }
  return g
}
const joiners = async (page, id) => (await record(page)).people.filter((p) => p.events?.includes(id)).map((p) => p.name)

async function main() {
  const app = await startApp(PORT, { audiences: [ORIGIN] })
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch([...front.browserArgs])
    const server = fakeConnectServer(ORIGIN)
    const ev = `r.events = [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', to: '2027-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], showAll: true }]`
    const h = await newPhone(browser, server)
    await h.page.goto(ORIGIN + '/'); await h.page.waitForLoadState('networkidle').catch(() => {}); await h.page.waitForTimeout(1200)
    await onboard(h.page, 'Hanna')
    await setRecord(h.page, ev)
    await h.page.reload(); await h.page.waitForTimeout(1200)
    await h.page.locator('.status-pill').first().click(); await h.page.waitForTimeout(1500)   // draws Meet: the connect code is made
    await h.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
    t.ok('Hanna holds a connect code', !!(await until(async () => (await record(h.page)).connectCode?.code, 15_000)))
    await openEventPage(h.page, 'e1')
    const full = await copiedLink(h.page)
    t.ok('the plain link carries Hanna\'s did and her code', !!byOf(full)?.did && /^[A-Za-z0-9_-]{22}$/.test(byOf(full)?.code ?? ''), JSON.stringify(byOf(full)).slice(0, 80))

    const anna = await guestOpens(browser, server, 'Anna', full, false)
    const ben = await guestOpens(browser, server, 'Ben', withoutDid(full), true)   // the trimmed chat link: code only, opened before onboarding
    for (const [g, n] of [[anna, 'Anna'], [ben, 'Ben']]) t.ok(n + ': is connected to Hanna after joining', !!(await until(async () => (await record(g.page)).peers.length === 1)))
    const seen = await until(async () => { const j = await joiners(h.page, 'e1'); return j.includes('Anna') && j.includes('Ben') ? j : null })
    t.ok('Hanna lists Anna and Ben as joining the event', !!seen, JSON.stringify(await joiners(h.page, 'e1')))
    for (const [me, other] of [[anna, 'Ben'], [ben, 'Anna']]) {
      const got = await until(async () => (await record(me.page)).people.find((p) => p.name === other && p.via))
      t.ok((other === 'Ben' ? 'Anna' : 'Ben') + ' sees ' + other + ' via Hanna', got?.seen?.event === 'e1', JSON.stringify(got))
      await me.page.reload(); await me.page.waitForTimeout(1200)
      await me.page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
      await openEventPage(me.page, 'e1')
      const row = me.page.locator('[data-event-people-list] [data-person-chip]', { hasText: new RegExp('^' + other) })
      t.ok('People at this event lists ' + other + ' for the other guest', (await row.count()) === 1)
      await shot(me.page, `guest-visible-${other === 'Ben' ? 'anna' : 'ben'}.png`)
    }
    await openEventPage(h.page, 'e1'); await shot(h.page, 'guest-visible-host.png')

    // a host who hides the name: the link reaches nobody (privacy: no name, did or code); the guest still holds the event
    await setRecord(h.page, `r.events[0].nameReveal = 'hidden'`)
    await h.page.reload(); await h.page.waitForTimeout(1200)
    await openEventPage(h.page, 'e1')
    const hidden = await copiedLink(h.page)
    t.ok('hidden: the link holds no by (no name, did, code)', byOf(hidden) === undefined, JSON.stringify(byOf(hidden)))
    const cleo = await guestOpens(browser, server, 'Cleo', hidden, false)
    await new Promise((r) => setTimeout(r, 4000))
    t.ok('hidden: Cleo holds the event and no connection', (await record(cleo.page)).events.some((e) => e.id === 'e1') && (await record(cleo.page)).peers.length === 0)
    t.ok('hidden: Hanna never lists Cleo, and Anna and Ben never hear of her', !(await joiners(h.page, 'e1')).includes('Cleo') && !(await record(anna.page)).people.some((p) => p.name === 'Cleo'))
    t.ok('no page errors', errors.length === 0, errors.join(' | '))
    for (const p of [h, anna, ben, cleo]) await p.ctx.close()
  } finally {
    await browser?.close()
    await front?.stop?.()
    await app.stop()
  }
  console.log(t.failures ? `FAILED ${t.failures}` : 'ALL PASS')
  process.exit(t.failures ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
