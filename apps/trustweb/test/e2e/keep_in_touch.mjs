// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 keep-in-touch proof (headless): PORT=5490 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node keep_in_touch.mjs. Synthetic records, fake clock (13:00 local). */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5490}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const DAY = 86_400_000
const NOW = new Date(2026, 10, 7, 13, 0).getTime()
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const mk = (id, name, ring, ago, o = {}) => ({ id, name, ring, lines: [], context: '', metAt: NOW - ago * DAY, fields: {}, ...o })
const people = [
  mk('a', 'Anna', 'closest', 40, { cadenceDays: 14 }),
  mk('b', 'Ben', 'close', 20, { cadenceDays: 7 }),
  mk('c', 'Carl', 'friend', 200),
  mk('d', 'Dora', 'acquaintance', 300, { cadenceDays: 30 }),
  mk('e', 'Emil', 'friend', 100, { cadenceDays: 30 }),
  mk('f', 'Fay', 'friend', 3),
]
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [name, vp] of [['1280', { width: 1280, height: 900 }], ['360', { width: 360, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport: vp })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.clock.install({ time: NOW })
    await page.goto(URL); await page.waitForTimeout(1200)
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1500)

    // notice: 4 overdue (Anna, Ben, Dora, Emil), once a day
    await page.locator('[data-go="events"]').click(); await page.waitForTimeout(600) // reminders wait in the Events panel
    const txt = await page.locator('body').innerText()
    check(`${name}: grouped notice names 3 and counts the rest`, txt.includes('Time to get in touch: ') && /and 1 more/.test(txt))
    await page.screenshot({ path: `${SHOTS}/keep-in-touch-${name}-notice.png` })
    check(`${name}: notice day stamped`, (await stored(page)).keepNoticeDay === '2026-11-07')

    // tap opens the complete view filtered to Overdue
    const open = page.locator('[data-reminder-open]')
    if (await open.count()) { await open.first().click(); await page.waitForTimeout(500) }
    check(`${name}: tap opens the complete view`, (await page.locator('[data-complete]').count()) === 1)
    check(`${name}: filtered to Overdue (4 rows)`, (await page.locator('[data-cv-row]').count()) === 4 && (await page.locator('[data-cv-overdue]').getAttribute('aria-pressed')) === 'true')

    // Gone quiet chip: Closest/Close/Friend, > 2x cadence or > 90 days: Anna(40>28), Ben(20>14), Carl(200), Emil(100>60)... Dora is acquaintance, Fay recent
    await page.locator('[data-cv-overdue]').click(); await page.locator('[data-cv-quiet]').click(); await page.waitForTimeout(300)
    const q = await page.locator('[data-cv-row]').evaluateAll((rs) => rs.map((r) => r.dataset.cvRow).sort())
    check(`${name}: Gone quiet = a,b,c,e (${q})`, q.join() === 'a,b,c,e')
    await page.screenshot({ path: `${SHOTS}/keep-in-touch-${name}-gone-quiet.png` })
    await page.locator('[data-cv-quiet]').click()

    // person card: row, set cadence, I was in touch today + Undo
    await page.locator('[data-cv-open="f"]').click(); await page.waitForTimeout(600)
    await page.locator('[data-card-open="f"]').click(); await page.waitForTimeout(400) // the Keep in touch row sits in the opened card
    check(`${name}: card has the Keep in touch row`, (await page.locator('[data-keep-row="f"]').count()) === 1)
    await page.locator('[data-keep-cadence="f"]').selectOption('30'); await page.waitForTimeout(300)
    check(`${name}: cadence stored`, (await stored(page)).people.find((p) => p.id === 'f').cadenceDays === 30)
    check(`${name}: next date shown`, (await page.locator('[data-keep-next]').count()) === 1)
    await page.locator('[data-keep-row="f"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/keep-in-touch-${name}-card-row.png` })
    await page.locator('[data-keep-today="f"]').click(); await page.waitForTimeout(300)
    check(`${name}: engagementKept set`, (await stored(page)).people.find((p) => p.id === 'f').engagementKept >= NOW)
    await page.screenshot({ path: `${SHOTS}/keep-in-touch-${name}-in-touch-toast.png` })
    await page.locator('.toast').click(); await page.waitForTimeout(300)
    check(`${name}: Undo clears it`, (await stored(page)).people.find((p) => p.id === 'f').engagementKept === undefined)
    check(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: no page errors (${errors.join('|')})`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
