/**
 * Wave 3 (2026-10-07) in the real app, local only:
 *   1. Settings > Advanced "Ask only my direct contacts": off by default, kept
 *      in the record only while on, said in the query dock; an ask with it on
 *      still reaches a direct contact (whose build reads the new `direct` flag)
 *      and is answered.
 *   3. Web results inside the app (websearch-api-contract v1.0), against a FAKE /websearch (page.route): the
 *      "Show results here" button only where the server lists an api engine with a key; nothing fetched
 *      before the tap and the once-per-engine yes; POST with the words in the body; results as text under
 *      "Outside TrustWeb, untrusted results, via Brave."; http(s) links only, new tab, no referrer; a redraw
 *      never fetches again; 503 not_configured hides that engine; no route at all = no button.
 * Ports: Vite 5283, relay on 0. TW_SHOTS=<dir> for screenshots (phone + desktop).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/wave3_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const openSettings = async (page) => {
  await tab(page, 'My Resources')
  await page.evaluate(() => localStorage.setItem('trustweb.ui.settings.advanced', '1')) // Settings > Advanced is folded by default
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 5_000 })
  // The sheet redraws once the server's status is in (app-wave2 A2): wait for it, so no click lands on the old sheet.
  await page.locator('.sheet.on [data-server-transcribe]').waitFor({ timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(150)
}

/** Ben connects to Jakob with Jakob's code and notes a cargo bike anyone in his web may ask about. */
async function connectBen(browser, a) {
  await tab(a, 'Membranes')
  await a.locator('.hdr [aria-label^="Show my code"]').click()
  await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = await a.getAttribute('.qrwrap', 'data-payload')
  const b = await newPhone(browser, errors)
  await b.goto(url)
  await b.getByLabel('Your first name').fill('Ben')
  await b.getByRole('button', { name: 'Connect', exact: true }).click()
  await acceptAdd(b)
  await until(async () => (await record(a)).peers.length === 1)
  await a.getByRole('button', { name: 'Back' }).click().catch(() => {})
  await tab(b, 'My Resources')
  await b.getByPlaceholder(/Motorbike/).fill('Cargo bike, can lend it on weekends')
  await b.getByRole('button', { name: 'Add', exact: true }).click()
  return b
}

/** Item 1: the setting, its copy, and an ask with it on. */
async function partDirect(browser, a) {
  await openSettings(a)
  const toggle = a.locator('.sheet.on [data-direct-only]')
  await toggle.scrollIntoViewIfNeeded()
  ok('Settings > Advanced: "Ask only my direct contacts", off by default', (await toggle.getAttribute('aria-pressed')) === 'false' && /Ask only my direct contacts/.test(await toggle.innerText()))
  ok('its hint says what it does', /never passes your ask on/.test(await toggle.innerText()))
  ok('off is not stored (the record keeps only what differs)', !('askDirectOnly' in (await record(a))))
  await toggle.click()
  await a.locator('.sheet.on [data-direct-only][aria-pressed="true"]').waitFor({ timeout: 5_000 })
  ok('on: kept in the record as true', (await record(a)).askDirectOnly === true)
  await a.locator('.sheet.on [data-direct-only]').scrollIntoViewIfNeeded()
  await shot(a, 'w3-01-direct-only-setting')
  await closeSheet(a)

  const b = await connectBen(browser, a)
  await tab(a, 'Membranes')
  await a.locator('[data-open-query="1"]').click()
  ok('the query dock says only direct contacts are asked', /Only your direct contacts are asked/.test(await a.locator('.query-dock [data-direct-note]').innerText()))
  await a.locator('.query-dock textarea').fill('Does anyone have a cargo bike?')
  await a.getByRole('button', { name: 'Call into my web' }).click()
  const share = b.getByRole('button', { name: 'Share these' })
  await share.waitFor({ timeout: 30_000 }).catch(() => {})
  ok('the direct ask reaches Ben and his phone shows it (the new build reads the flag)', await share.isVisible())
  await shot(a, 'w3-02-direct-only-asked')
  await share.click()
  const got = await until(async () => /Ben chose to share/.test(await a.locator('.query-dock').innerText()), 200_000)
  ok('Ben shares: Jakob gets the answer as before', Boolean(got))
  ok('the dock still says only direct contacts were asked', await a.locator('.query-dock [data-direct-note]').count() === 1)
  await a.locator('.query-dock .x').click()
  await b.context().close()

  await openSettings(a)
  await a.locator('.sheet.on [data-direct-only]').scrollIntoViewIfNeeded()
  await a.locator('.sheet.on [data-direct-only]').click()
  await a.locator('.sheet.on [data-direct-only][aria-pressed="false"]').waitFor({ timeout: 5_000 })
  ok('off again: the field is gone from the record', !('askDirectOnly' in (await record(a))))
  await closeSheet(a)
}

