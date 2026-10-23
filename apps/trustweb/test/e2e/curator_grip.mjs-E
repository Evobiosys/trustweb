/** Wave 9 curator-grip proof (headless, dev only): PORT=5252 node curator_grip.mjs (a stock dev server). EXE=<chromium headless shell> if the default is not installed. Drags the person-row grip inside the phone sheet's Curator (shadow root). */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5252}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
const REC = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], people: [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'friend'), P('c1', 'Clara Moser', 'friend')] }
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC)
  await page.reload(); await page.addStyleTag({ content: '.twf { display: none !important }' })
  await page.locator('.search-btn').click(); await page.waitForTimeout(1500)
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/curator-grip.png' })
  const rows = () => page.locator('.sheet.on .curator [data-slot]').evaluateAll((n) => n.map((x) => x.dataset.slot))
  const grip = page.locator('.sheet.on .curator [data-slot="a1"] .grip')
  const target = page.locator('.sheet.on .curator [data-slot="c1"]')
  const g = await grip.boundingBox(), t = await target.boundingBox()
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.waitForTimeout(500)
  await page.mouse.move(t.x + 40, t.y + t.height - 4, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300)
  const after = await rows()
  check('person grip reorders inside the sheet', after.indexOf('a1') > after.indexOf('c1'))
  await page.reload(); await page.locator('.search-btn').click(); await page.waitForTimeout(1500)
  check('order persists after reload', (await rows()).indexOf('a1') > (await rows()).indexOf('c1'))
  // entity fields grip (person page > Fields): drag the second field above the first
  await page.locator('.sheet.on .curator [data-slot="a1"]').click(); await page.waitForTimeout(800)
  await page.locator('.sheet.on .curator >> text=/Fields \\(/').click(); await page.waitForTimeout(600)
  const fields = () => page.locator('.sheet.on .curator [data-zone="simple"] [data-slot]').evaluateAll((n) => n.map((x) => x.dataset.slot))
  const [f0, f1] = await fields()
  const fg = await page.locator(`.sheet.on .curator [data-slot="${f1}"] .grip`).boundingBox()
  const last = await page.locator(`.sheet.on .curator [data-slot="${f0}"]`).boundingBox()
  await page.mouse.move(fg.x + fg.width / 2, fg.y + fg.height / 2); await page.mouse.down(); await page.waitForTimeout(500)
  await page.mouse.move(last.x + 40, last.y + 4, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300)
  const fa = await fields()
  check('field grip reorders inside the sheet', fa[0] === f1 && fa[1] === f0)
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/curator-grip.png' })
  check('no page errors', errors.length === 0)
} catch (e) { console.log('ERROR', e); failed = true } finally { await browser.close() }
process.exit(failed ? 1 : 0)
