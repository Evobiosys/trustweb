/**
 * The internet-freedom demo (demo/?for=otf, for Open Technology Fund reviewers, 2026-10-19), in a real headless browser:
 * every demo page renders without a page error (they stayed blank live on 2026-10-19), the context switcher lists the
 * four seeded webs, and the steps the OTF page tells a visitor to try do what they say, over a real relay:
 *   1. "Does anyone know a lawyer for activists?" -> the first phone shows the lawyer line -> shared -> the second phone gets it.
 *   2. "Does anyone know a driver at the border?" -> that note is "Only me": the first phone stays silent, "No match".
 *
 * Local (default): the BUILT app (dist/, base /; build it first) served by `vite preview`, /relay proxied to
 * packages/transport's RelayServer on an ephemeral port. Pairing needs the page on an app origin (connect links are always
 * built on one, event_link.ts linkOrigin, and solo.ts takes only same-origin links), so TW_AS_LIVE=1 serves the local build
 * AS https://app.trustweb.one/ (Playwright routes its pages and assets to the preview; the relay websocket stays production's).
 * Live: TW_URL=https://app.trustweb.one/ (production relay).
 * Run from apps/trustweb:
 *   TW_BASE=/ ../crm/node_modules/.bin/vite build --outDir dist --emptyOutDir
 *   PLAYWRIGHT_PACKAGE=<path to playwright> ../demo/node_modules/.bin/tsx test/e2e/demo_otf.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { checker, launch, startRelay, TW_ROOT, waitForServer } from './swiss_harness.mjs'

const LIVE = process.env.TW_URL
const PORT = Number(process.env.TW_PORT || 5293)
const c = checker()

async function main() {
  let relay = null
  let preview = null
  let base = LIVE
  if (!LIVE) {
    relay = await startRelay()
    preview = spawn(process.execPath, [path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), 'preview', '--outDir', 'dist', '--strictPort', '--port', String(PORT), '--host', '127.0.0.1'], {
      cwd: TW_ROOT, env: { ...process.env, TW_RELAY_PROXY: `http://127.0.0.1:${relay.port}` }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    base = `http://127.0.0.1:${PORT}/`
    await waitForServer(base)
  }
  const local = base
  if (!LIVE && process.env.TW_AS_LIVE) base = 'https://app.trustweb.one/'
  console.log('trustweb OTF demo against ' + base)
  const browser = await launch()
  const newPage = async (opts) => {
    const page = await browser.newPage(opts)
    if (base !== local) {
      await page.route('https://app.trustweb.one/**', async (route) => {
        const u = new URL(route.request().url())
        if (u.pathname.startsWith('/relay')) return route.continue() // the relay is production's, over http as over its websocket
        const res = await fetch(local + u.pathname.slice(1) + u.search)
        route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) })
      })
    }
    return page
  }
  try {
    // Every demo page renders: no page error, the title and a first phone.
    for (const page of ['demo/', 'demo/?for=otf', 'ea-demo/', 'emergent-demo/']) {
      const p = await newPage()
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.goto(base + page)
      await p.getByRole('heading', { name: 'TrustWeb demo' }).waitFor({ timeout: 20_000 })
      await p.frameLocator('iframe[title="Device 1"]').getByLabel('Your first name').waitFor({ timeout: 20_000 })
      c.ok(`${page} renders with its first phone and no page error`, errors.length === 0, errors.join(' | '))
      await p.close()
    }

    const page = await newPage({ viewport: { width: 1300, height: 1000 } })
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
    await page.goto(base + 'demo/?for=otf')
    const nav = await page.locator('nav.contexts a').allInnerTexts()
    c.ok('the switcher lists the four seeded webs', nav.join('|') === 'Everyday|Internet freedom|Effective giving|Emergent Ventures', JSON.stringify(nav))
    c.ok('"Internet freedom" is the current one', (await page.locator('nav.contexts a[aria-current="page"]').innerText()) === 'Internet freedom')
    c.ok('the intro speaks to people who must not be seen asking', /human rights defenders/.test(await page.locator('.head p').innerText()))

    const maya = page.frameLocator('iframe[title="Device 1"]')
    const jonas = page.frameLocator('iframe[title="Device 2"]')
    await maya.getByLabel('Your first name').fill('Maya')
    await maya.getByRole('button', { name: 'Start on this phone' }).click()
    await maya.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
    const people = await maya.locator('.node').allInnerTexts()
    c.ok('the first phone shows the internet-freedom web', people.some((t) => /Leyla/.test(t)) && people.some((t) => /Daniel/.test(t)), JSON.stringify(people))
    await page.getByRole('button', { name: /Add a device/ }).click()
    await jonas.getByRole('button', { name: 'Connect', exact: true }).click({ timeout: 30_000 })
    await jonas.getByRole('button', { name: 'Ask your web' }).click({ timeout: 30_000 })
    await page.waitForFunction(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === 'Device 2')
      return [...(f?.contentDocument?.querySelectorAll('button') ?? [])].some((x) => x.textContent === 'Ask my web' && !x.disabled)
    }, null, { timeout: 30_000 })
    const ask = async (text) => {
      await jonas.locator('textarea').fill(text)
      await jonas.getByRole('button', { name: 'Ask my web' }).click()
    }
    const result = async () => {
      await jonas.locator('.card.asked .outcome').first().waitFor({ timeout: 200_000 })
      return jonas.locator('.card.asked').first().innerText()
    }

    // Step 1: the lawyer.
    await ask('Does anyone know a lawyer for activists?')
    await maya.getByText('Jonas asks').waitFor({ timeout: 20_000 })
    const lines = await maya.locator('.ask-line').allInnerTexts()
    c.ok('step 1: the first phone shows the lawyer line', lines.some((t) => /Lawyer who advises activists/.test(t)), JSON.stringify(lines))
    c.ok('step 1: never the "Only me" border driver', !lines.some((t) => /border/.test(t)), JSON.stringify(lines))
    await maya.getByRole('button', { name: 'Share these' }).click()
    const shared = await result()
    c.ok('step 3: the second phone gets what was shared', /Maya chose to share/.test(shared) && /Lawyer/.test(shared), shared)
    await maya.getByRole('button', { name: 'Back to the app' }).click()

    // Step 4: the border driver, shared with nobody.
    await ask('Does anyone know a driver at the border?')
    let prompted = false
    const t0 = Date.now()
    while (Date.now() - t0 < 90_000) {
      if (await maya.locator('.overlay.on').isVisible()) { prompted = true; break }
      if (await jonas.locator('.card.asked .outcome').count() > 1) break
      await page.waitForTimeout(500)
    }
    c.ok('step 4: the first phone stays silent', !prompted)
    const silent = await result()
    c.ok('step 4: the second phone sees "No match"', /No match/.test(silent) && /border/.test(silent), silent)
    if (process.env.TW_SHOT) await page.screenshot({ path: process.env.TW_SHOT })
  } catch (e) {
    c.ok('the flow runs to the end', false, e.message.split('\n')[0])
    if (process.env.TW_SHOT) await browser.contexts()[0]?.pages().at(-1)?.screenshot({ path: process.env.TW_SHOT }).catch(() => {})
  } finally {
    await browser.close().catch(() => {})
    if (preview) {
      preview.kill('SIGTERM')
      await new Promise((r) => { preview.once('exit', r); setTimeout(r, 3000) })
    }
    await relay?.stop()
  }
  console.log(`\ntrustweb OTF demo: ${c.failures === 0 ? 'ALL PASS' : c.failures + ' FAILURE(S)'} (${c.passes} passed)`)
  process.exitCode = c.failures ? 1 : 0
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
