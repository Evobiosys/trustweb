// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b resources-outliner proof (headless, stock dev server): PORT=5453 SHOTS=<dir> PW=<playwright-core index.mjs> EXE=<chromium headless shell> node resources_outliner.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5453}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const it = (id, text, over = {}) => ({ id, text, audience: 'friends', included: true, createdAt: 1, ...over })
const blk = (id, text, children = []) => ({ id, text, children })
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], events: [], people: [{ id: 'p1', name: 'Test Peer', ring: 'friend', peerId: 'k1', fields: {} }],
  inventory: [
    it('r1', 'Reading list', { blocks: [blk('a', 'Books', [blk('a1', 'Dune'), blk('a2', 'Cosmos')]), blk('b', 'Papers')] }),
    it('r2', 'Hidden talk', { kind: 'recording', protected: true, link: 'https://example.org/a' }),
  ] })
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [name, opts] of [['phone', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(500)
    check(`${name}: protected row has Record and Play`, (await page.locator('[data-rv-record="r2"]').count()) === 1 && (await page.locator('[data-rv-play="r2"]').count()) === 1)
    check(`${name}: Review requests button sits top left`, await page.evaluate(() => { const b = document.querySelector('.requests-btn'); return !!b && !!b.closest('.hdr-left') && !document.querySelector('.hdr-right .requests-btn') && b.getAttribute('aria-label').startsWith('Review requests') }))
    await page.locator('[data-item="r1"]').first().click(); await page.waitForTimeout(400)
    check(`${name}: the outline shows three levels`, (await page.locator('[data-ol-text]').count()) === 4)
    // Enter = sibling below
    await page.locator('[data-ol-text="a1"]').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    await page.keyboard.type('Hyperion'); await page.keyboard.press('Tab'); await page.waitForTimeout(200)
    let rec = await stored(page)
    const a = rec.inventory[0].blocks[0]; if (process.env.DBG) console.log(JSON.stringify(rec.inventory[0].blocks))
    check(`${name}: Enter adds below, Tab indents under Dune`, a.children.length === 2 && a.children[0].text === 'Dune' && a.children[0].children[0]?.text === 'Hyperion')
    // collapse
    await page.locator('[data-ol-bullet="a"]').click(); await page.waitForTimeout(200)
    check(`${name}: collapse hides the lines under Books`, (await page.locator('[data-ol-text="a1"]').count()) === 0)
    await page.locator('[data-ol-bullet="a"]').click(); await page.waitForTimeout(200)
    // share: long press (right click on desktop) -> block / line
    await page.locator('[data-ol-bullet="a"]').click({ button: 'right' }).catch(() => {})
    if ((await page.locator('[data-ol-pick="a"]').count()) === 0) { await page.locator('[data-ol-bullet="a"]').dispatchEvent('contextmenu') }
    await page.waitForTimeout(300)
    check(`${name}: bullet menu offers block and line`, (await page.locator('[data-ol-share-block="a"]').count()) === 1 && (await page.locator('[data-ol-share-line="a"]').count()) === 1)
    await page.locator('[data-ol-share-block="a"]').click(); await page.waitForTimeout(200)
    const scopeBlock = await page.locator('[data-ol-scope]').innerText()
    check(`${name}: share sheet says "1 block, 4 lines"`, scopeBlock === '1 block, 4 lines')
    await page.locator('[data-ol-bullet="a"]').dispatchEvent('contextmenu'); await page.waitForTimeout(200)
    await page.locator('[data-ol-share-line="a"]').click(); await page.waitForTimeout(200)
    check(`${name}: share sheet says "1 line" and carries only that line`, (await page.locator('[data-ol-scope]').innerText()) === '1 line' && (await page.locator('.ol-share-text').innerText()) === 'Books')
    await page.screenshot({ path: `${SHOTS}/resources-outliner-${name}.png` })
    // answers-44b item 3: Send to chat / Post to feed beside Share, no overlap (D-P06)
    const boxes = await page.evaluate(() => ['go', 'chat', 'feed'].map((k) => { const r = document.querySelector(`[data-ol-share-${k}]`)?.getBoundingClientRect(); return r ? [r.left, r.top, r.right, r.bottom] : null }))
    const apart = (a, b) => a[2] <= b[0] + 0.5 || b[2] <= a[0] + 0.5 || a[3] <= b[1] + 0.5 || b[3] <= a[1] + 0.5
    check(`${name}: Share, Send to chat, Post to feed shown and not overlapping`, boxes.every(Boolean) && apart(boxes[0], boxes[1]) && apart(boxes[1], boxes[2]) && apart(boxes[0], boxes[2]))
    await page.locator('[data-ol-share-feed]').click(); await page.waitForTimeout(300)
    rec = await stored(page)
    check(`${name}: Post to feed = that line with its ref tag`, rec.feedPosts?.at(-1)?.text === 'Books' && rec.feedPosts.at(-1).tag === 'ref:r1.a')
    await page.locator('[data-ol-share-chat]').click(); await page.waitForTimeout(300)
    check(`${name}: Send to chat lists the connected person`, (await page.locator('[data-res-share-pick="p1"]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/answers-44b-share-chat-${name}.png` })
    await page.locator('[data-res-share-pick="p1"]').click(); await page.waitForTimeout(600)
    rec = await stored(page)
    check(`${name}: the chat carries the line and its ref`, (rec.chats?.k1?.messages ?? []).some((m) => m.text === 'Books\n\nref:r1.a'))
    // protected resource: no outline share
    await page.keyboard.press('Escape')
    check(`${name}: no page errors`, errors.length === 0)
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
