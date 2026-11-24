// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-guest-path (stock data only, THREE phones over a REAL test relay): guests on the REAL paths only, no record edit on Anna or Ben.
 * Hanna hosts the managed community IYG (record seeded on HER phone: that is her setup). Anna and Ben each (1) open the community invite link
 * Hanna's Invite sheet shows, accept, connect; (2) scan Hanna's event QR and join. Then: the community is on their phone with Hanna as organizer,
 * their event belongs to it, Members lists the other guest "via Hanna", the community ask is reachable and reaches the other guest. A third guest
 * (Cleo) was in the community BEFORE this build (healed: her community data is wiped on her phone, she only reopens the app).
 * 360x780; TW_WIDE=1 for 1280x900.
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 5490)
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


const TAGS = JSON.stringify([{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }])
const reopen = async (page) => { await page.reload(); await page.waitForTimeout(1500); await page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on'))) }
async function community(page, nav) {
  await page.locator('.tabs [data-go="web"]').first().evaluate((n) => n.click()); await page.waitForTimeout(500)
  await page.locator('[data-mode="community"]').click({ timeout: 8000 })
  // Known quirk (open point in the report): joining a community event already puts the pill on Community with no view loaded, so the first tap on it does nothing; Personal, then Community loads it.
  if (!(await page.locator('[data-community]').waitFor({ timeout: 4000 }).then(() => true, () => false))) { await page.locator('[data-mode="personal"]').click(); await page.waitForTimeout(800); await page.locator('[data-mode="community"]').click() }
  await page.locator('[data-community]').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(700)
  if (nav) {
    if (await page.locator('[data-community-menu]').isVisible().catch(() => false)) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
    await page.locator(`[data-community-nav="${nav}"]`).click({ timeout: 8000 }); await page.waitForTimeout(500)
  }
}
const meta = (r) => r.extData?.['community-mighty']?.meta?.iyg

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
    await setRecord(h.page, `r.events = [{ id: 'e1', name: 'Winter IYG', from: '2025-12-30', to: '2036-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], communityId: 'iyg', showAll: true, offers: { support: true } }]; r.extData = { ...(r.extData || {}), 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['me'], intimate: true } } } }; r.twSettings = { ...(r.twSettings || {}), extensions: { 'community-mighty': true, 'community-mode': true } }`)
    await reopen(h.page)
    const guests = []
    for (const name of ['Anna', 'Ben', 'Cleo']) {
      // the community invite link, as Hanna's Invite sheet shows it
      await h.page.locator('[data-mode="community"]').click(); await h.page.locator('[data-community]').waitFor({ timeout: 15_000 }); await h.page.waitForTimeout(400)
      if (await h.page.locator('[data-community-menu]').isVisible().catch(() => false)) { await h.page.locator('[data-community-menu]').click(); await h.page.waitForTimeout(150) }
      await h.page.locator('[data-community-nav="members"]').click(); await h.page.waitForTimeout(300)
      await h.page.locator('[data-community-invite]').click(); await h.page.locator('[data-invite-sheet]').waitFor({ timeout: 10_000 })
      const q = h.page.locator('.qrwrap[data-invite-qr-open]'); await q.locator('canvas, svg, img').first().waitFor({ timeout: 15_000 })
      const link = (await q.getAttribute('data-link')).replace(/^https?:\/\/[^/]+\//, ORIGIN + '/')
      await h.page.locator('.sheet.on .sheet-home').click().catch(() => {})
      const g = await newPhone(browser, server)
      await startPhone(g.page, name)
      await g.page.goto(link)
      await g.page.locator('[data-invite-accept-join]').click({ timeout: 20_000 })
      await acceptAdd(g.page).catch(() => {})
      t.ok(`H: ${name} joined the community by the invite link`, !!(await until(async () => (await record(h.page)).people.find((p) => p.name === name && String(p.fields?.iyg) === 'true'), 40_000)), JSON.stringify((await record(h.page)).people.map((p) => [p.name, p.fields])))
      await g.page.waitForTimeout(1500)
      guests.push({ name, ...g })
      await reopen(h.page)
    }
    for (const g of guests) {
      // the event QR, as Hanna shows it at the event
      await openEventPage(h.page, 'e1')
      await h.page.locator('[data-event-qr]').click(); await h.page.waitForTimeout(1200)
      const payload = await h.page.getAttribute('[data-qr-modes]', 'data-payload')
      await g.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
      if (await appears(g.page.locator('[data-connect-add]'), 8_000)) await g.page.locator('[data-connect-add]').click()
      t.ok(`${g.name}: the event join sheet shows`, await appears(g.page.locator('[data-event-join]'), 15_000))
      await g.page.locator('[data-event-join]').click(); await g.page.waitForTimeout(800)
      await reopen(h.page)
    }
    const [a, b, c] = guests
    // Cleo joined BEFORE this build: she holds nothing of the community data a new build adds (healing: she only reopens the app).
    await c.page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); delete r.extData; r.events.forEach((e) => { delete e.communityId }); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); location.reload() })
    await c.page.waitForTimeout(1800)
    await h.page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); delete r.rosterSent; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); location.reload() })   // the deploy: Hanna's new app starts with nothing sent
    await h.page.waitForTimeout(1800)

    for (const g of guests) {
      const rec = async () => record(g.page)
      const host = async () => (await rec()).people.find((p) => p.name === 'Hanna')
      t.ok(`${g.name}: the community has Hanna as its organizer`, !!(await until(async () => { const r = await rec(); const hp = await host(); return hp && meta(r)?.organizers?.includes(hp.id) }, 40_000)), JSON.stringify((await rec()).extData))
      t.ok(`${g.name}: the community is named, managed`, meta(await rec())?.kind === 'managed' && meta(await rec())?.name === 'IYG', JSON.stringify(meta(await rec())))
      t.ok(`${g.name}: the event belongs to the community`, !!(await until(async () => (await rec()).events.find((e) => e.id === 'e1')?.communityId === 'iyg', 40_000)), JSON.stringify((await rec()).events))
    }
    t.ok('Anna and Ben: no record edit was made (still one connection: Hanna)', (await Promise.all([a, b].map(async (g) => (await record(g.page)).peers.length))).every((n) => n === 1))

    for (const [me, other] of [[a, 'Ben'], [b, 'Anna'], [c, 'Anna']]) {
      t.ok(`${me.name}: sees ${other} as a via card`, !!(await until(async () => (await record(me.page)).people.find((p) => p.name === other && p.via), 60_000)), JSON.stringify((await record(me.page)).people.map((p) => [p.name, p.via])))
      await community(me.page, 'members')
      const cards = async () => (await me.page.locator('[data-community-member-via]').allInnerTexts()).map((x) => x.split('\n').map((l) => l.trim()).filter(Boolean))
      await until(async () => (await cards()).some((c) => c.includes(other)), 8000)
      const mine = (await cards()).filter((c) => c.includes(other))
      t.ok(`${me.name}: community Members lists ${other} "via Hanna" (once)`, mine.length === 1 && mine[0].includes('via Hanna'), JSON.stringify(await cards()))
      await shot(me.page, `iyg-guest-path-members-${me.name}.png`)
    }

    // the community ask is reachable on Anna's phone and reaches Ben through Hanna
    await reopen(a.page); await community(a.page)
    if (await a.page.locator('[data-community-menu]').isVisible().catch(() => false)) { await a.page.locator('[data-community-menu]').click(); await a.page.waitForTimeout(250) }
    t.ok('Anna: the community ask control is there', (await a.page.locator('[data-community-ask]').count()) === 1)
    await a.page.locator('[data-community-ask]').click(); await a.page.waitForTimeout(600)
    await a.page.locator('[data-support-chip="listen"]').click()
    await a.page.locator('[data-support-send]').click(); await a.page.waitForTimeout(800)
    await a.page.keyboard.press('Escape')
    await b.page.locator('[data-mode="personal"]').click({ timeout: 5000 }).catch(() => {})
    const card = b.page.locator('[data-support-card]')
    t.ok('Ben gets the ask "via Hanna"', await until(async () => { await b.page.reload(); await b.page.waitForTimeout(700); return /Anna could use support.*\(via Hanna\)/s.test(await card.first().innerText().catch(() => '')) }, 60_000), JSON.stringify((await record(a.page)).supportAsks) + ' | ' + JSON.stringify((await record(b.page)).supportIn))
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
