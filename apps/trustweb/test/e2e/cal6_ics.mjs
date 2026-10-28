// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal6 proof (headless, dev only): PORT=5455 SHOTS=<dir> node cal6_ics.mjs. EXE=<chromium headless shell>. */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5455}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const FIXTURE = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:g1@google.com', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261113', 'SUMMARY:Retreat', 'LOCATION:Alm', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:g2@google.com', 'DTSTART;TZID=Europe/Vienna:20261111T180000', 'SUMMARY:Dinner', 'END:VEVENT', 'BEGIN:VTODO', 'UID:t', 'SUMMARY:x', 'END:VTODO', 'END:VCALENDAR'].join('\r\n')
writeFileSync('/tmp/cal6_fixture.ics', FIXTURE)
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  const EV = [{ id: 'e1', name: 'Forum, Südtirol', from: '2026-11-05T18:30', where: 'Innsbruck', createdAt: 1, attended: true, people: ['p1'] }]
  await page.evaluate((ev) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: [{ id: 'p1', name: 'Zed Secret', ring: 1, lines: [], context: '' }], peers: [], log: [], events: ev })), EV)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.locator('.events-btn').tap(); await page.waitForTimeout(300)
  await page.locator('[data-cal-export]').scrollIntoViewIfNeeded()
  check('export and import buttons plus the honest hint', (await page.locator('[data-cal-import]').count()) === 1 && (await page.locator('.cal-ics').innerText()).includes('not who is invited'))
  await page.screenshot({ path: `${SHOTS}/cal6-row.png` })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-cal-export]').tap()])
  await dl.saveAs('/tmp/cal6_out.ics')
  const out = readFileSync('/tmp/cal6_out.ics', 'utf8')
  check('download is trustweb-calendar.ics with the event', dl.suggestedFilename() === 'trustweb-calendar.ics' && out.includes('SUMMARY:Forum\\, Südtirol') && out.includes('UID:e1@trustweb'))
  check('no invitee in the file', !/Zed|p1|ATTENDEE/.test(out))
  await page.locator('[data-cal-import-file]').setInputFiles('/tmp/cal6_fixture.ics'); await page.waitForTimeout(400)
  check('toast says added 2', (await page.locator('body').innerText()).includes('Added 2, updated 0. 1 skipped.'))
  await page.locator('[data-cal-next]').tap(); await page.waitForTimeout(100)
  await page.locator('.cal-day[data-day="2026-11-11"]').tap(); await page.waitForTimeout(100)
  const names = await page.locator('[data-cal-event]').allInnerTexts()
  check('imported events show on their days (multi-day and timed)', names.some((t) => t.includes('Retreat')) && names.some((t) => t.includes('Dinner') && t.includes('18:00')))
  await page.screenshot({ path: `${SHOTS}/cal6-imported.png` })
  await page.locator('[data-cal-import-file]').setInputFiles('/tmp/cal6_fixture.ics'); await page.waitForTimeout(400)
  check('importing again updates, never duplicates', (await page.locator('body').innerText()).includes('Added 0, updated 2.') && (await page.locator('[data-cal-event]').count()) === 2)
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
