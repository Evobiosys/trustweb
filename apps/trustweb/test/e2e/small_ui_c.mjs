// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 small-ui-c proof (headless, synthetic record): PORT=5483 EXE=<chromium headless shell> PW=<playwright-core index.js> SHOTS=<dir> node small_ui_c.mjs
 *  (a) select tool in the Tools row, not the header; (b) even bottom row raises the two inner buttons; (c) Docs & chat module. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5483}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring) => ({ id, name, ring, lines: [], context: '', metAt: Date.now() })
const people = [person('p1', 'Ben Gruber', 'close'), person('p2', 'Cleo Maier', 'friend'), person('p3', 'Dan Huber', 'acquaintance')]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }, { id: 'garden', colour: '#33456B', label: 'Garden', community: true }]
const record = (extra = {}) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events: [], ...extra })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const raised = (page) => page.locator('.tabs .tab-primary, .tabs .tab-record').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-go') ?? b.className))

async function open(vp, extra) {
  const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
  const outside = []
  await page.route(/^https:\/\/(t\.me|docs\.google\.com)\//, (r) => { outside.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' }) })
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [record(extra), JSON.stringify(tags)])
  await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
  return { ctx, page, errors, outside }
}

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const shot = (page, n) => page.screenshot({ path: `${SHOTS}/small-ui-c-${w}-${n}.png` })
    // (a) + (b) default record: five buttons = one raised, select tool in Tools
    {
      const { ctx, page, errors } = await open({ width: w, height: h })
      const hdr = await page.locator('.hdr .hdr-right > *').evaluateAll((bs) => bs.map((b) => b.classList.contains('select-tool')))
      check(`${w}: select tool not in the header`, !hdr.includes(true))
      if (!(await page.locator('.zone-tools .select-tool').count())) { await page.locator('[data-zone-side-toggle]').first().click(); await page.waitForTimeout(500) }
      check(`${w}: select tool is one of the Tools buttons (beside expand and add)`, (await page.locator('[data-zone-side] .zone-tools .select-tool, .sheet .zone-tools .select-tool').count()) === 1 || (await page.locator('.zone-tools .select-tool').count()) === 1)
      await shot(page, '1-tools'); 
      check(`${w}: five bottom buttons: exactly one raised`, (await raised(page)).length === 1)
      check(`${w}: no sideways scroll`, await noHScroll(page))
      check(`${w}: no page errors`, errors.length === 0)
      await ctx.close()
    }
    // (b) four buttons: the two inner ones raised
    {
      const { ctx, page, errors } = await open({ width: w, height: h }, { uiBar: { order: ['web', 'chat', 'record', 'events'], hidden: [], orderVersion: 2 } })
      const r = await raised(page)
      check(`${w}: four bottom buttons: the two inner ones are raised (${r.join(',')})`, r.length === 2)
      const boxes = await page.locator('.tabs .tab-primary, .tabs .tab-record').evaluateAll((bs) => bs.map((b) => { const q = b.getBoundingClientRect(); return [q.left, q.right] }))
      check(`${w}: the raised pair does not overlap`, boxes.length === 2 && boxes[0][1] <= boxes[1][0] + 1)
      check(`${w}: raised pair inside the screen`, boxes.every(([l, rr]) => l >= 0 && rr <= w))
      await shot(page, '2-pair')
      check(`${w}: no sideways scroll (pair)`, await noHScroll(page)); check(`${w}: no page errors (pair)`, errors.length === 0)
      await ctx.close()
    }
    // (b) six buttons (phone shows them all): pair
    {
      const { ctx, page } = await open({ width: w, height: h }, { uiBar: { order: ['web', 'chat', 'record', 'events', 'inventory', 'people'], hidden: [], orderVersion: 2 } })
      const r = await raised(page)
      check(`${w}: six bottom buttons: two raised (${r.join(',')})`, r.length === 2)
      check(`${w}: six buttons: no sideways scroll`, await noHScroll(page))
      await shot(page, '3-pair-six')
      await ctx.close()
    }
    // (c) Docs & chat
    {
      const { ctx, page, errors, outside } = await open({ width: w, height: h })
      await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
      await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
      const ext = page.locator('[data-settings-section="extensions"]')
      await ext.locator('summary').first().scrollIntoViewIfNeeded(); await ext.locator('summary').first().click(); await page.waitForTimeout(300)
      check(`${w}: Docs & chat switch exists and says it loads only when on`, /loads only when on/.test(await page.locator('[data-ext-module="embeds"]').innerText()))
      check(`${w}: off: no embeds chunk loaded`, !(await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /embeds_body|embeds_view/.test(e.name)))))
      await page.locator('[data-ext-module="embeds"]').click(); await page.waitForTimeout(1200)
      await page.keyboard.press('Escape'); await page.waitForTimeout(500)
      const tab = page.locator('button.tab[data-go="mod:docs-chat"]')
      // review wave 40: with Timeline and Events map on too, a full phone row puts it behind ⋮; pressing it there moves it into the row (small-ui-d)
      if (!(await tab.count())) { await page.locator('[data-bar-more]').click(); await page.waitForTimeout(300); await page.locator('.sheet.on [data-bar-view="mod:docs-chat"]').click(); await page.waitForTimeout(800) }
      check(`${w}: Docs & chat joined the bottom row`, (await tab.count()) === 1)
      await tab.click(); await page.waitForTimeout(800)
      check(`${w}: shadow root + alpha subscript`, await page.evaluate(() => { const s = document.querySelector('[data-embeds]')?.shadowRoot; return !!s && s.querySelector('[data-embeds-alpha]')?.textContent === 'untested alpha feature' }))
      const q = (sel) => page.locator(`[data-embeds] >> ${sel}`)
      // refused link
      await q('[data-embeds-docs-url]').fill('https://evil.org/x'); await q('[data-embeds-docs-save]').click(); await page.waitForTimeout(300)
      check(`${w}: a non-Google link is refused with a note`, (await q('[data-embeds-docs-frame]').count()) === 0 && (await q('[data-embeds-note]').isVisible()))
      await q('[data-embeds-docs-url]').fill('https://docs.google.com/document/d/abc123/edit?usp=sharing'); await q('[data-embeds-docs-save]').click(); await page.waitForTimeout(300)
      check(`${w}: an /edit link is accepted; nothing loads before the consent tap`, (await q('[data-embeds-docs-load]').count()) === 1 && (await q('[data-embeds-docs-frame]').count()) === 0 && outside.length === 0)
      check(`${w}: clickables underlined`, (await q('[data-embeds-docs-load]').evaluate((b) => getComputedStyle(b).textDecorationLine.includes('underline'))))
      await q('[data-embeds-docs-load]').click(); await page.waitForTimeout(600)
      check(`${w}: consent tap loads the preview page of the document`, (await q('[data-embeds-docs-frame]').getAttribute('src')) === 'https://docs.google.com/document/d/abc123/preview')
      // telegram
      await q('[data-embeds-chat-url]').fill('https://evil.org/t.me/x'); await q('[data-embeds-chat-save]').click(); await page.waitForTimeout(300)
      check(`${w}: a non-Telegram link is refused`, (await q('[data-embeds-chat-open]').count()) === 0)
      await q('[data-embeds-chat-url]').fill('t.me/example_group'); await q('[data-embeds-chat-save]').click(); await page.waitForTimeout(300)
      check(`${w}: Open Telegram link always there, underlined, https t.me`, (await q('[data-embeds-chat-open]').getAttribute('href')) === 'https://t.me/example_group' && await q('[data-embeds-chat-open]').evaluate((a) => getComputedStyle(a).textDecorationLine.includes('underline')))
      check(`${w}: Telegram not loaded before its consent tap`, (await q('[data-embeds-chat-frame]').count()) === 0)
      if (w === 360) {
        const sheet = q('[data-embeds-sheet]')
        const h0 = (await sheet.boundingBox()).height
        const tabsTop = await page.evaluate(() => document.querySelector('.tabs').getBoundingClientRect().top)
        check(`360: chat is a closed bottom sheet above the bottom row (${Math.round(h0)} px)`, h0 <= 60 && (await sheet.boundingBox()).y + h0 <= tabsTop + 2)
        await shot(page, '4-docs-closed')
        await q('[data-embeds-chat-toggle]').click(); await page.waitForTimeout(400)
        const h1 = (await sheet.boundingBox()).height
        check(`360: the toggle expands the sheet (${Math.round(h1)} px)`, h1 > h0 + 150)
        await q('[data-embeds-chat-load]').click(); await page.waitForTimeout(500)
        check(`360: consent tap loads Telegram in the sheet`, (await q('[data-embeds-chat-frame]').count()) === 1)
        await shot(page, '5-chat-open')
        await q('[data-embeds-chat-toggle]').click(); await page.waitForTimeout(300)
      } else {
        const d = await q('[data-embeds-docs]').boundingBox(); const c = await q('[data-embeds-sheet]').boundingBox()
        check(`1280: docs left, chat right, about half each (${Math.round(d.width)} / ${Math.round(c.width)})`, d.x < c.x && Math.abs(d.width - c.width) < 120 && Math.abs(d.y - c.y) < 40)
        await q('[data-embeds-chat-load]').click(); await page.waitForTimeout(500)
        check(`1280: consent tap loads Telegram beside the docs`, (await q('[data-embeds-chat-frame]').count()) === 1)
        await shot(page, '4-docs-chat')
      }
      // the other community tag keeps its own links
      await q('[data-embeds-tag]').selectOption('garden'); await page.waitForTimeout(400)
      check(`${w}: links are kept per community tag (the other tag is empty)`, (await q('[data-embeds-docs-url]').count()) === 1 && (await q('[data-embeds-chat-url]').count()) === 1)
      await q('[data-embeds-tag]').selectOption('iyg'); await page.waitForTimeout(400)
      check(`${w}: back on the first tag the links are there`, (await q('[data-embeds-docs-frame]').count()) === 1)
      check(`${w}: no sideways scroll`, await noHScroll(page))
      check(`${w}: only docs.google.com and t.me were requested`, outside.every((u) => /^https:\/\/(docs\.google\.com|t\.me)\//.test(u)))
      check(`${w}: no page errors`, errors.length === 0)
      // switch off removes the button
      await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
      await page.evaluate(() => { document.querySelectorAll('[data-settings-group="general"], [data-settings-section="extensions"]').forEach((d) => { d.open = true }) }); await page.waitForTimeout(300)
      await page.locator('[data-ext-module="embeds"]').scrollIntoViewIfNeeded(); await page.locator('[data-ext-module="embeds"]').click(); await page.waitForTimeout(800)
      await page.keyboard.press('Escape'); await page.waitForTimeout(400)
      check(`${w}: switched off: button gone`, (await page.locator('button.tab[data-go="mod:docs-chat"]').count()) === 0)
      await ctx.close()
    }
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
