// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Design-system t9 proof (headless, dev only): PORT=5310 SHOT_DIR=<dir> node styleguide_shots.mjs against a dev server of apps/trustweb. EXE=<chromium headless shell> if the default is not installed. */
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

const PAGE = `http://127.0.0.1:${process.env.PORT ?? 5310}/styleguide.html`
const SHOT_DIR = process.env.SHOT_DIR ?? 'shots'
const tokens = JSON.parse(readFileSync(new URL('../../src/design/tokens.json', import.meta.url), 'utf8'))
const expected = Object.keys(tokens.one.light).length + Object.keys(tokens.core).length
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const open = async (opts, theme, init) => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, ...opts })
  const page = await ctx.newPage()
  if (theme) await page.addInitScript((t) => localStorage.setItem('tw-theme', t), theme)
  if (init) await page.addInitScript(init)
  await page.goto(PAGE)
  await page.locator('#tokens .sw').first().waitFor()
  return page
}
const motion = (page) => page.evaluate(() => document.documentElement.dataset.motion)
try {
  for (const theme of ['light', 'dark']) {
    const page = await open({}, theme)
    const n = await page.locator('#tokens .sw').count()
    const attr = await page.evaluate(() => document.documentElement.dataset.theme)
    check(`${theme}: ${n} swatches (expected ${expected}), data-theme=${attr}`, n === expected && attr === theme)
    await page.screenshot({ path: `${SHOT_DIR}/styleguide-${theme}.png`, fullPage: true })
    await page.context().close()
  }
  {
    const page = await open({ reducedMotion: 'reduce' })
    const anims = await page.evaluate(() => document.getAnimations().length)
    check(`reduced motion: data-motion=${await motion(page)}, animations=${anims}`, (await motion(page)) === 'off' && anims === 0)
    await page.context().close()
  }
  {
    const page = await open({}, undefined, () => Object.defineProperty(navigator, 'connection', { value: { effectiveType: '3g', addEventListener() {} } }))
    check('slow network: data-motion off', (await motion(page)) === 'off')
    await page.context().close()
  }
  {
    const page = await open({})
    const before = await motion(page)
    await page.getByRole('button', { name: 'Simulate a slow connection' }).click()
    const on = await motion(page)
    await page.getByRole('button', { name: 'Simulate a slow connection' }).click()
    check(`simulate button: ${before} -> ${on} -> ${await motion(page)}`, before === 'on' && on === 'off' && (await motion(page)) === 'on')
    await page.getByRole('button', { name: 'Load voice text' }).click()
    await page.locator('#voice-text:not([hidden])').waitFor()
    check('voice text loads on demand', (await page.locator('#voice-text').textContent()).includes('TrustWeb voice'))
    check('trust path drawn', (await page.locator('#path path.trust-path').getAttribute('d')).startsWith('M40.0 100.0'))
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
