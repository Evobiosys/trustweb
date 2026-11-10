// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 small-ui-b live proof (headless, synthetic record): AI sparkle far right on every view, select tool beneath Settings,
 * Your AI (Claude + indented Custom, test), view picker, Theme looks, ring-card ticks, own-data dock, export-mail paste, browser-only notice, favicon.
 *   PORT=5472 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node test/e2e/small_ui_b.mjs
 */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5472}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  ->  ' + detail}`); if (!cond) failed = true }
const mk = (id, ring, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - 86_400_000, fields: {}, ...o })
const record = (extra = {}, n = 5) => JSON.stringify({
  v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [],
  people: [...Array.from({ length: n }, (_, i) => mk(`f${i}`, 'friend', { angle: 20 + i * 40 })), ...Array.from({ length: 3 }, (_, i) => mk(`a${i}`, 'acquaintance', { angle: 215 + i * 30 }))],
  ...extra,
})
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
async function open(browser, name, w, rec) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 780 : 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('dialog', (d) => void d.accept())
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate(([r]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, [rec])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
  return { ctx, page, errors }
}
/** Wave 40: the sparkle opens the assistant; with no AI set up its "Choose your AI plan" leads to Settings > Your AI (the old direct path). */
async function aiOpen(page) {
  await page.locator('[data-ai-button]').click(); await page.waitForTimeout(300)
  if (await page.locator('[data-assistant-plans]').isVisible()) { await page.locator('[data-assistant-plans]').click(); return }
  // an AI is set up (the pc24 preset above): the sparkle is the chat now, Settings is the gear
  await page.locator('[data-assistant-close]').click(); await page.locator('[data-settings-gear]').first().click()
}
const shot = (page, n, w) => page.screenshot({ path: `${SHOTS}/small-ui-b-${n}-${w}.png` })
const hdrOrder = (page) => page.locator('.hdr .hdr-right > *').evaluateAll((bs) => bs.map((b) => (b.querySelector('[data-ai-button]') || b.hasAttribute('data-ai-button') ? 'ai' : b.hasAttribute('data-settings-gear') ? 'gear' : b.classList.contains('select-tool') ? 'select' : b.className.split(' ')[1] || b.tagName)))

