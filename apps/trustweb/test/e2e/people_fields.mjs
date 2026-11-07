// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 people-fields proof (headless): PORT=5412 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node people_fields.mjs. Synthetic record, fake clock (Sat 2026-11-07 13:00). */
const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5412}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const NOW = new Date(2026, 10, 7, 13, 0).getTime()
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const mk = (id, name, o = {}) => ({ id, name, ring: 'friend', lines: [], context: '', metAt: NOW - 90 * 86_400_000, fields: {}, ...o })
const people = [mk('a', 'Anna', { fields: { birthday: '1988-11-07' } }), mk('b', 'Ben', { fields: { birthday: '--11-10' } }), mk('c', 'Carl')]
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const seed = async (page, extra = {}) => {
  const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people, ...extra })
  await page.goto(URL); await page.waitForTimeout(1000)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1500)
}
try {
  for (const [name, vp] of [['1280', { width: 1280, height: 900 }], ['360', { width: 360, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport: vp })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.clock.install({ time: NOW })
    await seed(page)
    const banner = page.locator('[data-birthday-notice]')
    check(`${name}: banner shows today and this week`, (await banner.innerText()).includes('Birthday today: Anna.') && (await banner.innerText()).includes('This week: Ben.'))
    check(`${name}: banner stamped`, (await stored(page)).birthdayNoticeDay === '2026-11-07')
    await page.screenshot({ path: `${SHOTS}/people-fields-${name}-banner.png` })
    // card: Birthday field + thought-of row
    await page.locator('[data-go="web"]').click()
    await page.locator('button[data-view="complete"]').click(); await page.waitForTimeout(400)
    await page.locator('[data-cv-birthdays]').click(); await page.waitForTimeout(300)
    check(`${name}: Birthdays chip keeps Anna and Ben`, (await page.locator('[data-cv-row]').count()) === 2)
    await page.locator('[data-cv-birthdays]').click()
    await page.locator('[data-cv-open="c"]').click(); await page.waitForTimeout(600)
    await page.locator('[data-card-open="c"]').click(); await page.waitForTimeout(400)
    await page.locator('[data-birthday-input="c"]').fill('1990-02-30'); await page.locator('[data-birthday-input="c"]').blur(); await page.waitForTimeout(200)
    check(`${name}: impossible date refused`, (await page.locator('[data-birthday-bad]').isVisible()) && !(await stored(page)).people.find((p) => p.id === 'c').fields.birthday)
    await page.locator('[data-birthday-input="c"]').fill('14.03.1990'); await page.locator('[data-birthday-input="c"]').blur(); await page.waitForTimeout(400)
    check(`${name}: birthday stored as 1990-03-14`, (await stored(page)).people.find((p) => p.id === 'c').fields.birthday === '1990-03-14')
    check(`${name}: thought-of row defaults to passive`, (await page.locator('[data-thought-mode="c"]').inputValue()) === 'passive')
    await page.locator('[data-thought-mode="c"]').selectOption('active'); await page.waitForTimeout(300)
    check(`${name}: share mode stored`, (await stored(page)).people.find((p) => p.id === 'c').thoughtShare === 'active')
    await page.locator('[data-thought-of-share="c"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/people-fields-${name}-card.png` })
    check(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: no page errors (${errors.join('|')})`, errors.length === 0)
    await ctx.close()
    // Never show again turns the setting off
    const c2 = await browser.newContext({ viewport: vp })
    const p2 = await c2.newPage()
    await p2.clock.install({ time: NOW })
    await seed(p2)
    await p2.locator('[data-birthday-never]').click(); await p2.waitForTimeout(300)
    check(`${name}: Never show again sets reminders off`, (await stored(p2)).birthdayReminders === false)
    await c2.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
