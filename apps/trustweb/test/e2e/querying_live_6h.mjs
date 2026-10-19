/**
 * Wave 6h LIVE acceptance of THE ONE THING: a connected person's ask reaches me and I can answer, with my tab NOT in front of me.
 * Against a DEPLOYED app, its real connect service and the real relay. Fresh headless phones (390x844), throwaway names only.
 *   1  Phone A ("TW6h Live A <hex>") adds one line in My Resources, shows a REAL connect code; phone B opens it and adds A.
 *      From here A's tab is behind another window (visibilityState hidden, no focus).
 *   2  B asks "does anyone know a good techsetup": the prompt is in A's hidden tab; A comes back and shares; B sees A's line at the
 *      fixed moment (about 120 s), not before.
 *   3  B asks for something A has no line for: no prompt on A; A sees the quiet "asked about ... nothing matched" card; B sees "No match".
 *   4  B asks "home office" again for A's line; A looks only after B's moment passed and says yes: nothing shows live on B; B opens
 *      TrustWeb again and sees "<A> answered later" with A's line.
 * WARNING: this runs on PRODUCTION. It creates throwaway TrustWeb instances and one connect code per run (codes expire on the server).
 * The asks go only to the throwaway A (fresh phones are connected to nothing else). Never point it at anything but the hosts below.
 * TW_LIVE_HOST (A) and TW_LIVE_B_HOST (B, default = A): https://app.idea2.site/trustweb | https://app.trustweb.one
 * About 8 minutes per run. Space runs by a minute (the connect service allows 6 code requests per address per minute).
 * TW_SCREENS=<dir> (default W6/screens/live-6h/). Headless only. Exit 0 all PASS, 1 any FAIL, 2 bad setup.
 *   cd apps/demo && TW_LIVE_HOST=https://app.trustweb.one PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/querying_live_6h.mjs
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, record, startPhone } from './swiss_harness.mjs'

const ALLOWED_HOSTS = ['https://app.idea2.site/trustweb', 'https://app.trustweb.one']
const DEFAULT_SCREENS = '/Users/personal/Documents/agents/4claude/DEVLOG/trustweb-wave-1733/wave6/screens/live-6h/'
const VIEWPORT = { width: 390, height: 844 }
const HOST = (process.env.TW_LIVE_HOST ?? '').replace(/\/+$/, '')
const B_HOST = (process.env.TW_LIVE_B_HOST ?? HOST).replace(/\/+$/, '')
const SCREENS = process.env.TW_SCREENS || DEFAULT_SCREENS
const c = checker()
const ok = c.ok
const errors = []

if (!ALLOWED_HOSTS.includes(HOST) || !ALLOWED_HOSTS.includes(B_HOST)) {
  console.error(`querying_live_6h.mjs needs TW_LIVE_HOST (and optionally TW_LIVE_B_HOST), each one of: ${ALLOWED_HOSTS.join(' | ')}`)
  process.exit(2)
}
const CROSS = B_HOST !== HOST
const ORIGIN = new URL(HOST).origin
const SLUG = new URL(HOST).hostname + (CROSS ? '_to_' + new URL(B_HOST).hostname : '')
const TAG = randomBytes(2).toString('hex')
const NAME = (who) => `TW6h Live ${who} ${TAG}`
const LINE = `Tech setup for a home office ${TAG}`

const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 300)) }
  return null
}
const webNames = (page) => page.locator('.node:not(.you)').allInnerTexts().then((xs) => xs.map((x) => x.trim()))
const inWeb = async (page, name) => (await webNames(page)).some((x) => x.includes(name))
const bodyText = (page) => page.locator('body').innerText()
const promptShown = (page) => page.locator('.overlay.on').count().then((n) => n > 0)
const dockText = (page) => page.locator('.query-dock').innerText().catch(() => '')

async function shot(page, what) {
  if (!page || page.isClosed()) return
  try { await page.screenshot({ path: path.join(SCREENS, `live6h_${SLUG}_${what}.png`) }) } catch { /* a missing picture never fails the run */ }
}

/** A phone whose pages can be put behind another window: window.__twFront(false|true) (visibilityState, hasFocus, the events). */
async function phone(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await ctx.addInitScript(() => {
    let front = true
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (front ? 'visible' : 'hidden') })
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => !front })
    Document.prototype.hasFocus = function hasFocus() { return front }
    window.__twFront = (on) => { front = on; document.dispatchEvent(new Event('visibilitychange')); if (on) window.dispatchEvent(new Event('focus')) }
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return { ctx, page }
}

async function realCode(page) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 20_000 })
  const link = await until(async () => { const p = await page.getAttribute('.qrwrap', 'data-payload'); return p && p.startsWith(ORIGIN + '/c/') ? p : null }, 25_000)
  const long = (await record(page)).connectCode?.url ?? null
  return link && long ? { link, long } : null
}

async function addByLink(page, link) {
  await page.goto(link)
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 30_000 })
  await page.locator('.sheet.on [data-ring="friend"]').click({ timeout: 3000 }).catch(() => {})
  await page.locator('.sheet.on [data-connect-add]').click()
  await page.locator('.sheet.on h3').waitFor({ timeout: 15_000 })
}

async function addByPaste(page, long) {
  await page.locator('.rings-wrap').click({ position: { x: 12, y: 12 } })
  await page.locator('.sheet.on [data-add-code]').fill(long)
  await page.locator('.sheet.on [data-ring="friend"]').click({ timeout: 3000 }).catch(() => page.getByRole('button', { name: /^Friend/ }).first().click())
  await page.locator('.sheet.on [data-add-person]').click()
  await page.locator('.sheet.on [data-chat-open]').waitFor({ timeout: 30_000 })
}

