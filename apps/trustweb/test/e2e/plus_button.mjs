/**
 * A tap on empty space in the web opens "Add someone to your web?" with the ring of the tap, saving puts the person on the rings, and
 * Settings > "Curate your web" lists them (answers-44a: the current Curate/add flow, data attributes, no fixed pixels; at 360x780 and
 * 1280x900). Also pins the header (QR, Settings, AI top right, no "Online"), the bar, demo content, Record (Note taker), the touch hints
 * and the page around the phone frame.
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
/** review-44 / answers-44a: the dev overlays (.twf/.twp) stay out of the way, on every load of the context (a reload drops a style tag). */
const hideOverlays = (ctx) => ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st)
}))
const okAt = (name, cond, detail = '') => {
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
  // review-44: the vite of swiss_harness.mjs (TW_VITE_BIN, apps/crm's Vite 8 that the app config needs), else apps/demo's.
  const viteProc = spawn(process.execPath, [process.env.TW_VITE_BIN || path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  await waitForServer(base)
  console.log('plus-button smoke against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  const browser = await engine.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-mock-keychain', '--password-store=basic'] }) // review-44: the local headless shell, as swiss_harness.mjs
  try {
    for (const [w, h] of [[360, 780], [1280, 900]]) await phoneRun(browser, base, w, h)
    await touchAndDesk(browser, base)
  } finally {
    await browser.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nplus-button smoke: ALL PASS')
  process.exit(failures ? 1 : 0)
}

/** answers-44a: the ring a tap lands on, from the drawn circle (data-ring), never a fixed pixel: a point on its right edge. */
async function tapRing(page, ring) {
  const c = await page.locator(`.rings-wrap circle[data-ring="${ring}"]`).boundingBox()
  await page.mouse.click(c.x + c.width - 1, c.y + c.height / 2)
}

/** answers-44a: the whole phone flow at one size (360x780 and 1280x900; the wide one in its default full-width TrustWeb layout). */
async function phoneRun(browser, base, w, h) {
  const ok = (name, cond, detail) => okAt(`${w}: ${name}`, cond, detail)
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  try {
    await hideOverlays(ctx)
    const page = await ctx.newPage()
    /** answers-44a: a sheet closes with Escape (at 360 the sheet covers the veil's corner). */
    const closeSheet = async () => { await page.keyboard.press('Escape'); await page.locator('.sheet.on').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {}); await page.waitForTimeout(300) }
    /** answers-44a: Settings with every fold open (the one Advanced fold of wave 43c holds the older switches), settled. */
    const settings = async () => {
      await page.locator('.hdr [aria-label="Settings"]').click()
      await page.locator('.sheet.on').waitFor(); await page.waitForTimeout(400)
      await page.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
    }
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
    await page.goto(base)
    // review-44: as swiss_harness.mjs startPhone: a fresh dev server reloads once after optimising dependencies (a name typed before is lost),
    // and the dev overlays (.twf/.twp) stay out of the way.
    await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500)

    await page.getByLabel('Your first name').fill('Smoke Tester')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    ok('boots on Web screen', true)
    const offer = page.locator('.demo-friends')
    if (w < 600) {
      await offer.waitFor({ timeout: 5_000 })
      ok('phone: a popup offers demo content once', /Want to try it with demo content\?/.test(await offer.innerText()))
      await offer.getByRole('button', { name: 'No thanks' }).click()
      ok('"No thanks" closes it, the web stays empty', await offer.isHidden() && await page.locator('.node:not(.you)').count() === 0)
    } else {
      // wide: the demo content sits on a button outside the phone, no popup (touchAndDesk covers that button)
      await page.waitForTimeout(800)
      ok('wide: no demo popup, the web stays empty', await offer.isHidden() && await page.locator('.node:not(.you)').count() === 0)
    }
    ok('the QR button carries no status dot', await page.locator('.hdr .relay-dot').count() === 0)
    const tabs = await page.locator('nav.tabs button').allInnerTexts()
    // Wave 2 (P9): the Feed is optional and off by default, so the bar is the old one; feed_flow switches it on.
    // review-44: the bar grew (Chat, Feed, Events as its own button: wave 44 item 6) and ends in ⋮; Web stays first, Resources stays in it.
    const tabNames = tabs.map((t) => t.trim())
    ok('nav starts with Web, holds Events and Resources, ends in ⋮', tabNames[0] === 'Web' && tabNames.includes('Events') && tabNames.includes('Resources') && tabNames[tabNames.length - 1] === '⋮', JSON.stringify(tabs))
    ok('"Ask your web" sits on the Web screen', await page.getByRole('button', { name: 'Ask your web' }).isVisible())
    // review-44 (header-layout, item 23): the top right is the same everywhere: QR, Settings, the AI sparkle; search and the eye sit in the tools row.
    const hdr = await page.locator('.hdr-right > *').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.querySelector('[aria-label]')?.getAttribute('aria-label') ?? ''))
    ok('header right reads QR, Settings, Your AI', hdr.length === 3 && /QR/.test(hdr[0]) && /Settings/.test(hdr[1]) && /AI/.test(hdr[2]), JSON.stringify(hdr))
    ok('no "Online" text in the header', !(await page.locator('.hdr').innerText()).includes('Online'))

    // answers-44a: the current add flow: a tap on the empty web offers "Add someone to your web?" with the ring of the tap (data-ring).
    await tapRing(page, 'friend')
    await page.getByRole('heading', { name: 'Add someone to your web?' }).waitFor({ timeout: 10_000 })
    ok('a tap on the empty web opens the add sheet', true)
    ok('the ring is preselected by where you tapped', await page.locator('.add-rings .radio.on').getAttribute('data-ring') === 'friend')
    await page.getByPlaceholder('Name').first().fill('Plus Person')
    await page.locator('[data-add-person]').click()
    await page.locator('.node', { hasText: 'Plus Person' }).waitFor({ timeout: 10_000 })
    ok('the new person is on the rings', await page.locator('.node', { hasText: 'Plus Person' }).count() === 1)
    // answers-44a: Curate is Settings > "Curate your web" (the Contacts sheet of the Web Curator, wave-6 search overlay gone)
    await settings()
    await page.locator('[data-settings-curate]').first().scrollIntoViewIfNeeded(); await page.locator('[data-settings-curate]').first().click()
    const cur = page.locator('.sheet[data-kind="curator"]')
    await cur.locator('[data-action="toggle-all-groups"]').click({ timeout: 15_000 })
    await cur.getByText('Plus Person').first().waitFor({ timeout: 10_000 })
    ok('Curate lists the connections', true)
    await closeSheet()
    await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 10_000 })
    // answers-44a: Record left the stock bar (wave 33 presets); the Note taker variation brings it back as the raised tab.
    await settings()
    await page.locator('.sheet.on .radio', { hasText: 'Note taker' }).first().click(); await page.waitForTimeout(300)
    await closeSheet()
    ok('Settings > Note taker puts Record in the bar', await page.locator('nav.tabs .tab-record').isVisible())
    // your own name: tap yourself in the web
    await page.locator('.node.you').click()
    await page.locator('[data-profile-expander]').click() // wave44b: the section list sits behind the V expander
    await page.locator('[data-own-profile-name]').click() // wave 36b: the centre dot opens the own profile page; the name change sits on it
    await page.getByRole('heading', { name: 'Your name' }).waitFor({ timeout: 5_000 })
    await page.getByLabel('Your name', { exact: true }).fill('Jakob')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.goBack(); await page.waitForTimeout(400)
    ok('tapping yourself lets you change your own name', (await page.locator('.node.you').getAttribute('aria-label')).includes('Jakob'))
    await page.reload()
    await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    ok('the new name is kept', (await page.locator('.node.you').getAttribute('aria-label')).includes('Jakob'))

    await page.reload()
    await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    await page.waitForTimeout(800)
    ok('the demo offer does not come back after a reload', await page.locator('.demo-friends').isHidden())
    // Settings: the connection state, and demo content on and off
    await settings()
    ok('Settings shows the connection', /Connection/.test(await page.locator('#conn-row').textContent()))
    const before = await page.locator('.node:not(.you)').count()
    await page.locator('.radio', { hasText: 'Show demo content' }).click()
    await closeSheet()
    const withDemo = await page.locator('.node:not(.you)').count()
    ok('"Show demo content" adds the imaginary friends', withDemo > before, `${before} -> ${withDemo}`)
    // Real and dummy friends side by side (owner 2026-10-06): every imaginary person says "dummy", real ones do not
    ok('each imaginary friend on the web carries a "dummy" chip, nobody else', await page.locator('.node .dummy-chip').count() === withDemo - before)
    // a crowded web may lay another's label over the node: the press goes to the node itself
    await page.locator('.node:not(.you)', { has: page.locator('.dummy-chip') }).first().dispatchEvent('click')
    // answers-44a: a person opens as their card page (the dummy chip stays on the web node and on the demo things)
    await page.getByRole('heading', { name: 'Card' }).waitFor({ timeout: 5_000 })
    ok('a dummy friend opens their card', true)
    await page.goBack(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 5_000 })
    await page.locator('nav.tabs [data-go="inventory"]').click()
    ok('the demo things in the inventory say dummy', await page.locator('.inv .dummy-chip').count() > 0)
    await page.locator('nav.tabs [data-go="web"]').click()
    await settings()
    await page.locator('.radio', { hasText: 'Remove demo content' }).click()
    await closeSheet()
    ok('"Remove demo content" takes exactly them away again', await page.locator('.node:not(.you)').count() === before && await page.locator('.dummy-chip').count() === 0)
    ok('ring names (close friend, friend, ...) are hidden on the web by default', await page.locator('.node .lvl').count() === 0)
    await settings()
    await page.locator('.radio', { hasText: 'Show ring names on the web' }).click()
    await closeSheet()
    ok('Settings > Advanced shows them again', await page.locator('.node .lvl').count() > 0)

    // Record: who (orange) or what (blue), picked from where you came; Advanced folds the extra notes away
    await page.locator('nav.tabs [data-go="inventory"]').click()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 5_000 })
    ok('from Inventory, the Record tab opens a meeting (owner 2026-10-06, origin rule)', true)
    await page.getByRole('button', { name: 'Just me', exact: true }).click()
    ok('"Just me" from there asks "what" first (it came from Inventory)', await page.locator('.about-kind.what.on').count() === 1 && /Who\s*or\s*what\s*was this about\?/.test(await page.locator('.about-row').innerText()))
    ok('no hint "i" on a desktop/mouse screen', await page.locator('.hint-i').count() === 0)
    await page.locator('nav.tabs [data-go="web"]').click()
    await page.locator('nav.tabs .tab-record').click()
    ok('from Web, it is "who" (orange)', await page.locator('.about-kind.who.on').count() === 1)
    await page.locator('.about-kind.what').click()
    await page.getByRole('heading', { name: 'What was this about?' }).waitFor({ timeout: 5_000 })
    await page.getByLabel('What was this about?').fill('Plus Person')
    await page.getByLabel('What was this about?').press('Enter') // answers-44a: the sheet's Done keeps moving while it rises
    ok('typing a person\'s name switches it to "who" by itself', (await page.locator('.about-row.who .about-value').innerText()) === 'Plus Person')
    ok('the explanation lines sit behind "Advanced"', !(await page.getByText('Just you, to debrief').isVisible()) && await page.getByRole('button', { name: /Advanced/ }).isVisible())
    await page.getByRole('button', { name: /Advanced/ }).click()
    await page.getByLabel('Add: opportunity').fill('Hiring a designer in Graz')
    await page.getByLabel('Add: opportunity').press('Enter')
    ok('Advanced: an opportunity is noted by hand', /Hiring a designer in Graz/.test(await page.locator('.adv').innerText()))
    await page.locator('[data-record-send]').click()
    await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
    ok('it reaches Review as an opportunity line', (await page.locator('.line-text').evaluateAll((els) => els.map((e) => e.value))).includes('Hiring a designer in Graz'))
    await page.getByRole('button', { name: 'Back' }).click().catch(() => {})
    page.once('dialog', (d) => void d.accept())
    await page.locator('[data-record-discard]').click()

    // Inventory: the Settings gear sits where it sits on Web (header-layout, item 23: the top right is the same everywhere); "Review requests"
    // is the inbox at the top left (answers-44a: it left the "Ask your web" slot; data attributes, no fixed pixels).
    await page.locator('nav.tabs [data-go="web"]').click()
    const gearOnWeb = await page.locator('.hdr [data-settings-gear]').boundingBox()
    await page.locator('nav.tabs [data-go="inventory"]').click()
    const gear = await page.locator('.hdr [data-settings-gear]').boundingBox()
    ok('Inventory: the Settings gear sits top right, where it sits on Web', Math.abs(gear.x - gearOnWeb.x) < 1 && Math.abs(gear.y - gearOnWeb.y) < 1, JSON.stringify([gearOnWeb, gear]))
    const req = page.locator('.hdr [data-open-requests]')
    const rb = await req.boundingBox()
    const hb = await page.locator('.hdr').boundingBox()
    ok('Inventory: "Review requests" sits at the top left of the header', rb !== null && rb.x + rb.width / 2 < hb.x + hb.width / 2 && rb.y < hb.y + hb.height, JSON.stringify([rb, hb]))
    await req.click()
    ok('it opens the asks people sent you', await page.getByRole('heading', { name: 'Requests to Resources' }).isVisible())
    await closeSheet()

    // "what": the notes go to the inventory, with who may ask about each line
    await page.locator('nav.tabs [data-go="inventory"]').click()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('button', { name: 'Just me', exact: true }).click()
    await page.locator('.about-kind.what').click()
    await page.getByLabel('What was this about?').fill('Cargo bike')
    await page.getByLabel('What was this about?').press('Enter')
    ok('a new topic stays "what" (blue)', (await page.locator('.about-row.what .about-value').innerText()) === 'Cargo bike')
    const adv = page.getByRole('button', { name: /Advanced/ })
    if ((await adv.getAttribute('aria-expanded')) !== 'true') await adv.click()
    await page.getByLabel('Add: resource').fill('can lend it on weekends')
    await page.getByLabel('Add: resource').press('Enter')
    await page.locator('[data-record-send]').click()
    await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
    await page.locator('.cta .btn').click()
    await page.getByRole('button', { name: 'Save to Resources' }).click()
    await page.waitForTimeout(400)
    ok('"what" notes land in the inventory', /Cargo bike: can lend it on weekends/.test(await page.locator('.screen').innerText()))

  } finally {
    await ctx.close()
  }
}

