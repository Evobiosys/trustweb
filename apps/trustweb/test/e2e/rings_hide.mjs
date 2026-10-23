/** Per-ring hide toggles (grey ♦ column straight up from "you") (headless, dev only): PORT=5196 [SHOTS=/dir] EXE=<chromium headless shell> node rings_hide.mjs */
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
    [P('c1', 'Clara Close', 'close'), P('f1', 'Finn Friend', 'friend'), P('a1', 'Anna Acq', 'acquaintance'), P('i1', 'Ivo Intending', 'intending'), P('u1', 'Uma Unsorted', 'unsorted')])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  const settle = async () => { await page.waitForTimeout(800); if (await page.locator('[data-sheet-home]').count()) { await page.locator('[data-sheet-home]').click(); await page.waitForTimeout(500) } }
  await settle()
  await page.addStyleTag({ content: '.demo-friends, .twf, .twf-ok { display: none !important }' })
  const dots = () => page.locator('.rings-wrap .node:not(.you)').count()
  const guide = (r) => page.locator(`.rings-wrap circle[data-ring="${r}"]`).evaluate((c) => c.style.opacity)
  check('rings are the default view', await page.locator('.rings-wrap[data-view="rings"]').count() === 1)
  check('one ⊖ per ring (five), no chip row', await page.locator('.ring-toggle').count() === 5 && await page.locator('.rings-hide').count() === 0 && await dots() === 5 && (await page.locator('[data-hide-ring="friend"]').textContent()) === '−')
  const col = await page.evaluate(() => { const c = (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }; return { you: c(document.querySelector('.rings-wrap .node.you')), ds: [...document.querySelectorAll('.ring-toggle')].map(c) } })
  check('diamonds stand in one vertical column above "you"', col.ds.every(([x]) => Math.abs(x - col.you[0]) < 1.5) && col.ds.every(([, y]) => y < col.you[1]))
  check('no two diamonds overlap (>= 16 px apart)', col.ds.every((a, i) => col.ds.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) >= 16)))
  check('diamond is 12 px across, glyph 9 px', await page.locator('[data-hide-ring="friend"]').evaluate((b) => { const w = parseFloat(getComputedStyle(b, '::before').width); return Math.abs(w * Math.SQRT2 - 12) < 0.2 && getComputedStyle(b).fontSize === '9px' }))
  check('diamond is grey, rotated 45deg', await page.locator('[data-hide-ring="friend"]').evaluate((b) => { const s = getComputedStyle(b, '::before'); return s.transform !== 'none' && s.backgroundColor === 'rgb(138, 143, 148)' }))
  await shot(page, '1-all-shown')
  await page.locator('[data-hide-ring="friend"]').click()
  check('hiding friend removes its people only', await dots() === 4 && await page.locator('[data-pid="f1"]').count() === 0)
  check('hidden ring shows ⊕, guide drawn dimmed', (await page.locator('[data-hide-ring="friend"].off').textContent()) === '+' && await guide('friend') === '0.25')
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
  check('showing again restores the people', await dots() === 5)
  await page.locator('[data-hide-ring="intending"]').click()
  check('hiding Intending removes only its people; the others and self stay', await dots() === 4 && await page.locator('[data-pid="i1"]').count() === 0 && await page.locator('[data-pid="c1"], [data-pid="f1"], [data-pid="a1"], [data-pid="u1"]').count() === 4 && await page.locator('.rings-wrap .node.you').count() === 1 && await page.locator('.rings-wrap svg circle').count() >= 4)
  await shot(page, '4-intending-hidden')
  await page.locator('[data-hide-ring="unsorted"]').click()
  check('hiding Unsorted too keeps the three rings\' people and self', await dots() === 3 && await page.locator('.rings-wrap .node.you').count() === 1)
  await page.locator('[data-hide-ring="intending"]').click(); await page.locator('[data-hide-ring="unsorted"]').click()
  check('all back', await dots() === 5)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
