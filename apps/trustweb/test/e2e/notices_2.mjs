// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b notices-2 proof (headless): PORT=5481 [PORT_PERSONAL=5482] EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node notices_2.mjs. Synthetic records.
 *  PORT = stock dev server (TW_STOCK=1); PORT_PERSONAL = a personal-mode server (shows the Approve box) for the box check. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const HOST = (port) => `http://127.0.0.1:${port}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const mk = (id, o = {}) => ({ id, name: `Gee ${id}`, ring: 'acquaintance', angle: 30 * Number(id.slice(1)), lines: [], context: '', metAt: Date.now() - 86_400_000, fields: {}, ...o })
const seed = (extra = {}, people = []) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, demoOffered: true, peers: [], log: [], inventory: [], people: [...Array.from({ length: 6 }, (_, i) => mk(`g${i}`)), ...people], ...extra })
const open = async (ctxOpts, record, port = process.env.PORT ?? 5481) => {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(HOST(port)); await page.waitForTimeout(1500)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
  await page.reload(); await page.waitForTimeout(1000)
  return { ctx, page, errors }
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const contrast = (page, sel, bgSel) => page.evaluate(([s, b]) => {
  const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number)
  const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl) }
  const fg = rgb(getComputedStyle(document.querySelector(s)).color), bg = rgb(getComputedStyle(document.querySelector(b)).backgroundColor)
  const [a, c] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (c + 0.05)
}, [sel, bgSel])
try {
  for (const [name, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const inView = (b) => b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height
    // 1: top notice
    for (const how of ['x', 'text']) {
      const { ctx, page, errors } = await open({ viewport: vp }, seed({}, [mk('f0', { ring: 'friend', peerId: 'pp1' })]))
      const n = page.locator('.demo-friends')
      check(`${name}: passing-asks notice shows`, (await n.isVisible()) && (await n.innerText()).includes('Passing asks on'))
      check(`${name}: notice box sits inside the viewport`, inView(await n.boundingBox()))
      check(`${name}: notice above the Tools panel (z-index)`, await n.evaluate((e) => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.demo-friends') === e }))
      if (how === 'x') await page.screenshot({ path: `${SHOTS}/notices-2-${name}-notice.png` })
      if (how === 'x') await page.locator('[data-notice-close]').click(); else await n.locator('b').click()
      await page.waitForTimeout(700)
      check(`${name}: ${how === 'x' ? '×' : 'a tap on the text'} closes it`, !(await n.isVisible()))
      check(`${name}: no page errors (${errors.join(' | ')})`, errors.length === 0)
      await ctx.close()
    }
    // 3+4: delete from the person page: no question, tombstone, toast with the 30-day wording
    {
      const { ctx, page, errors } = await open({ viewport: vp }, seed({}, [mk('f0', { ring: 'friend', name: 'Fay Zero' })]))
      await page.locator('.rings-wrap [data-pid="f0"]').click(); await page.waitForTimeout(400)
      await page.locator('[data-card-open]').first().click(); await page.waitForTimeout(400)
      await page.locator('[data-card-curate]').first().click(); await page.waitForTimeout(400)
      await page.locator('[data-delete-person="f0"]').click(); await page.waitForTimeout(500)
      check(`${name}: page delete asks nothing`, (await page.locator('[data-delete-yes]').count()) === 0)
      const toast = page.locator('.demo-friends')
      check(`${name}: toast text "Fay Zero deleted (you can restore it within 30 days)" + Undo`, (await toast.innerText()).includes('Fay Zero deleted (you can restore it within 30 days)') && (await page.locator('[data-undo-delete]').count()) === 1)
      const rec = (await stored(page)).people.find((p) => p.id === 'f0')
      check(`${name}: person kept with deleted_at`, Boolean(rec?.deleted_at) && rec.prevRing === 'friend')
      check(`${name}: toast inside the viewport`, inView(await toast.boundingBox()))
      await page.screenshot({ path: `${SHOTS}/notices-2-${name}-delete-toast.png` })
      await page.locator('[data-undo-delete]').click(); await page.waitForTimeout(400)
      check(`${name}: Undo clears deleted_at`, (await stored(page)).people.find((p) => p.id === 'f0').deleted_at === undefined)
      await page.locator('[data-settings-gear]').first().click().catch(() => {})
      check(`${name}: no page errors (${errors.join(' | ')})`, errors.length === 0)
      await ctx.close()
    }
    // 2: countdown number in the turquoise token, light + dark
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await open({ viewport: vp, colorScheme: scheme }, seed({}, [mk('pa', { ring: 'friend', angle: 20 }), mk('pb', { ring: 'friend', angle: 200 })]))
      await page.evaluate((c) => { document.documentElement.dataset.theme = c }, scheme)
      const centre = async (id) => { const b = await page.locator(`.node[data-pid="${id}"]`).last().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
      const a = await centre('pa'); const b = await centre('pb')
      await page.mouse.move(a.x, a.y); await page.mouse.down()
      await page.mouse.move(a.x + 12, a.y + 12, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 8 })
      await page.waitForSelector('[data-merge-countdown]', { timeout: 3000 })
      const same = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--teal)'; document.body.append(p); const want = getComputedStyle(p).color; p.remove(); return getComputedStyle(document.querySelector('[data-merge-countdown]')).color === want })
      check(`${name} ${scheme}: merge number uses the turquoise token`, same)
      check(`${name} ${scheme}: contrast >= 3 (large bold text) (${(await contrast(page, '[data-merge-countdown]', '.demo-friends')).toFixed(1)})`, (await contrast(page, '[data-merge-countdown]', '.demo-friends')) >= 3)
      if (scheme === 'light') await page.screenshot({ path: `${SHOTS}/notices-2-${name}-countdown.png` })
      await page.mouse.up(); await ctx.close()
    }
    // 6: AI test result block
    for (const [label, status, body, want] of [['not JSON', 200, { choices: [{ message: { content: 'Hello there, I am a chat model' } }] }, ['Failed', 'not JSON', 'Hello there', 'check the model name']], ['401', 401, { error: { message: 'Incorrect API key' } }, ['Failed', 'Incorrect API key', 'Key rejected']], ['ok', 200, { choices: [{ message: { content: '{"a":1}' } }] }, ['Answered in']]]) {
      const { ctx, page, errors } = await open({ viewport: vp }, seed({ advanced: { ai: { preset: 'custom', baseUrl: 'http://mock.test/v1', apiKey: '', model: 'm' } } }))
      await page.route('http://mock.test/**', (r) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }))
      await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500)
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
      await page.locator('[data-ai-test]').scrollIntoViewIfNeeded()
      await page.locator('[data-ai-test]').click(); await page.waitForTimeout(800)
      const lines = await page.locator('[data-ai-test-result] p').allInnerTexts()
      check(`${name}: AI test (${label}): ${lines.length} lines, each wanted part present (${lines.join(' | ')})`, (label === 'ok' ? lines.length >= 2 : lines.length >= 3) && want.every((w) => lines.join('\n').includes(w)))
      check(`${name}: AI test (${label}): no horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      if (label === 'not JSON') await page.screenshot({ path: `${SHOTS}/notices-2-${name}-ai-test.png` })
      check(`${name}: no page errors (${errors.join(' | ')})`, errors.length === 0)
      await ctx.close()
    }
    // 5: Approve box vs a compact preview panel (personal-mode server; the panel itself needs the preview registry, so its class is set by hand)
    if (process.env.PORT_PERSONAL) {
      const { ctx, page } = await open({ viewport: vp }, seed(), process.env.PORT_PERSONAL)
      check(`${name}: Approve box shows with the panel expanded`, await page.locator('.twf-ok').isVisible())
      await page.evaluate(() => document.documentElement.classList.add('twp-compact')); await page.waitForTimeout(200)
      check(`${name}: Approve box hidden while the panel is compact`, !(await page.locator('.twf-ok').isVisible()))
      await page.screenshot({ path: `${SHOTS}/notices-2-${name}-no-approve-box.png` })
      await ctx.close()
    }
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
