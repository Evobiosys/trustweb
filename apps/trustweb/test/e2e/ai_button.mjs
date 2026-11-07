// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 llm-button: no [data-ai-button] by default; an endpoint alone is not enough; endpoint + a fresh pi check -> the button sits between
 * the search and the eye; a fake pi /health answers the Check in Settings; pressing it opens the Ask sheet.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<chrome> TW_PORT=5431 TW_SHOTS=<dir> node ../trustweb/test/e2e/ai_button.mjs
 */
import { createServer } from 'node:http'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5431)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const errors = []

const pi = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"agent":"pi"}') } else { res.statusCode = 404; res.end() }
})
await new Promise((r) => pi.listen(0, '127.0.0.1', r))
const piUrl = `http://127.0.0.1:${pi.address().port}`

const vite = await startVite(PORT)
const browser = await launch()
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `llm-button-${name}.png`) }) }
const save = (page, patch) => page.evaluate((p) => {
  const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
  localStorage.setItem('trustweb.v1.me', JSON.stringify({ ...r, ...p.top, advanced: { ...r.advanced, ...p.advanced } }))
}, patch)
const row = (page) => page.locator('.hdr .hdr-right button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-ai-button') !== null ? 'ai' : b.classList.contains('web-search-btn') ? 'search' : b.getAttribute('aria-label')))

try {
  for (const [w, h] of [[360, 780], [1280, 800]]) {
    const page = await newPhone(browser, errors, { viewport: { width: w, height: h } })
    await startPhone(page, vite.base, 'Ana')
    c.ok(`${w}: no button by default`, (await page.locator('[data-ai-button]').count()) === 0)
    await shot(page, `${w}-without`)
    const ai = { preset: 'custom', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm' }
    await save(page, { advanced: { ai } })
    await page.reload(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor()
    c.ok(`${w}: an endpoint alone shows no button`, (await page.locator('[data-ai-button]').count()) === 0)

    // Settings > Advanced > Your AI > Agent: the Check against the fake pi unlocks the button
    await page.evaluate(() => ['advanced', 'advanced-web', 'advanced-inventory', 'advanced-record'].forEach((k) => localStorage.setItem(`trustweb.ui.settings.${k}`, '1')))
    await page.locator('[data-settings-gear]').click()
    await page.locator('[data-agent-url]').evaluate((n) => { for (let d = n.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true })
    await page.locator('[data-agent-url]').fill(piUrl)
    await page.locator('[data-agent-url]').dispatchEvent('change')
    await page.locator('[data-agent-check]').click()
    await page.getByText(/^Connected, checked/).waitFor({ timeout: 5000 })
    c.ok(`${w}: Check against a fake pi connects`, (await record(page)).agent?.connectedAt !== undefined)
    await shot(page, `${w}-settings`)
    await page.locator('[data-go="web"]').click().catch(() => page.keyboard.press('Escape'))
    await page.reload(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor()
    const labels = await row(page)
    const i = labels.indexOf('ai')
    c.ok(`${w}: button sits between search and eye`, i > 0 && labels[i - 1] === 'search' && /view/i.test(labels[i + 1] ?? ''), JSON.stringify(labels))
    await shot(page, `${w}-with`)
    await page.locator('[data-ai-button]').click()
    c.ok(`${w}: press opens the Ask sheet`, (await page.locator('[data-ask-input]').count()) > 0)
    await shot(page, `${w}-ask`)

    // a stale check hides it again
    await page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.agent.connectedAt = new Date(Date.now() - 11 * 60_000).toISOString()
      localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
    })
    await page.reload(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor()
    c.ok(`${w}: a check older than 10 minutes hides it`, (await page.locator('[data-ai-button]').count()) === 0)
    await page.context().close()
  }
} finally {
  await browser.close(); vite.stop(); pi.close()
}
c.ok('no page errors', errors.length === 0, errors.join(' | '))
console.log(`${c.passes} passed, ${c.failures} failed`)
process.exit(c.failures ? 1 : 0)
