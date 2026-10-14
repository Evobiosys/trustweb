/**
 * Web Curator v4 proof (dev only, live Tana): needs the 5191 dev server. One Pipeline tab with a follow-ups fold, Filters fold, feature overlay,
 * dark despite a light OS theme, dashed suggested ring until tapped once, and the suggested family tags queued/pushed to Tana.
 *   node test/e2e/curator_v4.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const profile = mkdtempSync(path.join(tmpdir(), 'curator-v4-'))
const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, colorScheme: 'light', args: ['--use-mock-keychain', '--password-store=basic'] })
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb-crm.v1.prefs') ?? '{}'))

try {
  await page.goto('http://127.0.0.1:5191/')
  await page.getByRole('searchbox').waitFor()
  check('feature overlay with branch @ sha · personal', /FEATURE · Web Curator: people, rings, sort, Tana sync/.test(await page.locator('.twf').innerText()) && /@ [0-9a-f]+ · \d\d:\d\d · personal/.test(await page.locator('.twf i').innerText()))
  check('dark although the OS is light', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(18, 12, 26)')
  check('no Follow-ups tab', (await page.locator('[data-tab="followups"]').count()) === 0 && (await page.locator('.tab').count()) === 4)
  check('Filters collapsed: toggle shows, block hidden', (await page.locator('[data-action="toggle-filters"]').innerText()).includes('active') && (await page.locator('[data-part="filters"]').count()) === 0)
  check('sort banner visible above', (await page.locator('[data-action="sort-banner"]').count()) === 1)
  await page.locator('[data-action="toggle-filters"]').click()
  check('Filters open on tap', (await page.locator('[data-part="filters"]').count()) === 1)
  await page.locator('[data-tab="pipeline"]').click()
  check('Pipeline has the follow-ups fold on top', (await page.locator('[data-part="followups"] summary').innerText()).startsWith('Follow-ups'))

  await page.locator('[data-tab="people"]').click()
  const dashed = page.locator('.ring-label.suggested')
  const n = await dashed.count()
  check(`suggested rings dashed (${n})`, n > 200)
  await page.getByRole('searchbox').fill('a')
  const first = page.locator('.person-row:has(.ring-label.suggested)').first()
  const name = await first.locator('strong').innerText()
  await first.locator('.ring-label').click()
  check(`one tap confirms (${name})`, (await page.locator(`.person-row:has-text("${name}") .ring-label.suggested`).count()) === 0)

  for (let i = 0; i < 90 && (await prefs()).queue?.length !== 0; i++) await page.waitForTimeout(2000) // v5: the suggested rings go to Tana too
  const p = await prefs()
  const fam = p.log.filter((l) => /LNlpliq4GdNI -> Tana ok/.test(l))
  console.log(`queued once: ${p.suggestedQueued.length} people; queue left ${p.queue.length}; family writes done ${fam.length}`)
  check('6 family tags pushed, queue empty', fam.length === 6 && p.queue.length === 0)
} catch (e) {
  console.log('ERROR', e.message)
  failed = true
}
check('0 page errors', errors.length === 0)
if (errors.length) console.log(errors)
await ctx.close()
process.exit(failed ? 1 : 0)