async function addResource(page, text) {
  await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
  await page.getByPlaceholder(/Motorbike/).fill(text)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.inv', { hasText: text }).waitFor({ timeout: 5000 })
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
}

async function closeSheets(page) {
  await page.locator('.sheet.on .sheet-home').click({ timeout: 1000 }).catch(() => {})
}

/** B asks; returns the time it was sent. */
async function ask(page, text) {
  await closeSheets(page)
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: 'Ask your web', exact: true }).click()
  await page.locator('.query-dock textarea').fill(text)
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Ask my web' }).click()
  return t0
}

const outcome = (page) => until(async () => { const x = await page.locator('.card.asked .outcome').first().innerText(); return x || null }, 200_000)

async function run(browser) {
  const a = await phone(browser)
  await startPhone(a.page, HOST + '/', NAME('A'))
  await addResource(a.page, LINE)
  const code = await realCode(a.page)
  ok('1: A has a REAL code from the server', Boolean(code), String(code?.link))
  if (!code) return
  await a.page.getByRole('button', { name: 'Back' }).click().catch(() => {})

  const b = await phone(browser)
  await startPhone(b.page, B_HOST + '/', NAME('B'))
  if (CROSS) await addByPaste(b.page, code.long)
  else await addByLink(b.page, code.link)
  ok('1: B is connected to A, and A sees B in her web', !!(await until(() => inWeb(a.page, NAME('B')), 40_000)))
  const peerB = (await record(a.page)).peers.find((p) => p.displayName === NAME('B'))
  ok('1: on A\'s side B is an acquaintance (the default ring of someone who opened her link)', peerB?.ring === 'acquaintance', String(peerB?.ring))
  await a.page.evaluate(() => window.__twFront(false))
  ok('1: A\'s tab is behind another window from here on', await a.page.evaluate(() => document.visibilityState === 'hidden' && !document.hasFocus()))

  // 2: a matching ask, in a hidden tab, shared before the moment
  const t2 = await ask(b.page, 'does anyone know a good techsetup')
  ok('2: the prompt reaches A\'s hidden tab', !!(await until(() => promptShown(a.page), 40_000)))
  await shot(a.page, '2_a_prompt_hidden')
  await a.page.evaluate(() => window.__twFront(true))
  await a.page.getByRole('button', { name: 'Share these' }).click()
  await a.page.getByRole('button', { name: 'Back to the app' }).click({ timeout: 10_000 }).catch(() => {})
  const o2 = await outcome(b.page)
  const s2 = Math.round((Date.now() - t2) / 1000)
  ok('2: B sees A\'s line at the fixed moment (about 120 s), not before', !!o2 && o2.includes(LINE) && s2 >= 110, `${s2} s: ${String(o2).slice(0, 80)}`)
  await shot(b.page, '2_b_answer')

  // 3: an ask that matches nothing
  await a.page.evaluate(() => window.__twFront(false))
  await ask(b.page, 'sailing boat for a weekend')
  const card = await until(async () => { const x = await bodyText(a.page); return /asked about something/.test(x) && /sailing boat/.test(x) && /Nothing in your resources matched/.test(x) ? x : null }, 40_000)
  ok('3: A sees the quiet card "asked about ... nothing in your resources matched"', !!card)
  ok('3: and no consent prompt', !(await promptShown(a.page)))
  await shot(a.page, '3_a_nothing_card')
  const o3 = await outcome(b.page)
  ok('3: B sees "No match", exactly as a decline', !!o3 && /No match/.test(o3) && !/nothing in your resources/i.test(await bodyText(b.page)))
  await a.page.locator('[data-unmatched-dismiss]').click({ timeout: 3000 }).catch(() => {})

  // 4: a late yes
  const t4 = await ask(b.page, 'home office')
  ok('4: the prompt waits in A\'s hidden tab', !!(await until(() => promptShown(a.page), 40_000)))
  const o4 = await outcome(b.page)
  ok('4: B saw "No match" at his moment (A had not looked yet)', !!o4 && /No match/.test(o4), `${Math.round((Date.now() - t4) / 1000)} s`)
  await a.page.evaluate(() => window.__twFront(true))
  await a.page.getByRole('button', { name: 'Share these' }).click()
  const lateSub = await until(async () => /answered later/.test(await a.page.locator('.overlay.on').innerText()), 5000)
  ok('4: A is told her yes goes as "answered later"', !!lateSub)
  await a.page.getByRole('button', { name: 'Back to the app' }).click({ timeout: 10_000 }).catch(() => {})
  const held = await until(async () => ((await record(b.page)).lateAnswers ?? []).length > 0, 30_000)
  ok('4: the late yes reached B\'s phone', !!held)
  ok('4: nothing shows live on B', !/answered later/.test(await bodyText(b.page)))
  await b.page.reload()
  await b.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  const late = await until(async () => { const x = await bodyText(b.page); return x.includes(`${NAME('A')} answered later`) && x.includes(LINE) }, 15_000)
  ok('4: on his next open B sees "<A> answered later" with her line', !!late)
  await shot(b.page, '4_b_answered_later')
  await a.ctx.close(); await b.ctx.close()
}

async function main() {
  mkdirSync(SCREENS, { recursive: true })
  console.log(`querying_live_6h: A on ${HOST}, B on ${B_HOST}, tag ${TAG}`)
  const browser = await launch()
  try { await run(browser) } catch (e) { ok('ran to the end', false, String(e?.message ?? e).split('\n')[0]) } finally { await browser.close() }
  ok('no page error', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(c.failures === 0 ? `\nQUERYING LIVE 6h (${SLUG}): ALL PASS` : `\nQUERYING LIVE 6h (${SLUG}): ${c.failures} FAILED`)
  process.exit(c.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
