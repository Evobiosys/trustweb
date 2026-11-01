// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 import-curate screen proof (headless, dev only): a WhatsApp fixture (invented names) through Settings > "From other services"
 * at 390x844: summary, Yes, Curate page (Back, no overlay), Accept / Leave, re-import diff, Undo.
 * PORT=5471 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node import_services.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5471}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const dir = mkdtempSync(path.join(tmpdir(), 'tw-svc-'))
const lines = (days) => days.flatMap((d) => [`[${d}.10.26, 09:00:00] Mira Probe: hello`, `[${d}.10.26, 10:00:00] Owner Test: hi back`])
const chat = path.join(dir, '_chat.txt')
writeFileSync(chat, lines([20, 21, 22, 23, 24, 25]).join('\n'))
const newer = path.join(dir, 'newer', '_chat.txt')
const li = path.join(dir, 'Connections.csv')
writeFileSync(li, 'Notes:\nthis is a preamble\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nOtto,Beispiel,,otto@example.org,Acme,Dev,05 Oct 2024\n')

const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Owner Test' }, peers: [], log: [], inventory: [], people: [] })
// The app now and then closes the Settings sheet by itself (not from this screen); reopen it when that happens.
const reopen = async (page) => {
  if (await page.locator('[data-import-services]').isVisible()) return
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('[data-import-services]').scrollIntoViewIfNeeded()
}
const people = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people)
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('dialog', (d) => d.accept())
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.settings.advanced', '1') }, record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  await page.locator('nav.tabs button', { hasText: 'Resources' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const sect = page.locator('[data-import-services]')
  await sect.scrollIntoViewIfNeeded()
  check('the section is on the Settings screen', (await sect.count()) === 1)
  await page.setInputFiles('[data-svc-file]', [chat, li]); await page.waitForTimeout(500)
  const sum = page.locator('[data-svc-summary]')
  check('summary counts per source and proposals', /WhatsApp 1, LinkedIn 1; 2 proposals/.test(await sum.innerText()))
  check('nothing written before Yes', (await people(page)).length === 0)
  await page.screenshot({ path: `${SHOTS}/svc-summary.png` })
  await page.locator('[data-svc-yes]').tap(); await page.waitForTimeout(400)
  check('Yes opens the Curate page (a page, not a sheet)', (await page.locator('[data-page="import-curate"]').count()) === 1)
  check('rows show zone, S, label', /Friends and community members · S 0\.\d\d · inferred, not verified/.test(await page.locator('[data-svc-row="wa:mira probe"]').innerText()))
  check('terms sit under (i)', (await page.locator('[data-svc-row="wa:mira probe"] details').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/svc-curate.png` })
  await page.locator('[data-svc-accept="wa:mira probe"]').tap(); await page.waitForTimeout(300)
  const ppl = await people(page)
  check('Accept writes the person on Friend with sources', ppl.length === 1 && ppl[0].ring === 'friend' && ppl[0].sources[0].source === 'whatsapp')
  await page.locator('[data-svc-leave]').first().tap(); await page.waitForTimeout(300)
  check('Leave writes nothing', (await people(page)).length === 1 && (await page.locator('[data-svc-empty]').count()) === 1)
  await page.locator('[data-page-back]').tap(); await page.waitForTimeout(200)
  check('Back closes the page', (await page.locator('[data-page]').count()) === 0)
  await reopen(page)
  await sect.scrollIntoViewIfNeeded()
  await page.setInputFiles('[data-svc-file]', [chat, li]); await page.waitForTimeout(500)
  const diffText = await page.waitForFunction(() => /Added 0, changed 0, unchanged 2/.exec(document.querySelector('[data-svc-diff]')?.textContent ?? '')?.[0], null, { timeout: 5000 }).then((h) => h.jsonValue(), () => 'not shown')
  check('re-import reports unchanged: ' + diffText, /Added 0, changed 0, unchanged 2/.test(diffText))
  await reopen(page)
  await page.locator('[data-svc-notnow]').tap()
  await reopen(page)
  await page.locator('[data-svc-undo]').tap(); await page.waitForTimeout(300)
  const after = await people(page)
  check('Undo moves the created person out of the web, deletes nobody', after.length === 1 && after[0].ring === 'none')
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
