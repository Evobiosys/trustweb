/** Per-ring hide chips (headless, dev only): PORT=5196 [SHOTS=/dir] EXE=<chromium headless shell> node rings_hide.mjs */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5196}/`
const shot = (page, n) => process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${n}.png` }) : null
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ppl) => { localStorage.removeItem('trustweb.ui.ringsHidden'); localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })) },
    [P('c1', 'Clara Close', 'close'), P('f1', 'Finn Friend', 'friend'), P('a1', 'Anna Acq', 'acquaintance')])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  const settle = async () => { await page.waitForTimeout(800); if (await page.locator('[data-sheet-home]').count()) { await page.locator('[data-sheet-home]').click(); await page.waitForTimeout(500) } }
  await settle()
  await page.addStyleTag({ content: '.demo-friends, .twf, .twf-ok { display: none !important }' })
  const dots = () => page.locator('.rings-wrap .node:not(.you)').count()
  const guide = (r) => page.locator(`.rings-wrap circle[data-ring="${r}"]`).evaluate((c) => c.style.opacity)
  check('rings are the default view', await page.locator('.rings-wrap[data-view="rings"]').count() === 1)
  check('one chip per ring (four, Intending included)', await page.locator('.rchip-hide').count() === 4 && await dots() === 3)
  await shot(page, '1-all-shown')
  await page.locator('[data-hide-ring="friend"]').click()
  check('hiding friend removes its people only', await dots() === 2 && await page.locator('[data-pid="f1"]').count() === 0)
  check('hidden chip is struck through, guide drawn dimmed', await page.locator('[data-hide-ring="friend"].off').count() === 1 && await guide('friend') === '0.25')
  await shot(page, '2-friend-hidden')
  const c = await page.locator('[data-pid="c1"]').boundingBox()
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.down()
  check('guide shows in full while a person is held', await guide('friend') === '')
  await page.mouse.move(c.x + c.width / 2 + 30, c.y + c.height / 2 + 30, { steps: 5 })
  await shot(page, '3-mid-drag')
  await page.keyboard.press('Escape')
  await page.mouse.up(); await page.waitForTimeout(400)
  check('hidden setting persists across reload', (await page.reload(), await page.locator('.rings-wrap').waitFor(), await settle(), await page.locator('[data-hide-ring="friend"].off').count() === 1))
  await page.locator('[data-hide-ring="friend"]').click()
  check('showing again restores the people', await dots() === 3)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
