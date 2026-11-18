// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-hopes live proof (headless, stock data): PORT=5450 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.js> node co_hopes.mjs */
import { quietKeepCopy } from './rings_first.mjs'
const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium

const PORT = process.env.PORT ?? 5450
const URL = `http://127.0.0.1:${PORT}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
quietKeepCopy(browser) // review-44c: the Keep-a-copy offer sheet covered the controls (red on base 85191dbcde)
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, did) => ({ id, name, context: '', ring: 1, metAt: 1, lines: [], did })
const EV = (id) => ({ id, name: 'Retreat', from: '2026-12-27', to: '2027-01-08', where: 'Hut', createdAt: 1, attended: true, people: ['p2'] })
const record = () => ({ v: 1, me: { id: 'me1', displayName: 'Anna' }, peers: [], log: [], inventory: [], coNotesOn: true, events: [EV('e1')], people: [P('p2', 'Ben', 'did:key:zBen000000002')] })
try {
  for (const [name, opts] of [
    ['360', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['1280', { viewport: { width: 1280, height: 900 } }],
  ]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((rec) => localStorage.setItem('trustweb.v1.me', JSON.stringify(rec)), record())
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(500); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1200)
    const tap = (sel) => (name === '360' ? page.locator(sel).first().tap() : page.locator(sel).first().click())
    await tap('[data-go="events"]'); await page.waitForTimeout(300); await tap('[data-cal-all]'); await page.waitForTimeout(200); await tap(`[data-event="e1"]`); await page.waitForTimeout(300)

    check(`${name}: button says Hopes and wishes`, (await page.locator('[data-co-desires]').first().innerText()) === 'Hopes and wishes')
    await tap('[data-co-desires]'); await page.waitForTimeout(500)
    const lastInput = async () => page.evaluate(() => { const a = document.activeElement; const rows = [...document.querySelectorAll('[data-co-block]')]; return !!a && a.matches('[data-co-input]') && rows[rows.length - 1]?.contains(a) && a.value === '' })
    check(`${name}: title says Hopes and wishes`, (await page.locator('[data-co-title]').inputValue()) === 'Hopes and wishes: Retreat')
    check(`${name}: caret already sits in the empty last line`, await lastInput())
    const n0 = await page.locator('[data-co-share]').count()   // the dev server keeps one record across both viewports, so count relative
    check(`${name}: one explaining line, muted`, (await page.locator('[data-co-explain]').count()) === 1 && /Enter adds the next line/.test(await page.locator('[data-co-explain]').innerText()))
    await page.keyboard.press('Enter'); await page.waitForTimeout(200)
    check(`${name}: Enter on the empty last line adds nothing`, (await page.locator('[data-co-share]').count()) === n0 && (await lastInput()))
    await page.keyboard.type('sauna'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
    check(`${name}: Enter after text opens a new focused line at the bottom`, (await page.locator('[data-co-share]').count()) === n0 + 1 && (await lastInput()))
    await page.keyboard.type('quiet'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
    const texts = await page.evaluate(() => [...document.querySelectorAll('[data-co-block]')].map((r) => (r.querySelector('[data-co-input]')?.value ?? r.querySelector('[data-co-text]')?.innerText ?? '').trim()))
    check(`${name}: Enter on a middle line also appends at the bottom`, JSON.stringify(texts.slice(-3)) === JSON.stringify(['sauna', 'quiet', '']) && (await lastInput()))
    check(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${name}: explain line does not overlap the first row`, await page.evaluate(() => { const a = document.querySelector('[data-co-explain]').getBoundingClientRect(); const b = document.querySelector('[data-co-block]').getBoundingClientRect(); return a.bottom <= b.top + 1 || a.top >= b.bottom - 1 }))
    await page.screenshot({ path: `${SHOTS}/feed-hopes-${name}.png` })
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
