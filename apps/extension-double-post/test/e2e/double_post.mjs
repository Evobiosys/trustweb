// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Headless check: extension loaded into chromium (new headless, persistent context) against a local
// fixture that mimics a Mastodon compose box. Needs: PW (playwright-core index.js), EXE (full chromium).
//   PW=<repo>/apps/crm/node_modules/playwright-core/index.js EXE=<chrome binary> node test/e2e/double_post.mjs
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { chromium } = (await import(process.env.PW)).default ?? (await import(process.env.PW))
let fail = 0
const check = (ok, what) => { console.log(ok ? 'PASS' : 'FAIL', what); if (!ok) fail++ }

const out = mkdtempSync(join(tmpdir(), 'dpx-'))
const dist = join(out, 'dist')
execFileSync('node', [join(here, '..', '..', 'build.mjs'), '--out', dist, '--test-host', 'http://127.0.0.1/*'], { stdio: 'inherit' })
const bundle = readFileSync(join(dist, 'content.js'), 'utf8') + readFileSync(join(dist, 'options.js'), 'utf8')
check(!/fetch\(|XMLHttpRequest|sendBeacon|\beval\(|WebSocket/.test(bundle), 'built bundle has no fetch/XHR/beacon/eval/WebSocket')

const fixture = readFileSync(join(here, 'mastodon_fixture.html'))
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  res.end(req.url.startsWith('/fixture') ? fixture : '<title>trustweb stub</title>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port

// unpacked extension id = sha256(real path), first 32 hex digits mapped 0-9a-f -> a-p
const id = [...createHash('sha256').update(realpathSync(dist)).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')

const ctx = await chromium.launchPersistentContext(join(out, 'profile'), {
  executablePath: process.env.EXE,
  headless: false,
  args: ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--disable-extensions-except=' + dist, '--load-extension=' + dist],
})
try {
  const opt = await ctx.newPage()
  await opt.goto(`chrome-extension://${id}/options.html`)
  await opt.locator('#sites input').nth(3).waitFor()   // review wave 40: the first render fills #base from storage; typing before it is overwritten
  await opt.fill('#base', 'http://evil.example')
  await opt.click('#save-base')
  check((await opt.textContent('#base-msg')).startsWith('Only https'), 'options: non-loopback http address refused')
  await opt.fill('#base', origin)
  await opt.click('#save-base')
  check((await opt.textContent('#base-msg')) === 'Saved.', 'options: loopback preview address saved')
  check((await opt.locator('#sites input:checked').count()) === 4, 'options: four network toggles, all on')

  const page = await ctx.newPage()
  const toast = () => page.locator('#trustweb-double-post')
  const shadowText = () => page.evaluate(() => document.getElementById('trustweb-double-post') !== null)
  await page.goto(origin + '/fixture')

  await page.click('.compose-form__submit-button')
  await page.waitForTimeout(400)
  check(!(await shadowText()), 'empty compose box: no prompt')

  await page.fill('textarea', 'Hallo Welt & mehr #tag')
  await page.click('.compose-form__submit-button')
  await toast().waitFor({ state: 'attached', timeout: 5000 })
  check(await shadowText(), 'publish click with text: prompt appears (box already cleared by the site)')
  const popup = ctx.waitForEvent('page')
  await page.getByRole('button', { name: 'Yes' }).click()
  const opened = await Promise.race([popup, new Promise((r) => setTimeout(() => r(null), 4000))])
  if (opened) {
    await opened.waitForLoadState().catch(() => {})
    const expected = origin + '/#compose=' + encodeURIComponent('Hallo Welt & mehr #tag') + '&from=mastodon'
    check(opened.url() === expected, 'Yes opens ' + expected)
  } else {
    check(false, 'Yes opened a TrustWeb tab ')
  }

  check(!(await shadowText()), 'prompt closes after Yes')
  await page.fill('textarea', 'second')
  await page.click('.compose-form__submit-button')
  await page.getByRole('button', { name: 'Not now' }).click()
  check(!(await shadowText()), 'Not now closes the prompt')
  await page.fill('textarea', 'third')
  await page.click('.compose-form__submit-button')
  await page.getByRole('button', { name: 'Never on this site' }).click()
  await page.fill('textarea', 'fourth')
  await page.click('.compose-form__submit-button')
  await page.waitForTimeout(500)
  check(!(await shadowText()), 'Never on this site: no prompt on the next publish')
  await opt.reload()
  check((await opt.locator('#never li').count()) === 1, 'options: muted site listed')
} finally {
  await ctx.close()
  server.close()
}
console.log(fail ? `${fail} FAIL` : 'ALL PASS')
process.exit(fail ? 1 : 0)
