// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave44c home-default (headless, stock dev server, synthetic records): PORT=5472 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<index.mjs> node home_default.mjs
 *  A. first screen = Home for a record without a pin, and for a migrated v3 record; the rings thumbnail sits in the Web tile.
 *  B. a request row opens its ask card / connect card on the Web; the Web tile opens the rings.
 *  C. the Existing requests tile: left column bottom, no overlap, See all lists the groups, a row there opens the card.
 *  D. Settings > Home switch off = rings first after a reload.
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5472}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const record = (extra = {}) => ({
  v: 1, me: { id: 'me1', displayName: 'Tester Person' }, peers: [], log: [], inventory: [], missedPopupOff: true, demoOffered: true,
  people: [{ id: 'p1', name: 'Ana Muster', ring: 'close', lines: [], context: '', peerId: 'x1' }, { id: 'p2', name: 'Ben Beispiel', ring: 'friend', lines: [], context: '' }],
  awayAsks: [{ id: 'q1', at: Date.now(), peerId: 'x1', from: 'Ana Muster', text: 'Does anyone own a ladder?' }],
  wantsToConnect: [{ peerId: 'z9', name: 'Cy Neu', at: Date.now() }],
  sentAsks: [{ id: 's1', text: 'Who can lend a drill?', at: Date.now(), to: [] }],
  invitesSent: 2,
  ...extra,
})
const overlap = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
async function open(w, h, rec) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: false })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { console.log('pageerror', String(e)); failed = true })
  await page.goto(URL); await page.waitForTimeout(1000)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), rec)
  await page.reload()
  await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' })
  await page.waitForTimeout(1000)
  const notNow = page.locator('.sheet.on .btn-ghost').first()
  if (await notNow.count()) { await notNow.click(); await page.waitForTimeout(300) }
  return { ctx, page }
}
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    // ---- A. first screen
    for (const [label, rec] of [['fresh record', record()], ['migrated v3 record', record({ schemaVersion: 3 })]]) {
      const { ctx, page } = await open(w, h, rec)
      check(`${w}: A. ${label}: first screen is Home`, (await page.locator('[data-home-board]').count()) === 1 && (await page.locator('.rings-zoom').count()) === 0)
      check(`${w}: A. ${label}: rings thumbnail in the Web tile`, (await page.locator('[data-home-tile="web"] [data-home-thumb]').count()) === 1)
      if (label === 'fresh record') await page.screenshot({ path: `${SHOTS}/home-default-first-${w}.png` })
      await ctx.close()
    }

    // ---- B. request rows open cards on the Web
    {
      const { ctx, page } = await open(w, h, record())
      await page.locator('[data-home-tile="asksToMe"] [data-home-request="q1"]').click(); await page.waitForTimeout(600)
      check(`${w}: B. an ask row opens the Web with its card`, (await page.locator('[data-home-board]').count()) === 0 && (await page.locator('[data-card-stack]:not([hidden])').count()) === 1, await page.locator('body').innerText().then((t) => t.slice(0, 80)))
      check(`${w}: B. the ask card names the ask`, (await page.locator('[data-card-stack]').innerText()).includes('ladder'))
      await page.screenshot({ path: `${SHOTS}/home-default-ask-card-${w}.png` })
      await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(500)
      check(`${w}: B. the Web tab leads back to Home`, (await page.locator('[data-home-board]').count()) === 1)
      await page.locator('[data-home-tile="connects"] [data-home-request="z9"]').click(); await page.waitForTimeout(600)
      check(`${w}: B. a connect row opens the connect card on the Web`, (await page.locator('[data-want="z9"]').count()) === 1 && (await page.locator('[data-want="z9"]').isVisible()))
      await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(500)
      await page.locator('[data-home-web]').click(); await page.waitForTimeout(500)
      check(`${w}: B. the Web tile opens the rings`, (await page.locator('.rings-zoom').count()) === 1)
      await ctx.close()
    }

    // ---- C. Existing requests tile
    {
      const { ctx, page } = await open(w, h, record())
      const inCol = async (col) => page.locator(`[data-home-col="${col}"] [data-home-tile]`).evaluateAll((n) => n.map((x) => x.getAttribute('data-home-tile')))
      check(`${w}: C. Existing requests at the bottom of the left column`, JSON.stringify(await inCol('left')) === '["asksToMe","connects","requests"]')
      const boxes = await page.locator('[data-home-tile]').evaluateAll((n) => n.map((x) => { const b = x.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }))
      let clash = false
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) clash = true
      check(`${w}: C. no tile overlaps another`, !clash)
      check(`${w}: C. the tile counts all open requests`, (await page.locator('[data-home-tile="requests"]').innerText()).includes('5 open'))
      await page.locator('[data-home-requests-all]').scrollIntoViewIfNeeded()
      await page.locator('[data-home-requests-all]').click(); await page.waitForTimeout(500)
      const list = await page.locator('[data-requests-list]').innerText()
      check(`${w}: C. See all lists mine, others and invitations`, list.includes('ladder') && list.includes('Cy Neu') && list.includes('drill') && list.includes('2 invitations'))
      const lb = await page.locator('[data-requests-list]').boundingBox()
      check(`${w}: C. the list fits the viewport`, lb.x >= 0 && lb.x + lb.width <= w + 1)
      await page.screenshot({ path: `${SHOTS}/home-default-requests-${w}.png` })
      await page.locator('[data-requests-list] [data-request="q1"]').click(); await page.waitForTimeout(600)
      check(`${w}: C. a row in the list opens that card`, (await page.locator('[data-card-stack]:not([hidden])').count()) === 1)
      await ctx.close()
    }

    // ---- D. Settings > Home off = rings first
    {
      const { ctx, page } = await open(w, h, record())
      await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.uiViews = { webDefault: 'rings' }; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
      await page.reload(); await page.waitForTimeout(1000)
      check(`${w}: D. with the rings chosen the first screen is the rings`, (await page.locator('.rings-zoom').count()) === 1 && (await page.locator('[data-home-board]').count()) === 0)
      await ctx.close()
    }
  }
} catch (e) { console.log('FAIL exception', String(e).slice(0, 400)); failed = true }
await browser.close()
process.exit(failed ? 1 : 0)
