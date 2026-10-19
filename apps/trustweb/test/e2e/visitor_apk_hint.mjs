/**
 * Wave 16: the visitor's notification hint. A visitor opens a connect link, sees the invite, joins; Android gets the APK notice,
 * iPhone the coming-soon notice, desktop neither. "Not now" holds across a reload; Settings keeps the Android card regardless.
 * TW_SHOTS=<dir> saves 390x844 screenshots (default DEVLOG/wave16/screens/visitor-apk-hint).
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<repo>/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs npx tsx ../trustweb/test/e2e/visitor_apk_hint.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.TW_PORT || 5471)
const SHOTS = process.env.TW_SHOTS || path.resolve(TW_ROOT, '../../DEVLOG/wave16/screens/visitor-apk-hint')
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
const count = (page, sel) => page.locator(sel).count()

async function waitFor(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

/** Ada's long connect link, rewritten to this server's origin. */
async function inviteLink(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(base)
  await page.getByLabel('Your first name').fill('Ada')
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const link = await page.getAttribute('.qrwrap', 'data-payload')
  await ctx.close()
  if (!link.includes('?connect=')) throw new Error('no long link: ' + link)
  return base + link.slice(link.indexOf('?'))
}

/** A visitor on `ua` opens the link and joins as `name`. */
async function visitor(browser, link, ua, name, errors) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(ua ? { userAgent: ua, isMobile: true, hasTouch: true } : {}) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(link)
  await page.getByLabel('Your first name').waitFor({ timeout: 15_000 })
  return { ctx, page, join: async () => { await page.getByLabel('Your first name').fill(name); await page.locator('.start-form .btn-electric').click() } }
}

/** The cards that come first for a visitor: the closeness sheet ("Add Ada to your web?") and the demo-content card; the hint waits behind both. */
async function settle(page) {
  await page.locator('.sheet.on [data-connect-add]').click({ timeout: 20_000 })
  // a tap elsewhere answers the demo-content card with No, so it is usually gone already
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1_000 }).catch(() => {})
  // joining opens their card; the hint waits until it is closed
  await page.locator('.sheet-veil.on').click({ position: { x: 20, y: 20 }, timeout: 10_000 }).catch(() => {})
}

const openSettings = async (page) => {
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
  await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.sheet.on h3', { hasText: 'Settings' }).waitFor({ timeout: 5_000 })
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const viteProc = spawn(process.execPath, [path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  let browser = null
  try {
    await waitFor(base)
    const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
    browser = await (pw.chromium ? pw : pw.default).chromium.launch({ headless: true })
    const errors = []

    // 1. the loading screen: the static page before the bundle runs
    const lctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const lp = await lctx.newPage()
    await lp.route('**/src/main.ts*', (r) => r.abort())
    await lp.goto(base)
    await lp.locator('#app [data-loading]').waitFor({ timeout: 10_000 })
    const lt = await lp.locator('[data-loading]').innerText()
    ok('loading screen: logo, TrustWeb, Loading…', /◎/.test(lt) && /TrustWeb/.test(lt) && /Loading…/.test(lt), lt)
    await shot(lp, '01-loading.png')
    await lctx.close()

    const link = await inviteLink(browser, base)

    // 2. Android visitor
    const a = await visitor(browser, link, ANDROID, 'Vera', errors)
    ok('the loading screen is gone once the app drew', await count(a.page, '[data-loading]') === 0)
    ok('the invite shows', /Ada/.test(await a.page.locator('.invite').innerText()))
    await shot(a.page, '02-invite.png')
    await a.join()
    await settle(a.page)
    await a.page.locator('[data-apk-hint]').waitFor({ timeout: 20_000 })
    const note = a.page.locator('.demo-friends')
    ok('Android: the APK notice with the download link', await note.locator('a[href="https://trustweb.one/apk"]').count() === 1 && /Get reliable notifications/.test(await note.innerText()))
    ok('Android: no iPhone notice', await count(a.page, '[data-ios-soon]') === 0)
    await shot(a.page, '03-banner-android.png')
    await note.getByRole('button', { name: 'Not now' }).click()
    ok('"Not now" hides it', await note.isHidden())
    await a.page.reload()
    await a.page.locator('nav.tabs').waitFor({ timeout: 15_000 })
    await a.page.waitForTimeout(11_000)
    ok('a reload keeps it hidden', await count(a.page, '[data-apk-hint]') === 0 || await note.isHidden())
    await a.page.addStyleTag({ content: '.sheet{transition:none!important}' }) // headless: the slide-in stalls, the picture needs the sheet in place
    await openSettings(a.page)
    ok('Settings: the Android card shows even after dismissing, at the top', await count(a.page, '.sheet.on [data-apk-settings-hint]') === 1
      && await a.page.locator('.sheet.on h3').first().evaluate((h) => h.nextElementSibling.hasAttribute('data-apk-settings-hint')))
    ok('Settings card: link and "Shown until the app is installed."', await count(a.page, '[data-apk-settings-hint] a[href="https://trustweb.one/apk"]') === 1
      && /Shown until the app is installed/.test(await a.page.locator('[data-apk-settings-hint]').innerText()))
    await a.page.waitForTimeout(800)
    await shot(a.page, '05-settings-android.png')
    await a.ctx.close()

    // 3. iPhone visitor
    const i = await visitor(browser, link, IPHONE, 'Ines', errors)
    await i.join()
    await settle(i.page)
    await i.page.locator('[data-ios-soon]').waitFor({ timeout: 20_000 })
    ok('iPhone: the coming-soon notice, no APK link', /coming soon/.test(await i.page.locator('.demo-friends').innerText()) && await count(i.page, '.demo-friends a') === 0 && await count(i.page, '[data-apk-hint]') === 0)
    await shot(i.page, '04-banner-ios.png')
    await i.page.locator('.demo-friends').getByRole('button', { name: 'Got it' }).click()
    ok('"Got it" hides it', await i.page.locator('.demo-friends').isHidden())
    await openSettings(i.page)
    ok('iPhone: no Settings card', await count(i.page, '[data-apk-settings-hint]') === 0)
    await i.ctx.close()

    // 4. desktop visitor
    const d = await visitor(browser, link, null, 'Dora', errors)
    await d.join()
    await d.page.locator('nav.tabs').waitFor({ timeout: 15_000 })
    await d.page.waitForTimeout(11_000)
    ok('desktop: neither notice', await count(d.page, '[data-apk-hint], [data-ios-soon]') === 0)
    await openSettings(d.page)
    ok('desktop: no Settings card', await count(d.page, '[data-apk-settings-hint]') === 0)
    await d.ctx.close()

    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser?.close()
    viteProc.kill()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nvisitor-apk-hint: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
