/** Wave 7 event-polish proof (headless, dev only): PORT=5314 node event_polish.mjs (a stock dev server). EXE=<chromium headless shell> if the default is not installed. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5314}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring, events = ['e1']) => ({ id, name, context: '', ring, metAt: 1, lines: [], events })
const EV = { id: 'e1', name: 'Forum Südtirol', from: '2026-10-12', where: 'Innsbruck', createdAt: 1, attended: true }
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate(([ev, ppl]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [], log: [], events: [ev] })), [EV, [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'none'), P('c1', 'Clara Moser', 'none', [])]])
  await page.reload(); await page.addStyleTag({ content: '.twf { display: none !important }' })
  await page.locator('.events-btn').click(); await page.waitForTimeout(300)
  await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
  await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)

  const size = (sel) => page.locator(sel).first().evaluate((n) => ({ px: parseFloat(getComputedStyle(n).fontSize), color: getComputedStyle(n).color, y: n.getBoundingClientRect().top }))
  const name = await page.locator('[data-attendee="b1"] b').evaluate((n) => ({ px: parseFloat(getComputedStyle(n).fontSize), bottom: n.getBoundingClientRect().bottom }))
  const hint = await size('[data-attendee="b1"] [data-not-in-web]')
  check('attendee hint sits on row two at <= 85% of the name size', hint.y >= name.bottom - 1 && hint.px <= name.px * 0.85)
  const grey = await page.locator('.events-page .meta').first().evaluate((n) => getComputedStyle(n).color)
  check('hint sentences use the muted grey', grey !== 'rgb(0, 0, 0)' && (await page.locator('.events-page .meta').count()) >= 1)
  await page.locator('[data-event-tag-search]').fill('Clara'); await page.waitForTimeout(200)
  await page.locator('[data-event-tag-search]').fill('Ben'); await page.waitForTimeout(100)
  await page.locator('[data-event-tag-search]').fill('')
  check('picker candidate: hint below the name', await page.locator('[data-tag-person="c1"] [data-not-in-web]').evaluate((n) => n.getBoundingClientRect().top > n.parentElement.getBoundingClientRect().top + 8))

  check('no preview before a copy', (await page.locator('[data-event-link-preview]').count()) === 0)
  await page.locator('[data-event-share]').click(); await page.waitForTimeout(200)
  const pv = page.locator('[data-event-link-preview]')
  check('preview shows the shortened link, read-only', (await pv.inputValue()).includes('…') && (await pv.getAttribute('readonly')) !== null)
  await pv.focus()
  const peer = await pv.inputValue()
  check('tap shows the whole peer link (#ev=) and selects it', peer.includes('/#ev=') && (await page.evaluate(() => { const i = document.activeElement; return i.selectionEnd - i.selectionStart === i.value.length })))
  await page.locator('[data-event-host-toggle]').click(); await page.waitForTimeout(200)
  await pv.focus()
  const host = await pv.inputValue()
  check('host link uses #ev_host=', host.includes('/#ev_host=') && !host.includes('/#ev='))

  // paste row: a link of another event opens the join sheet
  const payload = JSON.parse(Buffer.from(host.split('#ev_host=')[1], 'base64url').toString())
  const other = `https://app.trustweb.one/#ev_host=${Buffer.from(JSON.stringify({ ...payload, id: 'e9', name: 'Sommerfest Graz' })).toString('base64url')}`
  await page.locator('button.back').first().click(); await page.waitForTimeout(200)
  await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
  await page.locator('[data-event-paste]').fill('nonsense'); await page.locator('[data-event-paste]').press('Enter')
  check('garbage in the paste row is refused', await page.locator('[data-event-paste-error]').isVisible())
  await page.locator('[data-event-paste]').fill(other); await page.locator('[data-event-paste]').press('Enter'); await page.waitForTimeout(400)
  check('pasted host link opens the join sheet, host line shown', (await page.locator('[data-event-join]').count()) === 1 && (await page.locator('[data-event-hosted]').count()) === 1)
  await page.locator('[data-event-notme]').click(); await page.waitForTimeout(300)

  // right click -> Curator person page
  await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
  // the Curator page lives in a shadow root: its text is read from there
  const sheetOn = () => page.evaluate(() => { const c = document.querySelector('.sheet.on .curator-person'); return c ? (c.shadowRoot ?? c).textContent : '' })
  await page.locator('[data-attendee="a1"]').click({ button: 'right' }); await page.waitForTimeout(500)
  check('right click on an attendee row opens the Curator person page', (await sheetOn()).includes('Anna Huber'))
  await page.locator('[data-sheet-home]').click().catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(300)
  await page.locator('[data-tag-person="c1"]').click({ button: 'right' }); await page.waitForTimeout(500)
  check('right click on a picker candidate opens it too', (await sheetOn()).includes('Clara Moser'))
  await page.locator('[data-sheet-home]').click().catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(300)
  check('left tap on the row still means the same (Curator page, unchanged)', await page.locator('[data-attendee="a1"] .who').count() === 1)
  // Web view dot: right click opens the Curator page, left tap the person sheet
  await page.locator('button.back').first().click(); await page.locator('button.back').first().click().catch(() => {}); await page.waitForTimeout(300)
  await page.locator('.rings-wrap [data-pid="a1"]').click({ button: 'right' }); await page.waitForTimeout(600)
  check('right click on a Web-view dot opens the Curator person page', (await sheetOn()).includes('Anna Huber'))
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/event_polish_5314.png' })
  check('no page errors', errors.length === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
