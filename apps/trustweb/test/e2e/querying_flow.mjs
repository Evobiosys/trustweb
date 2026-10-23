/**
 * Wave 6h, THE ONE THING: a connected person's ask reaches me and I can answer, with forgiving matching.
 * Headless phones over a REAL test relay (the production store-and-forward RelayServer, in memory) on the app origin
 * https://app.trustweb.one (a TLS front on loopback), the connect service stubbed in the browser (fake_connect_server.mjs).
 * Ada is the ASKED person (her laptop tab is open but NOT in front of her: visibilityState hidden, no focus); Bo connected to her
 * by opening her code, so on her side he is an acquaintance (the default ring of a new connection).
 *   A  lone hidden tab: Bo asks "techsetup" for her line "Tech setup" (typed: friends of friends): the prompt is there in her hidden tab
 *   B  ring: her line is set to "friends" only, Bo is an acquaintance: silent toward Bo, and Ada sees a quiet card that says a line
 *      matched but its "Who can ask" leaves Bo out
 *   C  nothing matched: Bo asks for something she has no line for: silent toward Bo; Ada sees "Bo asked about ... nothing matched"
 *   D  late yes: Ada sees the prompt only after Bo stopped waiting; she says yes; Bo sees nothing live, and "Ada answered later"
 *      on his next open
 *   E  reload: Ada reloads her tab before deciding: the ask is still there to answer
 *   F  offline while hidden: Ada's network drops for a while (a laptop on the move), comes back while the tab stays hidden: the
 *      next ask still reaches her
 *   H  a lone tab LOADED while behind another window (never in front) still drains and receives the ask
 *   G  window: a direct ask waits for the 120 s window (the asker's ask carries it; the answer leaves at that moment)
 *   I  (review 6h) late yes while the ASKER'S app is closed: Bo asks and closes TrustWeb at once; Ada says yes after her moment; the
 *      late answer waits on the relay; Bo's very next open shows "Ada answered later" (before the fix: only the open after that)
 * Ports: Vite TW_PORT (8970), TLS front TW_PORT+1. TW_SHOTS=<dir> for screenshots. PARTS=a,b,... to run a subset.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/querying_flow.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const HOST = 'app.trustweb.one'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')
const webNames = (page) => page.locator('.node:not(.you)').allInnerTexts().then((xs) => xs.map((x) => x.trim()))
const inWeb = async (page, name) => (await webNames(page)).some((x) => x.includes(name))
const bodyText = (page) => page.locator('body').innerText()

/**
 * Every page of a phone starts NOT in front of its person when `hidden` (a laptop tab behind another window): visibilityState
 * 'hidden', document.hasFocus() false. window.__twFront(true|false) moves it in front or away (and fires visibilitychange).
 */
async function newPhone(browser, server, { hidden = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await ctx.addInitScript((startHidden) => {
    let front = !(startHidden || sessionStorage.getItem('__twHidden') === '1')
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (front ? 'visible' : 'hidden') })
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => !front })
    Document.prototype.hasFocus = function hasFocus() { return front }
    window.__twFront = (on) => { front = on; document.dispatchEvent(new Event('visibilitychange')); if (on) window.dispatchEvent(new Event('focus')) }
  }, hidden)
  await server.install(ctx)
  const page = await newTab(ctx)
  return { ctx, page }
}

async function newTab(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return page
}

async function startPhone(page, name) {
  await page.goto(ORIGIN + '/')
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

async function showCode(page, server) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return until(async () => {
    const shown = await payload(page)
    return [...server.codes.keys()].find((c) => shown === `${ORIGIN}/c/${c}`) ?? null
  }, 15_000)
}

async function openAndAdd(page, code, ring = 'friend') {
  await page.goto(`${ORIGIN}/c/${code}`)
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })
  await page.locator(`.sheet.on [data-ring="${ring}"]`).click()
  await page.locator('.sheet.on [data-connect-add]').click()
  await page.locator('.sheet.on h3').waitFor({ timeout: 10_000 })
}

/** Ada (asked, her tab behind another window) and Bo (asker, opened her code). Ada's resources are written to her record first. */
async function pair(browser, tag, lines, { loadHidden = false } = {}) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, `Ada ${tag}`)
  const code = await showCode(a.page, server)
  await a.page.getByRole('button', { name: 'Back' }).click().catch(() => {})
  const b = await newPhone(browser, server)
  await startPhone(b.page, `Bo ${tag}`)
  await openAndAdd(b.page, code)
  await until(() => inWeb(a.page, `Bo ${tag}`))
  await a.page.evaluate((ls) => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    ls.forEach((l, i) => r.inventory.push({ id: `q6h${i}line`, text: l.text, audience: l.audience, included: true, createdAt: Date.now() }))
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  }, lines)
  // Her laptop tab, reloaded with those lines, then behind another window (or loaded while already behind one).
  if (loadHidden) await a.page.evaluate(() => sessionStorage.setItem('__twHidden', '1'))
  await a.page.reload()
  await a.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await a.page.evaluate(() => window.__twFront(false))
  return { a, b, tag }
}

