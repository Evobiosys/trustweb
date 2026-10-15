/** Wave 8 non-responsive proof (headless, dev only): PORT=5228 SHOT=file.png node field_non_responsive.mjs. EXE=<chromium headless shell> if the default is not installed. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5228}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await page.goto(URL)
  await page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [], log: [] })), [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'friend')])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  await page.addStyleTag({ content: '.demo-friends { position: fixed !important; top: auto !important; bottom: 0 !important; left: 0; right: 0; z-index: 99 }' })
  const dot = (id) => page.locator(`.rings-wrap [data-pid="${id}"]`)
  await dot('a1').click()
  await page.locator('[data-action="toggle-fields"]').click()
  await page.locator('[data-action="toggle-advanced"]').click()
  const box = page.locator('label', { hasText: 'non-responsive' }).locator('input[type="checkbox"]')
  await box.waitFor()
  check('person page shows the non-responsive checkbox, off', !(await box.isChecked()))
  await box.check(); await page.waitForTimeout(400)
  check('hint "no answer" under the name', (await page.locator('[data-part="nonresp"]').count()) > 0)
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  check('record carries the flag on Anna only', String(rec.people.find((p) => p.id === 'a1').fields?.['tw-non-responsive']) === 'true' && !rec.people.find((p) => p.id === 'b1').fields)
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('.sheet.on .x, .sheet.on [data-close]')?.click())
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  check('Anna dot greyed, Ben not (after reload)', (await dot('a1').getAttribute('class')).includes('nonresp') && !(await dot('b1').getAttribute('class')).includes('nonresp'))
  check('Anna dot opacity .55', (await dot('a1').evaluate((n) => getComputedStyle(n).opacity)) === '0.55')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
} catch (e) { console.log('ERROR', e.message); failed = true }
await browser.close()
process.exit(failed ? 1 : 0)
