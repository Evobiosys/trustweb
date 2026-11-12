// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 small-ui-e live proof (headless, synthetic record): the Web zoom-out floor and the AI sheet / AI section.
 *   PORT=5497 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node test/e2e/small_ui_e.mjs
 */
const pw = await import(process.env.PW ?? 'playwright-core')
const { chromium } = pw.default ?? pw
const URL = `http://127.0.0.1:${process.env.PORT ?? 5497}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  ->  ' + detail}`); if (!cond) failed = true }
const mk = (id, ring, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - 86_400_000, fields: {}, ...o })
const record = (extra = {}) => JSON.stringify({
  v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [],
  people: [...Array.from({ length: 5 }, (_, i) => mk(`f${i}`, 'friend', { angle: 20 + i * 40 })), ...Array.from({ length: 3 }, (_, i) => mk(`a${i}`, 'acquaintance', { angle: 215 + i * 30 }))],
  ...extra,
})
async function open(w, h, rec = record()) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate(([r]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, [rec])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1200)
  return { ctx, page, errors }
}
const shot = (page, n, w) => page.screenshot({ path: `${SHOTS}/small-ui-e-${w}-${n}.png` })
const kOf = (page) => page.evaluate(() => Number(document.querySelector('.rings-wrap')?.dataset.ringsZoom))
/** ctrl + wheel at the clip centre (the trackpad pinch), deltaY > 0 zooms out. */
const wheel = async (page, deltaY, times = 1) => {
  const box = await page.locator('.scroll').first().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < times; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, deltaY); await page.keyboard.up('Control'); await page.waitForTimeout(25) }
  await page.waitForTimeout(200)
}
const outerRing = (page) => page.evaluate(() => {
  const c = [...document.querySelectorAll('.rings-wrap circle[data-ring]')].at(-1).getBoundingClientRect(), s = document.querySelector('.scroll').getBoundingClientRect()
  return { d: c.width, gapX: Math.min(c.left - s.left, s.right - c.right), gapY: Math.min(c.top - s.top, s.bottom - c.bottom), cx: (c.left + c.right) / 2 - (s.left + s.right) / 2, cy: (c.top + c.bottom) / 2 - (s.top + s.bottom) / 2 }
})