/** The touch phone (360x780) and the wide page around the phone frame (1280x900). */
async function touchAndDesk(browser, base) {
  const ok = okAt
    // touch phone: the small "i" hints
    const touch = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true })
    await hideOverlays(touch)
    const tp = await touch.newPage()
    await tp.goto(base)
    await tp.waitForLoadState('networkidle').catch(() => {}); await tp.waitForTimeout(1500)
    await tp.getByLabel('Your first name').fill('Touch')
    await tp.getByRole('button', { name: 'Start on this phone' }).click()
    await tp.getByRole('button', { name: 'No thanks' }).click()
    // answers-44a: Record comes with the Note taker variation; Settings folds open, Escape closes the sheet (it covers the veil at 360).
    const tpSettings = async () => {
      await tp.locator('.hdr [data-settings-gear]').click(); await tp.locator('.sheet.on').waitFor(); await tp.waitForTimeout(400)
      await tp.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
    }
    const tpClose = async () => { await tp.keyboard.press('Escape'); await tp.locator('.sheet.on').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {}); await tp.waitForTimeout(300) }
    await tpSettings()
    await tp.locator('.sheet.on .radio', { hasText: 'Note taker' }).first().click(); await tp.waitForTimeout(300)
    await tpClose()
    await tp.locator('nav.tabs .tab-record').click()
    const HINTS = ['About Meeting button', 'About QR code button', 'About Who', 'About What', 'About Advanced on Record']
    const shown = async () => { const out = []; for (const n of HINTS) if (await tp.getByRole('button', { name: n, exact: true }).count()) out.push(n); return out }
    const meetHint = tp.getByRole('button', { name: 'About Meeting button' })
    ok('touch: Meeting, QR, who, what and Advanced carry an "i"', await meetHint.isVisible() && (await shown()).length === 5, JSON.stringify(await shown()))
    await meetHint.click()
    const again = tp.getByLabel('Show this hint again')
    ok('touch: the "i" explains, with "Show this hint again" ticked', /two people|agreed/.test(await tp.locator('.demo-friends').innerText()) && await again.isChecked())
    await again.uncheck()
    await tp.getByRole('button', { name: 'OK', exact: true }).click()
    ok('touch: unticked, that "i" is gone, the other four stay', await tp.getByRole('button', { name: 'About Meeting button' }).count() === 0 && (await shown()).length === 4, JSON.stringify(await shown()))
    await tp.locator('nav.tabs [data-go="web"]').click()
    await tpSettings()
    await tp.getByRole('button', { name: 'Show all hints again' }).click()
    await tpClose()
    await tp.locator('nav.tabs .tab-record').click()
    ok('touch: Settings > Tutorial brings every hint back', await tp.getByRole('button', { name: 'About Meeting button' }).isVisible())
    await touch.close()

    // desktop: outside the phone, "Add a device" and "See TrustWeb in action" (an overlay)
    const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await hideOverlays(deskCtx)
    const desk = await deskCtx.newPage()
    desk.on('pageerror', (e) => console.log('  [pageerror desktop]', e.message))
    // The phone frame is the subject here: Settings > "TrustWeb mobile" (layout_pick.ts LAYOUT_KEY; a wide tab is full width by default).
    await desk.addInitScript(() => localStorage.setItem('trustweb.ui.layout', 'mobile'))
    await desk.goto(base)
    await desk.waitForLoadState('networkidle').catch(() => {}); await desk.waitForTimeout(1500)
    const see = desk.getByRole('button', { name: 'See TrustWeb in action' })
    ok('desktop: "Add a device" and "See TrustWeb in action" sit outside the phone', await see.isVisible() && (await desk.locator('.page-dock .add-device').innerText()).includes('Add a device'))
    await desk.getByLabel('Your first name').fill('Desk')
    await desk.getByRole('button', { name: 'Start on this phone' }).click()
    const toggle = desk.locator('.demo-toggle')
    await toggle.waitFor({ timeout: 5_000 })
    const tb = await toggle.boundingBox()
    ok('desktop: demo content button bottom left, no popup', tb.x < 100 && tb.y > 700 && await desk.locator('.demo-friends').isHidden())
    await toggle.click()
    ok('desktop: it adds the demo content', await desk.locator('.node:not(.you)').count() > 0 && (await toggle.innerText()) === 'Hide demo content')
    await see.click()
    await desk.locator('.wt-modal .wt-banner').waitFor({ timeout: 10_000 })
    ok('desktop: it opens the walkthrough as an overlay', /This happened now/i.test(await desk.locator('.wt-modal').innerText()))
    await desk.keyboard.press('Escape')
    ok('desktop: Escape closes it', await desk.locator('.wt-modal').count() === 0)
    const phone = await browser.newPage({ viewport: { width: 360, height: 780 } })
    await phone.goto(base)
    ok('phone: no page dock, the app is the whole screen', !(await phone.locator('.page-dock').isVisible()) && (await phone.locator('.phone').boundingBox()).width === 360)
}

main().catch((e) => { console.error(e); process.exit(1) })