async function closeSheets(page) {
  await page.locator('.sheet.on .sheet-home').click({ timeout: 1000 }).catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
}

/** Bo asks; resolves at once (the dock keeps waiting on its own). */
async function ask(page, text) {
  await closeSheets(page)
  await page.locator('nav.tabs button', { hasText: 'Membranes' }).click()
  if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: 'Ask your web', exact: true }).click()
  await page.locator('.query-dock textarea').fill(text)
  await page.getByRole('button', { name: 'Ask my web' }).click()
}

const promptShown = (page) => page.locator('.overlay.on').count().then((n) => n > 0)
const promptText = (page) => page.locator('.overlay.on').innerText().catch(() => '')

async function partA(browser) {
  const { a, b, tag } = await pair(browser, 'Front', [{ text: 'Tech setup for a home office', audience: 'fof' }])
  t.ok('a: her tab is not in front of her (hidden, no focus)', await a.page.evaluate(() => document.visibilityState === 'hidden' && !document.hasFocus()))
  await ask(b.page, 'does anyone know a good techsetup')
  const got = await until(() => promptShown(a.page), 20_000)
  t.ok('a: the ask reaches her hidden tab: the prompt is there when she looks', !!got, await bodyText(a.page).catch(() => ''))
  t.ok('a: it names Bo and the line', /Bo Front asks/.test(await promptText(a.page)) && /Tech setup/.test(await promptText(a.page)))
  await shot(a.page, 'q6h_a_prompt_hidden.png')
  await a.page.evaluate(() => window.__twFront(true))
  await a.page.getByRole('button', { name: 'Share these' }).click()
  const shared = await until(async () => /Tech setup/.test(await b.page.locator('.query-dock').innerText()), 200_000)
  t.ok('a: Bo sees her line at the answer moment', !!shared)
  await a.ctx.close(); await b.ctx.close()
  return tag
}

async function partB(browser) {
  const { a, b } = await pair(browser, 'Ring', [{ text: 'Tax advisor in Vienna', audience: 'friends' }])
  await ask(b.page, 'tax advisor')
  await a.page.waitForTimeout(4000)
  t.ok('b: no consent prompt (Bo is an acquaintance, the line is for friends)', !(await promptShown(a.page)))
  const card = await until(async () => {
    const txt = await bodyText(a.page)
    return /Bo Ring asked about/.test(txt) && /tax advisor/.test(txt) ? txt : null
  }, 10_000)
  t.ok('b: Ada sees a quiet card: Bo asked about "tax advisor"', !!card, (await bodyText(a.page)).slice(0, 400))
  t.ok('b: the card says a line matched but its "Who can ask" leaves Bo out', !!card && /Who can ask/i.test(card))
  await shot(a.page, 'q6h_b_ring_card.png')
  const r = await record(a.page)
  t.ok('b: logged as no match', (r.log ?? []).some((e) => e.text === 'tax advisor' && e.outcome === 'no-match'))
  await a.ctx.close(); await b.ctx.close()
}

async function partC(browser) {
  const { a, b } = await pair(browser, 'None', [{ text: 'Ladder, three metres', audience: 'fof' }])
  await ask(b.page, 'sailing boat for a weekend')
  const card = await until(async () => {
    const txt = await bodyText(a.page)
    return /Bo None asked about/.test(txt) && /sailing boat/.test(txt) ? txt : null
  }, 10_000)
  t.ok('c: no prompt for an ask that matched nothing', !(await promptShown(a.page)))
  t.ok('c: Ada sees "Bo None asked about ... nothing in your resources matched"', !!card && /nothing/i.test(card), (await bodyText(a.page)).slice(0, 400))
  await shot(a.page, 'q6h_c_nothing_card.png')
  const bText = await until(async () => { const x = await b.page.locator('.query-dock').innerText(); return /Nothing|No one/i.test(x) ? x : null }, 200_000)
  t.ok('c: Bo sees no match, exactly as a decline', !!bText && !/nothing in your resources/i.test(bText))
  await a.ctx.close(); await b.ctx.close()
}

async function partD(browser) {
  const { a, b } = await pair(browser, 'Late', [{ text: 'Cargo bike to lend', audience: 'fof' }])
  await ask(b.page, 'cargo bike')
  t.ok('d: the prompt waits in her hidden tab', !!(await until(() => promptShown(a.page), 20_000)))
  // Bo's dock gives up (the asker's timeout) before Ada looks.
  const ended = await until(async () => /Nothing|No one/i.test(await b.page.locator('.query-dock').innerText()), 260_000)
  t.ok('d: Bo saw no answer at his moment', !!ended)
  await a.page.evaluate(() => window.__twFront(true))
  await a.page.getByRole('button', { name: 'Share these' }).click()
  await b.page.waitForTimeout(4000)
  t.ok('d: nothing shows live on Bo\'s side (no trickle that reveals when she said yes)', !/answered later/i.test(await bodyText(b.page)))
  const kept = await until(async () => ((await record(b.page)).lateAnswers ?? []).length > 0, 15_000)
  t.ok('d: kept for his next open', !!kept)
  await b.page.reload()
  await b.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const late = await until(async () => { const x = await bodyText(b.page); return /Ada Late answered later/.test(x) && /Cargo bike/.test(x) }, 10_000)
  t.ok('d: on his next open: "Ada Late answered later" with her line', !!late, (await bodyText(b.page)).slice(0, 400))
  await shot(b.page, 'q6h_d_late_answer.png')
  await a.ctx.close(); await b.ctx.close()
}

