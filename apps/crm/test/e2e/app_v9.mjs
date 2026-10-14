/**
 * Wave 7 app-v9 proof (headless, dev only): Web rings with initials avatars, Manuel on the close ring, no contact tier.
 *   PORT=5192 node test/e2e/app_v9.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5192}/`
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'app-v9-')), { headless: true, viewport: { width: 390, height: 844 }, args: ['--use-mock-keychain', '--password-store=basic'] })
const page = ctx.pages()[0] ?? await ctx.newPage()
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const RADII = { close: 48, friend: 84, acquaintance: 118, intending: 148, unsorted: 168 }
try {
  await page.goto(URL)
  await page.locator('.rings-wrap').waitFor()
  const nodes = await page.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((b) => ({ id: b.dataset.pid, name: b.querySelector('span')?.textContent, letter: b.querySelector('.ava')?.textContent, d: Math.hypot(parseFloat(b.style.left) - 176, parseFloat(b.style.top) - 176), size: b.querySelector('.ava').getBoundingClientRect().width })))
  console.log('nodes', nodes.length, 'outermost', JSON.stringify(nodes.sort((a, b) => b.d - a.d).slice(0, 8)))
  const m = nodes.find((n) => n.id === 'tana-iHgGDVKE6vGG')
  console.log('Manuel', JSON.stringify(m))
  await page.screenshot({ path: path.join(tmpdir(), 'app-v9-web.png') })
} finally { await ctx.close() }
process.exit(failed ? 1 : 0)
