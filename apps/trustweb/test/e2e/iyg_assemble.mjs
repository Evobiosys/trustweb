// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-assemble (stock data only, THREE phones over a REAL test relay): the IYG case. Hanna hosts the managed, intimate community IYG and its event
 * "Winter IYG" that ALREADY HAPPENED (past dates); Anna and Ben joined it before and know only Hanna. (G5) After the old roster state is wiped and the
 * three apps reopen, each sees the other; (G3a) Anna's community Members lists Ben "via Hanna"; (G3b/G4) Anna asks the community for support, Ben gets it
 * "via Hanna" and answers, Anna sees him; (G3c) Hanna adds a resource from the COMMUNITY view for the event and its community, it shows in Anna's event
 * Resources; (G1) Hanna edits its title and link in the UI, both views of Anna and Ben follow; (G2) Hanna's app reopens (a new session), she removes it
 * with the cross, Anna and Ben lose it. 360x780; TW_WIDE=1 for 1280x900.
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 5484)
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


const TAGS = JSON.stringify([{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }])
const asHolder = `r.events.forEach((e) => { e.communityId = 'iyg' }); r.people.filter((p) => p.name === 'Hanna').forEach((p) => { p.fields = { ...p.fields, iyg: 'true' } }); r.extData = { ...(r.extData || {}), 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: [], ask: true } } } }; r.twSettings = { ...(r.twSettings || {}), extensions: { 'community-mighty': true, 'community-mode': true } }`
/** Edits the record and reloads in ONE synchronous task: a running app cannot save over the edit in between. */
const editReload = async (page, fn) => {
  await page.evaluate((src) => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); new Function('r', src)(r); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); location.reload() }, fn)
  await page.waitForTimeout(1800)
  await page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on')))
}
const reopen = async (page) => { await page.reload(); await page.waitForTimeout(1500); await page.evaluate(() => document.querySelectorAll('.overlay.on').forEach((n) => n.classList.remove('on'))) }
async function community(page, nav) {
  await openEventPage(page, 'e1')
  if (!(await page.locator('[data-event-by-community]').count())) console.log('  [event]', JSON.stringify((await record(page)).events), JSON.stringify((await record(page)).extData))
  await page.locator('[data-event-by-community]').click(); await page.waitForTimeout(900)
  if (nav) {
    if (await page.locator('[data-community-menu]').isVisible().catch(() => false)) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
    await page.locator(`[data-community-nav="${nav}"]`).click(); await page.waitForTimeout(500)
  }
}
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

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
    await setRecord(h.page, `r.events = [{ id: 'e1', name: 'Winter IYG', from: '2025-12-30', to: '2026-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], communityId: 'iyg', showAll: true, offers: { support: true } }]; r.extData = { ...(r.extData || {}), 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['me'], intimate: true } } } }; r.twSettings = { ...(r.twSettings || {}), extensions: { 'community-mighty': true, 'community-mode': true } }`)
    await reopen(h.page)
    const guests = []
    for (const name of ['Anna', 'Ben']) {
      await openEventPage(h.page, 'e1')
      await h.page.locator('[data-event-qr]').click(); await h.page.waitForTimeout(1200)
      const payload = await h.page.getAttribute('[data-qr-modes]', 'data-payload')
      const g = await newPhone(browser, server)
      await startPhone(g.page, name)
      await g.page.evaluate((tags) => localStorage.setItem('trustweb.v1.colourtags', tags), TAGS)
      await g.page.goto(ORIGIN + payload.slice(payload.indexOf('/?')))
      if (!(await appears(g.page.locator('[data-connect-add]'), 20_000))) throw new Error(name + ': no connect sheet')
      await g.page.locator('[data-connect-add]').click()
      await appears(g.page.locator('[data-event-join]'), 15_000)
      await g.page.locator('[data-event-join]').click(); await g.page.waitForTimeout(800)
      t.ok(`H: ${name} joined (past event, tagged iyg)`, !!(await until(async () => (await record(h.page)).people.find((p) => p.name === name && p.events?.includes('e1') && p.fields?.iyg === 'true'))))
      await reopen(h.page)
      guests.push({ name, ...g })
    }
    const [a, b] = guests

    // G5: what a build before this one left behind: no roster sent, no via people. Reopen all three; nobody does anything else.
    await Promise.all(guests.map((g) => editReload(g.page, `r.people = r.people.filter((p) => !p.via); ${asHolder}`)))
    t.ok('G5: clean start: the guests hold no via card right after the reopen', !(await Promise.all(guests.map(async (g) => (await record(g.page)).people.some((p) => p.via)))).some(Boolean))
    await editReload(h.page, `delete r.rosterSent`)
    for (const [me, other] of [[a, 'Ben'], [b, 'Anna']]) {
      const got = await until(async () => (await record(me.page)).people.find((p) => p.name === other && p.via), 45_000)
      t.ok(`G5: ${me.name} sees ${other} after merely reopening the app (past event)`, !!got, JSON.stringify((await record(me.page)).people.map((p) => [p.name, p.via])))
    }
    const ar = await record(a.page)
    console.log('  [info] Hanna card on Anna after the join: fields', JSON.stringify(ar.people.find((p) => p.name === 'Hanna')?.fields), '| ring', ar.people.find((p) => p.name === 'Hanna')?.ring, '| Ben seen', JSON.stringify(ar.people.find((p) => p.name === 'Ben')?.seen))
    t.ok('G5/G4: Anna still knows only Hanna as a connection; Ben is a via card', ar.peers.length === 1 && ar.people.filter((p) => p.peerId).length === 1)

    // G3a: the community Members list
    await community(a.page, 'members')
    const row = a.page.locator('[data-community-member-via]', { hasText: 'Ben' })
    t.ok('G3a: Anna\'s community Members lists Ben "via Hanna"', (await row.count()) === 1 && /via Hanna/.test(await row.innerText()), await a.page.locator('[data-community]').innerText().catch(() => ''))
    await shot(a.page, 'iyg-assemble-members.png')
    t.ok('G3a: no sideways scroll', await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))

    // G3b + G4: Anna asks the community
    await reopen(a.page); await community(a.page)
    if (await a.page.locator('[data-community-menu]').isVisible().catch(() => false)) { await a.page.locator('[data-community-menu]').click(); await a.page.waitForTimeout(250) }
    await a.page.locator('[data-community-ask]').click(); await a.page.waitForTimeout(600)
    t.ok('G4: Anna\'s recipients are Hanna only (Ben, a via card, is not counted)', (await a.page.locator('[data-support-count]').getAttribute('data-support-count').catch(() => null)) === '1', await a.page.locator('.sheet').innerText().catch(() => ''))
    t.ok('G3b: the line says Hanna passes it on', /passes it on/.test(await a.page.locator('[data-support-passon]').innerText().catch(() => '')))
    t.ok('G3b: the line does not overlap Send (D-P06)', !overlaps(await a.page.locator('[data-support-passon]').first().boundingBox(), await a.page.locator('[data-support-send]').first().boundingBox()))
    await a.page.locator('[data-support-chip="listen"]').click()
    await a.page.locator('[data-support-send]').click(); await a.page.waitForTimeout(800)
    await a.page.keyboard.press('Escape')
    const card = b.page.locator('[data-support-card]')
    t.ok('G3b: Ben gets the card', await until(async () => { await b.page.reload(); await b.page.waitForTimeout(700); return (await card.count()) > 0 }, 45_000))
    t.ok('G3b: it reads "(via Hanna)"', /Anna could use support.*\(via Hanna\)/s.test(await card.first().innerText().catch(() => '')))
    await b.page.locator('[data-support-here]').first().evaluate((n) => n.click()); await b.page.waitForTimeout(800)
    t.ok('G3b: Anna sees that Ben is here', !!(await until(async () => (await record(a.page)).supportAsks?.[0]?.hereVia?.includes('Ben'))))

    // G3c: Hanna adds from the COMMUNITY view for the event and its community; it shows in Anna's event Resources
    await setRecord(h.page, `r.uiRings = { ...(r.uiRings || {}), eventMode: undefined, show: ['tag:iyg'] }`)
    await reopen(h.page)
    await h.page.locator('.tabs [data-go="inventory"]').first().evaluate((n) => n.click()); await h.page.waitForTimeout(600)
    await h.page.locator('[data-rs-add]').click(); await h.page.waitForTimeout(200)
    t.ok('G3c: the community add row offers "Winter IYG and its community"', /and its community/.test(await h.page.locator('[data-rs-add-audience]').innerText()))
    await h.page.locator('[data-rs-add-audience]').selectOption('both:e1')
    await h.page.locator('[data-rs-add-input]').fill('Sled guide'); await h.page.keyboard.press('Enter'); await h.page.waitForTimeout(600)
    for (const g of guests) {
      const got = await until(async () => resOf(g.page, 'Sled guide'))
      t.ok(`G3c: ${g.name} received it`, !!got)
      await showScope(g.page, 'event')
      t.ok(`G3c: ${g.name}'s event Resources show it`, await inView(g.page, 'event', got?.id))
    }

    // G1: Hanna edits title and link in the UI (item sheet), both views of both guests follow
    const mine = await resOf(h.page, 'Sled guide')
    await h.page.locator(`[data-item="${mine.id}"]`).first().click(); await h.page.waitForTimeout(400)
    t.ok('G1: the sheet of my shared resource has an edit form', (await h.page.locator('[data-rs-edit-title]').count()) === 1)
    await h.page.locator('[data-rs-edit-title]').fill('Sled guide 2027')
    await h.page.locator('[data-rs-edit-link]').fill('https://example.test/sled')
    await h.page.locator('[data-rs-edit-save]').click(); await h.page.waitForTimeout(700)
    await shot(h.page, 'iyg-assemble-edit.png')
    for (const g of guests) {
      t.ok(`G1: ${g.name} got title and link`, !!(await until(async () => { const i = (await record(g.page)).inventory.find((x) => x.id === mine.id); return i?.text === 'Sled guide 2027' && i.link === 'https://example.test/sled' })))
      await showScope(g.page, 'event')
      t.ok(`G1: ${g.name}'s event view shows the new title`, /Sled guide 2027/.test(await g.page.locator('[data-scoped-resources="event"]').innerText()))
      await showScope(g.page, 'community')
      t.ok(`G1: ${g.name}'s community view shows the new title`, /Sled guide 2027/.test(await g.page.locator('[data-scoped-resources="community"]').innerText()))
    }

    // G2: a new session of Hanna's app; the cross removes the item; both guests lose it
    await setRecord(h.page, `r.uiRings = { ...(r.uiRings || {}), eventMode: undefined, show: [] }`)
    await reopen(h.page)
    await h.page.locator('.tabs [data-go="inventory"]').first().evaluate((n) => n.click()); await h.page.waitForTimeout(700)
    await h.page.locator('.inv', { has: h.page.locator(`[data-item="${mine.id}"]`) }).locator('button.x').click(); await h.page.waitForTimeout(800)
    t.ok('G2: it is gone from Hanna\'s list', (await h.page.locator(`[data-item="${mine.id}"]`).count()) === 0)
    for (const g of guests) {
      t.ok(`G2: ${g.name} lost it (retracted, kept hidden)`, !!(await until(async () => (await record(g.page)).inventory.find((i) => i.id === mine.id)?.retractedAt !== undefined)))
      await showScope(g.page, 'event')
      t.ok(`G2: ${g.name}'s event view no longer shows it`, !(await inView(g.page, 'event', mine.id)))
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
