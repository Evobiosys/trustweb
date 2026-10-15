/** Wave 7 ring-fixes proof (headless, dev only): PORT=5312 node ring_fixes.mjs (a stock dev server). EXE=<chromium headless shell> if the default is not installed. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5312}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false })).newPage()
  const wrap = () => page.locator('.rings-wrap')
  const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })), [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'acquaintance')])
  await page.reload(); await wrap().waitFor()
  await page.addStyleTag({ content: '.demo-friends { position: fixed !important; top: auto !important; bottom: 0 !important; left: 0; right: 0; z-index: 99 }' })
  await wrap().scrollIntoViewIfNeeded()
  const box = await wrap().boundingBox()
  const k = box.width / 352
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const rad = (r) => page.evaluate((x) => +document.querySelector(`.rings-wrap circle[data-ring="${x}"]`).getAttribute('r'), r)
  const from = await page.locator('.rings-wrap [data-pid="a1"]').boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  const to = { x: c.x, y: c.y - (await rad('intending')) * k }
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up(); await page.waitForTimeout(300)
  await page.locator('.desire .rchip', { hasText: /^7$/ }).click()
  await page.locator('.desire-go .btn:not(.btn-ghost)').click(); await page.waitForTimeout(800)
  check('Move here: no "Add someone" sheet', (await page.locator('[data-add-person]').count()) === 0)
  const a = (await record()).people.find((p) => p.id === 'a1')
  check('Anna is on the intending ring with the chosen value', a.ring === 'intending' && a.intending?.value === 7)

  await page.locator('.rings-wrap [data-pid="b1"]').click(); await page.waitForTimeout(500)
  check('acquaintance card shows "Add a note" and five lean chips', (await page.locator('[data-lean-add-note]').count()) === 1 && (await page.locator('[data-lean-step]').count()) === 5)
  await page.locator('[data-lean-step="-1"]').click(); await page.waitForTimeout(200)
  check('lean -1 stored, ring unchanged', await record().then((r) => { const b = r.people.find((p) => p.id === 'b1'); return b.lean === -1 && b.ring === 'acquaintance' }))
  await page.locator('[data-lean-step="0"]').click(); await page.waitForTimeout(200)
  check('centre clears the lean', await record().then((r) => r.people.find((p) => p.id === 'b1').lean === undefined))
  await page.locator('[data-lean-add-note]').click()
  await page.locator('[data-lean-note]').fill('Met at the choir; warm, not close yet.'); await page.locator('[data-lean-note]').blur(); await page.waitForTimeout(300)
  check('note saved on the person', await record().then((r) => r.people.find((p) => p.id === 'b1').generalNote === 'Met at the choir; warm, not close yet.'))
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
