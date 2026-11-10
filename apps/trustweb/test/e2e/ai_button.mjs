// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 ai-button (wave 39: at the far right of every header, after Settings): the AI button; without an endpoint it leads to the plan
 * choice (Small 5 €, Big 18 €, Enterprise) in Settings > Advanced > Your AI; with one it opens the Ask sheet.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<chrome> TW_PORT=5431 TW_SHOTS=<dir> node ../trustweb/test/e2e/ai_button.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, startPhone, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5431)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const errors = []
const vite = await startVite(PORT)
const browser = await launch()
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `ai-button-${name}.png`) }) }
const row = (page) => page.locator('.hdr .hdr-right button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-ai-button') !== null ? 'ai' : b.classList.contains('web-search-btn') ? 'search' : b.getAttribute('aria-label')))

try {
  for (const [w, h] of [[360, 780], [1280, 800]]) {
    const page = await newPhone(browser, errors, { viewport: { width: w, height: h } })
    await page.context().addInitScript(() => { const st = document.createElement('style'); st.textContent = '.twf-ok{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.append(st)) })
    await startPhone(page, vite.base, 'Ana')
    const labels = await row(page)
    const i = labels.indexOf('ai')
    c.ok(`${w}: button sits at the far right, after Settings (wave 39)`, i === labels.length - 1 && /settings/i.test(labels[i - 1] ?? ''), JSON.stringify(labels))
    await shot(page, `${w}-header`)

    await page.locator('[data-ai-button]').click()
    await page.locator('[data-ai-group="sub"]').waitFor()
    c.ok(`${w}: no endpoint -> Your AI plan choice`, await page.locator('[data-ai-group="sub"]').isVisible())
    const plans = await page.locator('[data-ai-plan]').allInnerTexts()
    c.ok(`${w}: Small 5 €, Big 18 €, Enterprise in order`, plans.length === 3 && /Small[\s\S]*5 €/.test(plans[0]) && /Big[\s\S]*18 €/.test(plans[1]) && /Enterprise[\s\S]*Talk with us/.test(plans[2]), plans.join(' | '))
    const boxes = await page.locator('[data-ai-plan]').evaluateAll((n) => n.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width } }))
    c.ok(`${w}: ${w >= 720 ? 'side by side' : 'stacked'}`, w >= 720 ? boxes[0].y === boxes[1].y && boxes[1].y === boxes[2].y : boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y, JSON.stringify(boxes))
    c.ok(`${w}: Enterprise mails connect@evobiosys.org`, (await page.locator('[data-ai-enterprise]').getAttribute('href')).startsWith('mailto:connect@evobiosys.org'))
    c.ok(`${w}: buttons underlined`, (await page.locator('[data-ai-signup]').evaluateAll((b) => b.every((x) => getComputedStyle(x).textDecorationLine.includes('underline')))))
    c.ok(`${w}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    c.ok(`${w}: bring your own keys folded`, !(await page.locator('[data-ai-group="byok"]').evaluate((d) => d.open)))
    await page.waitForTimeout(700)
    await shot(page, `${w}-plans`)
    await page.locator('[data-ai-group="byok"] > summary').click()
    c.ok(`${w}: disclosure shows the key fields`, await page.locator('[data-ai-field="baseUrl"]').isVisible())
    await shot(page, `${w}-byok`)

    await page.locator('[data-ai-signup="light"]').click()
    c.ok(`${w}: Choose Small opens the sign-up sheet`, (await page.locator('[data-ai-email]').count()) === 1)

    await page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
      localStorage.setItem('trustweb.v1.me', JSON.stringify({ ...r, advanced: { ...r.advanced, ai: { preset: 'custom', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm' } } }))
    })
    await page.reload(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor()
    await page.locator('[data-ai-button]').click()
    c.ok(`${w}: with an endpoint the press opens the Ask sheet`, (await page.locator('[data-ask-input]').count()) > 0)
    await shot(page, `${w}-ask`)
    await page.context().close()
  }
} finally {
  await browser.close(); vite.stop()
}
c.ok('no page errors', errors.length === 0, errors.join(' | '))
console.log(`${c.passes} passed, ${c.failures} failed`)
process.exit(c.failures ? 1 : 0)
