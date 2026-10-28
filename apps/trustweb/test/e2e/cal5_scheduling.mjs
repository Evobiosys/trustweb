// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal5 proof (headless, dev only): PORT=5454 SHOTS=<dir> EXE=<chromium headless shell> node cal5_scheduling.mjs. */
import { chromium } from 'playwright-core'

const BASE = `http://127.0.0.1:${process.env.PORT ?? 5454}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const ctx = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const hide = (page) => page.addStyleTag({ content: '.twf, .twf-ok { display:none !important }' })

// Owner: record with a did, availability Mon-Fri 09-17 (default), link
const a = await (await ctx()).newPage()
const errors = []
a.on('pageerror', (e) => errors.push(String(e)))
await a.goto(BASE); await a.waitForTimeout(1500)
await a.evaluate(() => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, log: [], inventory: [], peers: [], events: [], people: [] })))
await a.reload(); await hide(a)
await a.locator('.events-btn').first().tap(); await a.waitForTimeout(300)
await a.locator('[data-cal-availability]').tap(); await a.waitForTimeout(300)
check('availability sheet shows 7 weekday rows', (await a.locator('[data-avail-on]').count()) === 7)
check('defaults prefilled but not saved', (await rec(a)).availability === undefined && (await a.locator('[data-avail-on="0"]').isChecked()))
await a.screenshot({ path: `${SHOTS}/cal5-availability.png` })
await a.locator('[data-avail-save]').tap(); await a.waitForTimeout(300)
check('Save stores 5 windows', (await rec(a)).availability?.windows.length === 5)
await a.locator('[data-cal-book-link]').tap(); await a.waitForTimeout(300)
const link = await a.locator('[data-book-link-text]').inputValue()
check('link has #book=', link.includes('/#book='))
check('link holds no event name or place', !Buffer.from(link.split('#book=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString().includes('Secret'))
await a.screenshot({ path: `${SHOTS}/cal5-link.png` })
const id = (await rec(a)).bookLinks?.[0]?.id
check('record keeps the link id', Boolean(id))

// Booker: no record
const b = await (await ctx()).newPage()
b.on('pageerror', (e) => errors.push(String(e)))
await b.goto(`${BASE}#${link.split('#')[1]}`); await b.waitForTimeout(1500)
await b.locator('.start-form input').fill('Eva'); await b.locator('.start-form .btn').tap(); await b.waitForTimeout(800); await hide(b)
check('book page shows slots', (await b.locator('[data-book-slot]').count()) > 0)
await b.screenshot({ path: `${SHOTS}/cal5-book.png` })
await b.locator('[data-book-slot]').first().tap()
await b.locator('[data-book-note]').fill('hello'); await b.locator('[data-book-send]').tap(); await b.waitForTimeout(300)
const reply = await b.locator('[data-booked-link-text]').inputValue()
check('reply link has #booked=', reply.includes('/#booked='))
await b.locator('[data-book-keep]').tap(); await b.waitForTimeout(300)
check('booker kept the owner snapshot', (await rec(b)).heldAvailability?.length === 1)
await b.screenshot({ path: `${SHOTS}/cal5-reply.png` })

// Owner opens the reply link
const a2 = await a.context().newPage()
a2.on('pageerror', (e) => errors.push(String(e)))
await a2.goto(`${BASE}#${reply.split('#')[1]}`); await a2.waitForTimeout(1500); await hide(a2)
check('owner sees the request', (await a2.locator('[data-booked-sheet]').count()) === 1)
await a2.screenshot({ path: `${SHOTS}/cal5-accept.png` })
await a2.locator('[data-booked-accept]').tap(); await a2.waitForTimeout(400)
const ev = (await rec(a2)).events ?? []
check('accept stores one event "Eva"', ev.length === 1 && ev[0].name.includes('Eva'))

// Unknown id
const c = await (await ctx()).newPage()
await c.goto(`${BASE}#${reply.split('#')[1]}`); await c.waitForTimeout(1500)
await c.locator('.start-form input').fill('Zed'); await c.locator('.start-form .btn').tap(); await c.waitForTimeout(800)
check('unknown id says so, no event', (await c.locator('[data-booked-unknown]').count()) === 1 && ((await rec(c)).events ?? []).length === 0)

check('no page errors', errors.length === 0)
if (errors.length) console.log(errors)
await browser.close()
process.exit(failed ? 1 : 0)