try {
  // 1: zoom-out floor
  for (const [w, h] of [[1280, 800], [1600, 1000]]) {
    const { ctx, page, errors } = await open(w, h)
    const fit = await kOf(page)
    check(`${w}: starts at the fitted zoom (> 1)`, fit > 1.2, String(fit))
    await wheel(page, 60, 80)
    const floor = await kOf(page)
    await wheel(page, 60, 20)
    check(`${w}: zooming out stops at a floor (k stays ${floor.toFixed(3)} after 20 more steps)`, (await kOf(page)) === floor && floor > 1.2 && floor <= fit + 1e-9, String(floor))
    const r = await outerRing(page)
    check(`${w}: outer ring fits the clip with a margin (gap x ${r.gapX.toFixed(0)}, y ${r.gapY.toFixed(0)} px) and sits centred (${r.cx.toFixed(1)} / ${r.cy.toFixed(1)} px off)`, r.gapX > 8 && r.gapY > 8 && Math.abs(r.cx) < 2 && Math.abs(r.cy) < 10, JSON.stringify(r))
    await shot(page, 'floor', w)
    await page.evaluate(() => { const c = document.querySelector('.scroll'); for (const t of ['gesturestart', 'gesturechange']) { const e = new Event(t, { cancelable: true }); e.scale = t === 'gesturestart' ? 1 : 0.2; e.clientX = 400; e.clientY = 300; c.dispatchEvent(e) } })
    check(`${w}: Safari pinch-out also stops at the floor`, Math.abs((await kOf(page)) - floor) < 1e-9, String(await kOf(page)))
    await wheel(page, -60, 200)
    check(`${w}: zoom in still stops at 4`, (await kOf(page)) === 4, String(await kOf(page)))
    await shot(page, 'zoomed-in', w)
    await page.mouse.dblclick(w - 120, 300)   // empty corner, no dot
    const back = await kOf(page)
    check(`${w}: double click goes home, not under the floor`, back >= floor - 1e-9 && back < 4, String(back))
    check(`${w}: no page errors (${errors.join(' | ')})`, errors.length === 0)
    await ctx.close()
  }
  {
    const { ctx, page } = await open(360, 780)
    await wheel(page, 60, 40)
    check('360: phone keeps k = 1 (no zoom out)', (await kOf(page)) === 1, String(await kOf(page)))
    await shot(page, 'floor', 360)
    await ctx.close()
  }

  // 2: the AI sparkle and the AI section
  for (const [w, h] of [[360, 780], [1280, 800]]) {
    const { ctx, page, errors } = await open(w, h)
    await page.locator('[data-ai-button]').click(); await page.waitForTimeout(500)
    const sheetText = await page.locator('.sheet').innerText()
    check(`${w}: sparkle opens the Your AI sheet (heading, Claude, plan cards, Custom, Agent)`, /YOUR AI/i.test(sheetText) && /CLAUDE/i.test(sheetText) && (await page.locator('.sheet [data-ai-plan]').count()) === 3 && (await page.locator('.sheet [data-ai-group="byok"]').count()) === 1 && (await page.locator('.sheet [data-agent]').count()) === 1, sheetText.slice(0, 200))
    check(`${w}: the sheet holds nothing but the AI block (no Settings title, no search)`, (await page.locator('.sheet h3').count()) === 0 && (await page.locator('.sheet [data-settings-search]').count()) === 0)
    check(`${w}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await shot(page, 'ai-sheet', w)
    const sheetPlans = await page.locator('.sheet [data-ai-plan]').allInnerTexts()
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    const where = await page.evaluate(() => {
      const g = document.querySelector('.sheet [data-settings-group="ai"]')
      return { exists: !!g, topLevel: !!g && g.parentElement === document.querySelector('.sheet'), insideAdvanced: !!document.querySelector('[data-settings-section="advanced"] [data-ai]'), title: g?.querySelector('summary')?.textContent }
    })
    check(`${w}: Settings has its own top-level section "AI"`, where.exists && where.topLevel && where.title === 'AI', JSON.stringify(where))
    check(`${w}: AI no longer sits inside Advanced`, !where.insideAdvanced)
    await page.evaluate(() => { for (const d of document.querySelectorAll('.sheet details')) d.open = false })
    await page.locator('[data-settings-section="ai"] > summary').click(); await page.waitForTimeout(300)
    const sectionPlans = await page.locator('.sheet [data-settings-section="ai"] [data-ai-plan]').allInnerTexts()
    check(`${w}: the section shows the same plan cards as the sparkle sheet`, sectionPlans.length === 3 && sectionPlans.join('|') === sheetPlans.join('|'))
    check(`${w}: the section carries Custom and Agent (pi) too`, (await page.locator('.sheet [data-settings-section="ai"] [data-ai-group="byok"]').count()) === 1 && (await page.locator('.sheet [data-settings-section="ai"] [data-agent]').count()) === 1)
    await page.locator('[data-settings-section="ai"]').scrollIntoViewIfNeeded(); await shot(page, 'ai-section', w)
    for (const q of ['ai', 'your ai', 'agent', 'plan']) {
      await page.locator('[data-settings-search]').fill(q); await page.waitForTimeout(250)
      check(`${w}: Settings search "${q}" finds the AI section`, await page.locator('.sheet [data-settings-section="ai"]').evaluate((d) => !d.hidden && !d.closest('[hidden]')))
    }
    await page.locator('[data-settings-search]').fill('zzzzqq'); await page.waitForTimeout(250)
    check(`${w}: a miss hides it`, await page.locator('.sheet [data-settings-group="ai"]').evaluate((d) => d.hidden))
    await page.locator('[data-settings-search]').fill('ai'); await page.waitForTimeout(250)
    await shot(page, 'search-ai', w)
    check(`${w}: no page errors (${errors.join(' | ')})`, errors.length === 0)
    await ctx.close()
  }
  {
    // merge with wave 40 ai-edit-chat: an AI set up + the assistant on -> its chat; the assistant off -> the same sheet
    const ai = { advanced: { ai: { preset: 'custom', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm' } } }
    const on = await open(1280, 800, record(ai))
    await on.page.locator('[data-ai-button]').click(); await on.page.waitForTimeout(1200)
    check('with an endpoint and the assistant on the sparkle opens the assistant chat', await on.page.locator('[data-assistant-input]').isVisible())
    await on.ctx.close()
    const { ctx, page } = await open(1280, 800, record({ ...ai, twSettings: { extensions: { assistant: false } } }))
    await page.locator('[data-ai-button]').click(); await page.waitForTimeout(500)
    check('with an endpoint and the assistant off the sparkle opens the same sheet', (await page.locator('.sheet [data-ai-plan]').count()) === 3 && (await page.locator('[data-ask-input]').count()) === 0)
    await ctx.close()
  }
  {
    // rf41-c C1: 1280x720 (clip under 560): no floor, so home k=1 stays reachable and a zoom-out does not zoom in
    const { ctx, page } = await open(1280, 720)
    await wheel(page, 120, 30)
    check('rf41-c C1: 1280x720 zoom-out stays at k=1', (await kOf(page)) === 1, String(await kOf(page)))
    await ctx.close()
  }
  {
    // rf41-c C4: the stored zoom is re-clamped when the window grows (debounced); C8: openSettingsAt leaves Advanced alone
    const { ctx, page } = await open(1280, 800)
    await wheel(page, 120, 30)
    const k0 = await kOf(page)
    await page.setViewportSize({ width: 1600, height: 1000 }); await page.waitForTimeout(600)
    const k1 = await kOf(page)
    check(`rf41-c C4: growing the window raises k to the new floor (${k0} -> ${k1})`, k1 > k0 + 0.1)
    await ctx.close()
  }
  {
    // rf41-c C6: Curate page, assistant off: [data-cur-ai] opens Your AI as a page on top; C11: sign-up Back
    const rows = ['k1', 'k2'].map((key) => ({ key, name: `Row ${key}`, source: 'vcf', file: 's.vcf', n365: 0, out: 0, in: 0, ids: [], sig: key, labels: [], emails: [`${key}@example.org`] }))
    const { ctx, page } = await open(1280, 800, record({ twSettings: { extensions: { assistant: false } }, serviceImports: [{ id: 'b1', at: Date.now(), counts: { vcf: 2 }, rows, done: {} }] }))
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(400)
    if (!(await page.locator('[data-people-import]').first().isVisible())) { await page.locator('summary', { hasText: 'Your web' }).first().click(); await page.waitForTimeout(300) }
    await page.locator('[data-people-import]').first().click(); await page.waitForTimeout(500)
    await page.locator('[data-svc-curate]').first().click(); await page.waitForTimeout(500)
    const adv = page.locator('[data-cur-advanced="k1"] > summary')
    if (await adv.count()) { await adv.scrollIntoViewIfNeeded(); await adv.click(); await page.waitForTimeout(200) }
    await page.locator('[data-cur-ai="k1"]').click(); await page.waitForTimeout(600)
    await page.locator('[data-page="your-ai"] [data-ai-group="sub"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(200)
    const top = await page.evaluate(() => { const g = document.querySelector('[data-page="your-ai"] [data-ai-group="sub"]'); if (!g) return 'none'; const r = g.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2)); return t && g.contains(t) ? 'top' : 'covered' })
    check('rf41-c C6: Curate page, assistant off: Your AI is visible and topmost', top === 'top', top)
    await page.locator('[data-page="your-ai"] [data-ai-signup]').first().click(); await page.waitForTimeout(400)
    check('rf41-c C11: sign-up has a Back that returns to the plan cards', (await page.locator('[data-ai-back]').count()) === 1 && (await page.locator('[data-ai-back]').evaluate((b) => getComputedStyle(b).textDecorationLine.includes('underline'))))
    await page.locator('[data-ai-back]').click(); await page.waitForTimeout(400)
    check('rf41-c C11: Back shows the plan cards again', await page.locator('[data-page="your-ai"] [data-ai-plan]').first().isVisible())
    await ctx.close()
  }
  {
    // rf41-c C8: a jump to Your AI no longer leaves Advanced open
    const { ctx, page } = await open(1280, 800)
    await page.locator('[data-ai-button]').click(); await page.waitForTimeout(300)
    check('rf41-c C8: Advanced flag not written by the AI sheet', (await page.evaluate(() => localStorage.getItem('trustweb.ui.settings.advanced'))) !== '1')
    await ctx.close()
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