try {
  for (const w of [360, 1280]) {
    const { ctx, page, errors } = await open(browser, `w${w}`, w, record())

    // 1 + 9: AI sparkle last on every view; select tool a pin; favicon
    const order = await hdrOrder(page)
    check(`${w}: Web header ends gear, AI (${order.join(',')})`, order.at(-1) === 'ai' && order.at(-2) === 'gear')
    check(`${w}: select tool sits in the header, not in the Tools column`, order.includes('select') && (await page.locator('[data-zone-side] .select-tool').count()) === 0)
    check(`${w}: AI icon is a sparkle (two paths, filled)`, (await page.locator('[data-ai-button] svg path').count()) === 2)
    check(`${w}: favicon is the TrustWeb mark`, (await page.locator('link[rel=icon]').getAttribute('href')).includes('r=%2215%22'))
    await shot(page, 'header', w)
    for (const s of ['chat', 'people', 'events', 'inventory']) {
      await page.locator(`.tabs [data-go="${s}"]`).click().catch(() => {}); await page.waitForTimeout(500)
      const o = await hdrOrder(page)
      check(`${w}: ${s}: AI last`, o.at(-1) === 'ai', o.join(','))
    }
    await page.locator('.tabs [data-go="web"]').click(); await page.waitForTimeout(400)
    await aiOpen(page); await page.waitForTimeout(500)
    check(`${w}: no endpoint -> Your AI plan cards`, await page.locator('[data-ai-group="sub"]').isVisible())

    // 2: Your AI
    const ai = await page.locator('[data-ai]').innerText()
    check(`${w}: no OpenAI anywhere in Your AI`, !/openai/i.test(ai))
    check(`${w}: Claude plan cards`, (await page.locator('[data-ai-plan]').count()) === 3 && /claude/i.test(ai))
    await page.locator('[data-ai-group="byok"] > summary').click(); await page.waitForTimeout(200)
    const ids = await page.locator('[data-ai-preset]').evaluateAll((b) => b.map((x) => x.dataset.aiPreset))
    check(`${w}: Custom presets ollama, pc24, other`, ids.join() === 'ollama,pc24,other', ids.join())
    const indent = await page.locator('[data-ai-group="byok"]').evaluate((d) => parseFloat(getComputedStyle(d).marginLeft))
    check(`${w}: Custom is indented (${indent}px)`, indent >= 8)
    await page.locator('[data-ai-preset="pc24"]').click(); await page.waitForTimeout(200)
    check(`${w}: pc24 preset fills name, address, model`, (await page.locator('[data-ai-field="name"]').inputValue()) === 'pc24' && (await page.locator('[data-ai-field="baseUrl"]').inputValue()).includes('11435') && (await page.locator('[data-ai-field="model"]').inputValue()) === 'qwen3.6:35b')
    await page.route('**/localhost:11435/v1/chat/completions', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: 'Sure, I can help with padel.' } }] }) }))
    await page.locator('[data-ai-test]').click(); await page.waitForTimeout(800)
    const lines = await page.locator('[data-ai-test-line]').allInnerTexts()
    check(`${w}: Test with a plain-text answer says ✓, not "failed: not json" (${lines.join(' | ')})`, /^✓/.test(lines[0] ?? '') && !/Failed/i.test(lines.join()))
    await page.locator('[data-ai-group="byok"]').scrollIntoViewIfNeeded(); await shot(page, 'your-ai', w)
    check(`${w}: no horizontal scroll in Your AI`, await noOverflow(page))

    // 3 + 8: view picker and Theme
    await page.locator('[data-view-pill]').scrollIntoViewIfNeeded(); await page.locator('[data-view-pill]').click(); await page.waitForTimeout(200)
    const views = await page.locator('.view-menu [data-view]').evaluateAll((b) => b.map((x) => x.dataset.view))
    check(`${w}: view picker offers only Dex and TrustWeb (${views})`, views.join() === 'dex,trustweb')
    await shot(page, 'view-picker', w)
    await page.locator('[data-view-pill]').click()
    const looks = await page.locator('[data-look-choice]').evaluateAll((b) => b.map((x) => x.dataset.lookChoice))
    check(`${w}: Theme offers default, sleek, dex`, looks.join() === 'default,sleek,dex')
    await page.locator('[data-theme-row]').scrollIntoViewIfNeeded(); await shot(page, 'theme-default', w)
    await page.locator('[data-look-choice="sleek"]').click(); await page.waitForTimeout(300)
    const sleek = await page.evaluate(() => ({ look: document.documentElement.dataset.look, fs: getComputedStyle(document.body).fontSize, stored: localStorage.getItem('tw-look') }))
    check(`${w}: Sleek applies (13px, stored) ${JSON.stringify(sleek)}`, sleek.look === 'sleek' && sleek.fs === '13px' && sleek.stored === 'sleek')
    await shot(page, 'theme-sleek-settings', w)
    check(`${w}: no horizontal scroll in Sleek settings`, await noOverflow(page))
    await page.locator('[data-look-choice="dex"]').click(); await page.waitForTimeout(300)
    check(`${w}: Dex-like applies`, (await page.evaluate(() => document.documentElement.dataset.look)) === 'dex')
    await shot(page, 'theme-dex-settings', w)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await shot(page, 'theme-dex-web', w)
    await page.evaluate(() => { document.documentElement.dataset.look = 'sleek' }); await page.waitForTimeout(200)
    await shot(page, 'theme-sleek-web', w)
    await aiOpen(page); await page.waitForTimeout(400)
    await page.locator('[data-look-choice="default"]').evaluate((e) => e.click()); await page.waitForTimeout(300)
    check(`${w}: Default clears the look`, (await page.evaluate(() => document.documentElement.dataset.look)) === undefined && (await page.evaluate(() => localStorage.getItem('tw-look'))) === null)
    check(`${w}: no page errors (${errors.join(' | ')})`, errors.length === 0)
    await ctx.close()
  }

  // 3b: ring card ticks (desktop; the card opens on the diamond)
  {
    const { ctx, page, errors } = await open(browser, 'ticks', 1280, record())
    await page.locator('.rings-wrap [data-hide-ring="friend"]').hover(); await page.waitForTimeout(500)
    check('ring card shows a tick beside every name', (await page.locator('[data-ring-card-pick]').count()) === 5)
    await page.locator('[data-ring-card-pick="f0"]').check(); await page.locator('[data-ring-card-pick="f1"]').check(); await page.waitForTimeout(250)
    check('two ticked: bar says Archive 2 and the dots are marked', (await page.locator('[data-ring-card-archive-many]').innerText()) === 'Archive 2' && (await page.locator('.node.multi-sel').count()) === 2)
    await page.screenshot({ path: `${SHOTS}/small-ui-b-ring-card-1280.png` })
    await page.locator('[data-ring-card-archive-many]').click(); await page.waitForTimeout(500)
    const arch = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.filter((p) => p.ring === 'none').map((p) => p.id))
    check(`Archive 2 archives both in one go (${arch})`, arch.includes('f0') && arch.includes('f1'))
    check('ring card: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  {
    const { ctx, page } = await open(browser, 'ticks360', 360, record())
    await page.locator('.rings-wrap [data-hide-ring="friend"]').click().catch(() => {}); await page.waitForTimeout(500)
    if ((await page.locator('[data-ring-card-pick]').count()) > 0) { await page.locator('[data-ring-card-pick]').first().check(); await page.screenshot({ path: `${SHOTS}/small-ui-b-ring-card-360.png` }) }
    await ctx.close()
  }

  // 5: own data leaves the main flow
  for (const w of [1280]) {
    const stock = await open(browser, 'stock', w, record({}, 3))
    check('stock record: the dock is in the main flow (not hidden)', (await stock.page.locator('.page-dock').evaluate((d) => !d.hidden)))
    await shot(stock.page, 'dock-before', w); await stock.ctx.close()
    const big = await open(browser, 'big', w, record({}, 80))
    check('own data (80 people): the dock is hidden from the main flow', (await big.page.locator('.page-dock').evaluate((d) => d.hidden)))
    await aiOpen(big.page); await big.page.waitForTimeout(400)
    await big.page.locator('[data-settings-group="general"] > summary, [data-settings-group="advanced"] > summary').first().click().catch(() => {})
    await big.page.evaluate(() => { for (const d of document.querySelectorAll('.sheet details')) d.open = true }); await big.page.waitForTimeout(300)
    check('own data: Settings > Advanced holds Add a device and See TrustWeb in action', (await big.page.locator('[data-add-device]').count()) === 1 && (await big.page.locator('[data-see-action]').count()) === 1)
    await big.ctx.close()
  }

  // 4 + 6: export-mail watcher under Services, only after an export was asked; paste a mail
  for (const w of [360, 1280]) {
    const none = await open(browser, 'sov0', w, record())
    await aiOpen(none.page); await none.page.evaluate(() => { for (const d of document.querySelectorAll('.sheet details')) d.open = true })
    await none.page.locator('[data-settings-sovereign]').click(); await none.page.waitForTimeout(500)
    check(`${w}: nothing asked yet -> no watcher`, (await none.page.locator('[data-sov-section="watch"]').count()) === 0)
    await none.ctx.close()
    const asked = await open(browser, 'sov1', w, record({ sovereign: { services: { google: { exportAt: Date.now() } } } }))
    await aiOpen(asked.page); await asked.page.evaluate(() => { for (const d of document.querySelectorAll('.sheet details')) d.open = true })
    await asked.page.locator('[data-settings-sovereign]').click(); await asked.page.waitForTimeout(500)
    check(`${w}: export asked -> watcher appears under Services`, (await asked.page.locator('[data-sov-section="services"] [data-sov-section="watch"]').count()) === 1)
    check(`${w}: heading carries "untested alpha feature"`, /untested alpha feature/.test(await asked.page.locator('[data-sov-section="watch"] > summary').innerText()))
    await asked.page.locator('[data-sov-section="watch"]').evaluate((d) => { d.open = true }); await asked.page.waitForTimeout(150)
    await asked.page.locator('[data-sov-mail-connect]').click(); await asked.page.waitForTimeout(200)
    await asked.page.locator('[data-sov-mail-connect]').scrollIntoViewIfNeeded(); await shot(asked.page, 'mail-connect', w)
    await asked.page.locator('[data-sov-paste]').fill('From: Google <noreply@accounts.google.com>\nSubject: Your Google data export is ready\n\nsecret body\nhttps://takeout.google.com/manage/archive/abc')
    await asked.page.locator('[data-sov-paste-go]').click(); await asked.page.waitForTimeout(400)
    check(`${w}: pasted mail moves Google to "link arrived"`, /link arrived/.test(await asked.page.locator('[data-sov-watch-state="google"]').innerText()))
    check(`${w}: no horizontal scroll on the page`, await noOverflow(asked.page))
    await shot(asked.page, 'mail-linked', w)
    await asked.ctx.close()
  }

  // 7: browser-only notice at 360
  for (const w of [360, 1280]) {
    const { ctx, page } = await open(browser, 'bo', w, record())
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange'))
    }); await page.waitForTimeout(700)
    const n = page.locator('[data-browser-only-notice]')
    check(`${w}: notice shown`, (await n.count()) === 1)
    const m = await n.evaluate((e) => { const t = e.querySelector('.browser-only-text').getBoundingClientRect(); const b = e.querySelector('button').getBoundingClientRect(); const r = e.getBoundingClientRect(); return { sw: e.scrollWidth, cw: e.clientWidth, tBottom: t.bottom, bTop: b.top, bLeft: b.left, tLeft: t.left, right: r.right, vw: window.innerWidth } })
    check(`${w}: no overflow, inside the screen (${JSON.stringify(m)})`, m.sw <= m.cw && m.right <= m.vw)
    if (w === 360) check('360: the Got it button sits below the text', m.bTop >= m.tBottom - 1)
    const hit = await page.evaluate(() => { const a = document.querySelector('[data-browser-only-notice]').getBoundingClientRect(); const f = document.querySelector('.query-fab')?.getBoundingClientRect(); return f ? !(f.right <= a.left || f.left >= a.right || f.bottom <= a.top || f.top >= a.bottom) : false })
    check(`${w}: the Ask button does not cover the notice`, !hit)
    await shot(page, 'browser-only', w)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
