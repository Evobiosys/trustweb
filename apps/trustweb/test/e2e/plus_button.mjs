/**
 * Web -> search -> Curate your web -> "Add someone" and a tap on empty space in the web open the
 * same "Add someone to your web?" sheet, and saving puts the person on the
 * rings. Also pins the 2026-10-05 nav: exactly Web | Record | My Resources, Query
 * on the Web screen, a QR button in the header instead of "Online".
 *
 * Local only (spins up a real RelayServer + Vite dev server), single phone.
 *
 * Run from apps/demo/ (it has tsx and the toolchain):
 *   PLAYWRIGHT_PACKAGE=<path to playwright-core> npx tsx ../trustweb/test/e2e/plus_button.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const PORT = Number(process.env.TW_PORT || 5199)

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

async function main() {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const viteProc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  await waitForServer(base)
  console.log('plus-button smoke against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  const browser = await engine.launch({ headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
    await page.goto(base)

    await page.getByLabel('Your first name').fill('Smoke Tester')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    ok('boots on Web screen', true)
    const offer = page.locator('.demo-friends')
    await offer.waitFor({ timeout: 5_000 })
    ok('phone: a popup offers demo content once', /Want to try it with demo content\?/.test(await offer.innerText()))
    await offer.getByRole('button', { name: 'No thanks' }).click()
    ok('"No thanks" closes it, the web stays empty', await offer.isHidden() && await page.locator('.node:not(.you)').count() === 0)
    ok('the QR button carries no status dot', await page.locator('.hdr .relay-dot').count() === 0)
    const tabs = await page.locator('nav.tabs button').allInnerTexts()
    // Wave 2 (P9): the Feed is optional and off by default, so the bar is the old one; feed_flow switches it on.
    ok('nav is exactly Web | Record | My Resources', JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(['Web', 'Record', 'My Resources']), JSON.stringify(tabs))
    ok('"Ask your web" sits on the Web screen', await page.getByRole('button', { name: 'Ask your web' }).isVisible())
    const hdr = await page.locator('.hdr-right > *').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
    ok('header right reads manage (the outliner glyph, wave 6 N3), QR, more', hdr.length === 3 && /Manage and search contacts/.test(hdr[0]) && /QR/.test(hdr[1]) && /More/.test(hdr[2]), JSON.stringify(hdr))
    ok('no "Online" text in the header', !(await page.locator('.hdr').innerText()).includes('Online'))

    await page.getByRole('button', { name: 'Search contacts' }).click()
    await page.getByRole('button', { name: /Curate your web/ }).click()
    await page.getByRole('heading', { name: 'Curate' }).waitFor({ timeout: 10_000 })
    ok('Curate lists the connections', true)
    await page.getByRole('button', { name: /Add someone/ }).click()
    await page.getByRole('heading', { name: 'Add someone to your web?' }).waitFor({ timeout: 10_000 })
    ok('Curate > Add someone opens the add sheet', true)
    await page.getByPlaceholder('Name').first().fill('Plus Person')
    await page.getByRole('button', { name: 'Add to my web' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 10_000 })
    ok('back from Curate returns to the open search, with the new person found', /Plus Person/.test(await page.locator('#search-results').innerText()))
    await page.getByRole('button', { name: 'Close search' }).click()
    ok('back on Web with the new person on the rings', await page.locator('.node', { hasText: 'Plus Person' }).count() === 1)
    ok('Record is still the raised middle tab', await page.locator('nav.tabs .tab-record').isVisible())
    // your own name: tap yourself in the web
    await page.locator('.node.you').click()
    await page.getByRole('heading', { name: 'Your name' }).waitFor({ timeout: 5_000 })
    await page.getByLabel('Your name', { exact: true }).fill('Jakob')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    ok('tapping yourself lets you change your own name', (await page.locator('.node.you span').innerText()) === 'Jakob')
    await page.reload()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    ok('the new name is kept', (await page.locator('.node.you span').innerText()) === 'Jakob')

    await page.reload()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await page.waitForTimeout(800)
    ok('the demo offer does not come back after "No thanks"', await page.locator('.demo-friends').isHidden())
    // Settings: the connection state, and demo content on and off
    await page.locator('.hdr [aria-label="Settings"]').click()
    ok('Settings shows the connection', /Connection/.test(await page.locator('#conn-row').innerText()))
    const before = await page.locator('.node:not(.you)').count()
    await page.locator('.radio', { hasText: 'Show demo content' }).click()
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    const withDemo = await page.locator('.node:not(.you)').count()
    ok('"Show demo content" adds the imaginary friends', withDemo > before, `${before} -> ${withDemo}`)
    // Real and dummy friends side by side (owner 2026-10-06): every imaginary person says "dummy", real ones do not
    ok('each imaginary friend on the web carries a "dummy" chip, nobody else', await page.locator('.node .dummy-chip').count() === withDemo - before)
    await page.locator('.node:not(.you)', { has: page.locator('.dummy-chip') }).first().click()
    ok('the person sheet says dummy too', await page.locator('.sheet h3 .dummy-chip').count() === 1)
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await page.getByRole('button', { name: 'My Resources' }).click()
    ok('the demo things in the inventory say dummy', await page.locator('.inv .dummy-chip').count() > 0)
    await page.getByRole('button', { name: 'Web', exact: true }).click()
    await page.locator('.hdr [aria-label="Settings"]').click()
    await page.locator('.radio', { hasText: 'Remove demo content' }).click()
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    ok('"Remove demo content" takes exactly them away again', await page.locator('.node:not(.you)').count() === before && await page.locator('.dummy-chip').count() === 0)
    ok('ring names (close friend, friend, ...) are hidden on the web by default', await page.locator('.node .lvl').count() === 0)
    await page.locator('.hdr [aria-label="Settings"]').click()
    await page.locator('.radio', { hasText: 'Show ring names on the web' }).click()
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    ok('Settings > Advanced shows them again', await page.locator('.node .lvl').count() > 0)

    // Record: who (orange) or what (blue), picked from where you came; Advanced folds the extra notes away
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 5_000 })
    ok('from Inventory, the Record tab opens a meeting (owner 2026-10-06, origin rule)', true)
    await page.getByRole('button', { name: 'Just me', exact: true }).click()
    ok('"Just me" from there asks "what" first (it came from Inventory)', await page.locator('.about-kind.what.on').count() === 1 && /Who\s*or\s*what\s*was this about\?/.test(await page.locator('.about-row').innerText()))
    ok('no hint "i" on a desktop/mouse screen', await page.locator('.hint-i').count() === 0)
    await page.getByRole('button', { name: 'Web', exact: true }).click()
    await page.locator('nav.tabs .tab-record').click()
    ok('from Web, it is "who" (orange)', await page.locator('.about-kind.who.on').count() === 1)
    await page.locator('.about-kind.what').click()
    await page.getByRole('heading', { name: 'What was this about?' }).waitFor({ timeout: 5_000 })
    await page.getByLabel('What was this about?').fill('Plus Person')
    await page.getByRole('button', { name: 'Done' }).click()
    ok('typing a person\'s name switches it to "who" by itself', (await page.locator('.about-row.who .about-value').innerText()) === 'Plus Person')
    ok('the explanation lines sit behind "Advanced"', !(await page.getByText('Just you, to debrief').isVisible()) && await page.getByRole('button', { name: /Advanced/ }).isVisible())
    await page.getByRole('button', { name: /Advanced/ }).click()
    await page.getByLabel('Add: opportunity').fill('Hiring a designer in Graz')
    await page.getByLabel('Add: opportunity').press('Enter')
    ok('Advanced: an opportunity is noted by hand', /Hiring a designer in Graz/.test(await page.locator('.adv').innerText()))
    await page.getByRole('button', { name: 'Send' }).click()
    await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
    ok('it reaches Review as an opportunity line', (await page.locator('.line-text').evaluateAll((els) => els.map((e) => e.value))).includes('Hiring a designer in Graz'))
    await page.getByRole('button', { name: 'Back' }).click().catch(() => {})
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Discard' }).click()

    // Inventory: the cog top right (where ⋮ is on Web), "Review requests" where Web has "Ask your web"
    await page.getByRole('button', { name: 'Web', exact: true }).click()
    const moreOnWeb = await page.locator('.hdr [aria-label="Settings"]').boundingBox()
    const callOnWeb = await page.getByRole('button', { name: 'Ask your web' }).boundingBox()
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    const cog = await page.locator('.hdr-right .hdr-btn.icon-only').last().boundingBox()
    ok('Inventory: the cog sits top right, where ⋮ sits on Web', Math.abs(cog.x - moreOnWeb.x) < 1 && Math.abs(cog.y - moreOnWeb.y) < 1, JSON.stringify([moreOnWeb, cog]))
    const req = page.getByRole('button', { name: 'Review requests' })
    const rb = await req.boundingBox()
    ok('Inventory: "Review / requests" (two lines) sits where "Ask your web" sits', Math.abs(rb.x + rb.width - callOnWeb.x - callOnWeb.width) < 2 && Math.abs(rb.y + rb.height - callOnWeb.y - callOnWeb.height) < 2 && /Review\s*\n\s*requests/.test(await req.innerText()))
    await req.click()
    ok('it opens the asks people sent you', await page.getByRole('heading', { name: 'Requests to My Resources' }).isVisible())
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // "what": the notes go to the inventory, with who may ask about each line
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('button', { name: 'Just me', exact: true }).click()
    await page.locator('.about-kind.what').click()
    await page.getByLabel('What was this about?').fill('Cargo bike')
    await page.getByRole('button', { name: 'Done' }).click()
    ok('a new topic stays "what" (blue)', (await page.locator('.about-row.what .about-value').innerText()) === 'Cargo bike')
    const adv = page.getByRole('button', { name: /Advanced/ })
    if ((await adv.getAttribute('aria-expanded')) !== 'true') await adv.click()
    await page.getByLabel('Add: resource').fill('can lend it on weekends')
    await page.getByLabel('Add: resource').press('Enter')
    await page.getByRole('button', { name: 'Send' }).click()
    await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
    await page.locator('.cta .btn').click()
    await page.getByRole('button', { name: 'Save to My Resources' }).click()
    await page.waitForTimeout(400)
    ok('"what" notes land in the inventory', /Cargo bike: can lend it on weekends/.test(await page.locator('.screen').innerText()))

    // touch phone: the small "i" hints
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const tp = await touch.newPage()
    await tp.goto(base)
    await tp.getByLabel('Your first name').fill('Touch')
    await tp.getByRole('button', { name: 'Start on this phone' }).click()
    await tp.getByRole('button', { name: 'No thanks' }).click()
    await tp.locator('nav.tabs .tab-record').click()
    const meetHint = tp.getByRole('button', { name: 'About Meeting button' })
    ok('touch: Meeting, QR, who, what and Advanced carry an "i"', await meetHint.isVisible() && await tp.locator('.hint-i').count() === 5)
    await meetHint.click()
    const again = tp.getByLabel('Show this hint again')
    ok('touch: the "i" explains, with "Show this hint again" ticked', /two people|agreed/.test(await tp.locator('.demo-friends').innerText()) && await again.isChecked())
    await again.uncheck()
    await tp.getByRole('button', { name: 'OK', exact: true }).click()
    ok('touch: unticked, that "i" is gone', await tp.getByRole('button', { name: 'About Meeting button' }).count() === 0 && await tp.locator('.hint-i').count() === 4)
    await tp.getByRole('button', { name: 'Web', exact: true }).click()
    await tp.locator('.hdr [aria-label="Settings"]').click()
    await tp.getByRole('button', { name: 'Show all hints again' }).click()
    await tp.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await tp.locator('nav.tabs .tab-record').click()
    ok('touch: Settings > Tutorial brings every hint back', await tp.getByRole('button', { name: 'About Meeting button' }).isVisible())
    await touch.close()

    // desktop: outside the phone, "Add a device" and "See it in action" (an overlay)
    const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    desk.on('pageerror', (e) => console.log('  [pageerror desktop]', e.message))
    await desk.goto(base)
    const see = desk.getByRole('button', { name: 'See it in action' })
    ok('desktop: "Add a device" and "See it in action" sit outside the phone', await see.isVisible() && (await desk.locator('.page-dock .add-device').innerText()).includes('Add a device'))
    await desk.getByLabel('Your first name').fill('Desk')
    await desk.getByRole('button', { name: 'Start on this phone' }).click()
    const toggle = desk.locator('.demo-toggle')
    await toggle.waitFor({ timeout: 5_000 })
    const tb = await toggle.boundingBox()
    ok('desktop: demo content button bottom left, no popup', tb.x < 100 && tb.y > 700 && await desk.locator('.demo-friends').isHidden())
    await toggle.click()
    ok('desktop: it adds the demo content', await desk.locator('.node:not(.you)').count() > 0 && (await toggle.innerText()) === 'Remove demo content')
    await see.click()
    await desk.locator('.wt-modal .wt-banner').waitFor({ timeout: 10_000 })
    ok('desktop: it opens the walkthrough as an overlay', /This happened now/i.test(await desk.locator('.wt-modal').innerText()))
    await desk.keyboard.press('Escape')
    ok('desktop: Escape closes it', await desk.locator('.wt-modal').count() === 0)
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await phone.goto(base)
    ok('phone: no page dock, the app is the whole screen', !(await phone.locator('.page-dock').isVisible()) && (await phone.locator('.phone').boundingBox()).width === 390)
  } finally {
    await browser.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nplus-button smoke: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