async function partE(browser) {
  const { a, b } = await pair(browser, 'Reload', [{ text: 'Projector for a talk', audience: 'fof' }])
  await ask(b.page, 'projector')
  t.ok('e: the prompt arrived', !!(await until(() => promptShown(a.page), 20_000)))
  await a.page.reload()
  await a.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const again = await until(() => promptShown(a.page), 8000)
  t.ok('e: after a reload the ask is still there to answer', !!again && /Projector/.test(await promptText(a.page)))
  await a.ctx.close(); await b.ctx.close()
}

async function partF(browser) {
  const { a, b } = await pair(browser, 'Offline', [{ text: 'Sewing machine', audience: 'fof' }])
  await a.ctx.setOffline(true)
  await a.page.waitForTimeout(15_000)
  await a.ctx.setOffline(false)
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await a.page.waitForTimeout(3000)
  await ask(b.page, 'sewing machine')
  t.ok('f: back online in a hidden tab, the next ask reaches her', !!(await until(() => promptShown(a.page), 30_000)))
  await a.ctx.close(); await b.ctx.close()
}

async function partH(browser) {
  const { a, b } = await pair(browser, 'Behind', [{ text: 'Electric drill', audience: 'fof' }], { loadHidden: true })
  t.ok('h: her tab was loaded while behind another window', await a.page.evaluate(() => document.visibilityState === 'hidden'))
  await ask(b.page, 'drill')
  t.ok('h: a lone tab that was never in front still receives the ask', !!(await until(() => promptShown(a.page), 20_000)))
  await a.ctx.close(); await b.ctx.close()
}

async function partG(browser) {
  const { a, b } = await pair(browser, 'Window', [{ text: 'Camping tent for four', audience: 'fof' }])
  const t0 = Date.now()
  await ask(b.page, 'tent')
  t.ok('g: the prompt arrived', !!(await until(() => promptShown(a.page), 20_000)))
  await a.page.evaluate(() => window.__twFront(true))
  await a.page.getByRole('button', { name: 'Share these' }).click()
  const got = await until(async () => /Camping tent/.test(await b.page.locator('.query-dock').innerText()), 200_000)
  const s = Math.round((Date.now() - t0) / 1000)
  t.ok('g: her yes reaches Bo at the 120 s moment, not before', !!got && s >= 115, `${s} s`)
  console.log(`  note  g: answer seen after ${s} s`)
  await a.ctx.close(); await b.ctx.close()
}

async function partI(browser) {
  const { a, b } = await pair(browser, 'Closed', [{ text: 'Bread maker to lend', audience: 'fof' }])
  await ask(b.page, 'bread maker')
  t.ok('i: the prompt waits in her hidden tab', !!(await until(() => promptShown(a.page), 20_000)))
  await b.page.close() // Bo closes TrustWeb right after asking (his record stays in the browser profile)
  await a.page.waitForTimeout(125_000) // past her answer moment (120 s): her yes is a late one now
  await a.page.evaluate(() => window.__twFront(true))
  await a.page.getByRole('button', { name: 'Share these' }).click()
  await a.page.waitForTimeout(5000) // the relay keeps it for Bo
  const page = await newTab(b.ctx)
  await page.goto(ORIGIN + '/')
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const late = await until(async () => { const x = await bodyText(page); return /Ada Closed answered later/.test(x) && /Bread maker/.test(x) }, 20_000)
  t.ok('i: on his very next open: "Ada Closed answered later" with her line', !!late, (await bodyText(page)).slice(0, 400))
  await shot(page, 'q6h_i_late_answer_after_close.png')
  await a.ctx.close(); await b.ctx.close()
}

async function main() {
  const app = await startApp(PORT)
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: PORT + 1, appPort: PORT, host: HOST })
    browser = await launch([`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT + 1}`])
    console.log(`querying_flow: app ${app.base}, https front ${front.origin}`)
    const parts = (process.env.PARTS || 'a,b,c,d,e,f,g,h,i').split(',')
    const run = { a: partA, b: partB, c: partC, d: partD, e: partE, f: partF, g: partG, h: partH, i: partI }
    for (const p of parts) {
      try { await run[p](browser) } catch (e) { t.ok(`${p}: ran to the end`, false, String(e?.message ?? e).split('\n')[0]) }
    }
  } finally {
    await browser?.close()
    await front?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nQUERYING FLOW: ALL PASS' : `\nQUERYING FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