const ENGINES = { engines: [
  { id: 'brave', label: 'Brave', mode: 'api', configured: true },
  { id: 'mojeek', label: 'Mojeek', mode: 'api', configured: true },
  { id: 'qwant', label: 'Qwant', mode: 'link_only', configured: false },
  { id: 'ecosia', label: 'Ecosia', mode: 'api', configured: false },
] }
const BRAVE_ANSWER = { engine: 'brave', label: 'Brave', untrusted: true, extra: 'ignored', results: [
  { title: '<b>Cargo bikes</b> in Vienna', url: 'https://example.org/cargo?x=1', snippet: 'Rent a cargo bike <script>alert(1)</script> by the day.' },
  { title: 'Never shown', url: 'javascript:alert(1)', snippet: 'a script link is dropped' },
  { title: 'Plain http', url: 'http://bikes.example.net/', snippet: '' },
] }

/** Item 3: results inside the app, against a fake route. */
async function partWebResults(browser, base, a) {
  // A server without the route (as in production today): no button, nothing else changes.
  const plain = await newPhone(browser, errors)
  await startPhone(plain, base, 'Mia')
  await plain.getByRole('button', { name: 'Search contacts' }).click()
  await plain.locator('.search-field').fill('cargo bike')
  await plain.waitForTimeout(1_500)
  ok('no /websearch route on the server: no "Show results here", the wave-2 links stay', await plain.locator('[data-web-results-show]').count() === 0 && await plain.locator('[data-web-search] a.web-engine').count() === 4)
  await plain.context().close()

  const posts = []
  const engineCalls = []
  await a.route('**/websearch/engines', (route) => { engineCalls.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ENGINES) }) })
  await a.route('**/websearch', (route) => {
    const req = route.request()
    posts.push({ method: req.method(), url: req.url(), body: req.postDataJSON(), type: req.headers()['content-type'] })
    const engine = req.postDataJSON()?.engine
    if (engine === 'mojeek') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'not_configured', message: 'x', engine: 'mojeek' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BRAVE_ANSWER) })
  })
  await a.reload()
  await a.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await a.getByRole('button', { name: 'Search contacts' }).click()
  await a.locator('.search-field').fill('cargo  bike')
  const show = a.locator('[data-web-results-show]')
  await show.waitFor({ timeout: 10_000 })
  const engines = await a.locator('[data-web-results-engine]').evaluateAll((bs) => bs.map((b) => b.textContent))
  ok('the button shows below the links; the picker offers only engines with an API and a key (Brave, Mojeek)', JSON.stringify(engines) === JSON.stringify(['Brave', 'Mojeek']), JSON.stringify(engines))
  ok('the engine list was asked once, and nothing was searched yet', engineCalls.length === 1 && posts.length === 0)
  await shot(a, 'w3-03-web-results-button')
  await show.click()
  const ask = a.locator('[data-web-consent="brave"]')
  await ask.waitFor({ timeout: 5_000 })
  ok('first search with an engine: "Searching here sends your words to Brave. Continue?", still nothing sent', /Searching here sends your words to Brave\. Continue\?/.test(await ask.innerText()) && posts.length === 0)
  await shot(a, 'w3-04-web-results-consent')
  await a.locator('[data-web-consent-yes]').click()
  const panel = a.locator('[data-web-results="brave"]')
  await panel.locator('.web-result').first().waitFor({ timeout: 10_000 })
  ok('one POST, the words in the body (spaces collapsed), none in the URL', posts.length === 1 && posts[0].method === 'POST' && !posts[0].url.includes('?') && /application\/json/.test(posts[0].type)
    && JSON.stringify(posts[0].body) === JSON.stringify({ q: 'cargo bike', engine: 'brave' }), JSON.stringify(posts))
  const text = await panel.innerText()
  ok('the binding label: "Outside TrustWeb, untrusted results, via Brave." and the privacy line', /Outside TrustWeb, untrusted results, via Brave\./.test(text) && /Your words were sent to Brave through our server\. Your device address was not\./.test(text), text)
  const items = await panel.locator('.web-result a').evaluateAll((as) => as.map((x) => ({ text: x.textContent, href: x.getAttribute('href'), target: x.target, rel: x.rel, ref: x.getAttribute('referrerpolicy') })))
  ok('results as plain text (markup shown as text, never run), the javascript: link dropped', items.length === 2 && items[0].text === '<b>Cargo bikes</b> in Vienna' && await panel.locator('b', { hasText: 'Cargo bikes' }).count() === 0
    && /<script>alert\(1\)<\/script>/.test(text) && !items.some((i) => /javascript/.test(i.href)), JSON.stringify(items))
  ok('links: http(s) only, new tab, no opener, no referrer', items.every((i) => /^https?:/.test(i.href) && i.target === '_blank' && /noopener/.test(i.rel) && /noreferrer/.test(i.rel) && i.ref === 'no-referrer'), JSON.stringify(items))
  ok('the host shows muted under each title; no images anywhere in the panel', /example\.org/.test(await panel.locator('.web-result-host').first().innerText()) && await panel.locator('img').count() === 0)
  const out = await panel.locator('[data-web-results-out]').getAttribute('href')
  ok('footer: "Search on Brave yourself" (the link-out) and "Powered by Brave"', out === 'https://search.brave.com/search?q=cargo%20bike' && /Search on Brave yourself/.test(text) && /Powered by Brave/.test(text), out)
  ok('the yes is remembered for Brave', JSON.stringify((await record(a)).webSearchConsent) === '["brave"]')
  await panel.scrollIntoViewIfNeeded()
  await shot(a, 'w3-05-web-results')
  // A redraw with the same words (the input event fires again) shows the same results and never fetches again.
  await a.locator('.search-field').fill('cargo  bike')
  await a.waitForTimeout(400)
  ok('a redraw keeps the results and sends nothing again', posts.length === 1 && await a.locator('[data-web-results="brave"] .web-result').count() === 2)
  // The same engine again for new words: no second yes.
  await a.locator('.search-field').fill('ladder')
  ok('new words: the old results go', await a.locator('[data-web-results]').count() === 0)
  await a.locator('[data-web-results-show]').click()
  await a.locator('[data-web-results="brave"] .web-result').first().waitFor({ timeout: 10_000 })
  ok('Brave again, other words: asked once only, searched at once', posts.length === 2 && posts[1].body.q === 'ladder' && await a.locator('[data-web-consent]').count() === 0)
  // Mojeek: its own yes; the server says not_configured: the button goes for Mojeek.
  await a.locator('[data-web-results-engine="mojeek"]').click()
  await a.locator('[data-web-results-show]').click()
  await a.locator('[data-web-consent="mojeek"]').waitFor({ timeout: 5_000 })
  ok('another engine asks its own yes', /sends your words to Mojeek/.test(await a.locator('[data-web-consent="mojeek"]').innerText()))
  await a.locator('[data-web-consent-yes]').click()
  await a.locator('[data-web-results-error="not_configured"]').waitFor({ timeout: 10_000 })
  ok('503 not_configured: says so, offers "Search on Mojeek yourself", and the Mojeek choice goes (only Brave left: no picker)',
    /not available for this engine/.test(await a.locator('[data-web-results="mojeek"]').innerText()) && (await a.locator('[data-web-results-out="mojeek"]').getAttribute('href')) === 'https://www.mojeek.com/search?q=ladder'
      && await a.locator('[data-web-results-engine]').count() === 0 && (await a.locator('[data-web-results-show]').getAttribute('data-web-results-show')) === 'brave')
  ok('yes kept for both engines', JSON.stringify((await record(a)).webSearchConsent) === '["brave","mojeek"]')
  await a.getByRole('button', { name: 'Close search' }).click()
  await a.unroute('**/websearch/engines')
  await a.unroute('**/websearch')
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(Number(process.env.TW_PORT || 5283), { relayPort: relay.port })
  let browser = null
  try {
    browser = await launch()
    const a = await newPhone(browser, errors)
    await startPhone(a, vite.base, 'Jakob')
    await partDirect(browser, a)
    await partWebResults(browser, vite.base, a)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nwave3-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
