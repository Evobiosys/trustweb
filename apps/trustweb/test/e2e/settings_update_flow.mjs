/**
 * Settings wave (2026-10-28): three fixes from the phone, headless, the connect service stubbed in the browser.
 *   1  "Devices and backups" holds the backup card (here the Inventory feature is off) with the automatic-backup switch
 *   2  the link under the name is tappable -> change sheet -> "Are you sure?" says what changes; Cancel sends nothing; Yes claims the new main name
 *   3  /release.json differing from the running build shows the update banner on start; Settings "Check for updates" says Up to date / offers Reload
 * Ports: Vite 8974, TLS front 8975.
 *   cd apps/trustweb && TW_VITE=../crm/node_modules/vite/bin/vite.js node test/e2e/settings_update_flow.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'
import { openAdvanced } from '../helpers/share_box.mjs'

const PORT = Number(process.env.TW_PORT || 8974)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
const RUNNING = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
process.env.TW_RELEASE = RUNNING
const t = tally()
const errors = []

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

async function main() {
  const app = await startApp(PORT)
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch(front.browserArgs)
    const server = fakeConnectServer(ORIGIN)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true })
    await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
    await server.install(ctx)
    let published = OTHER
    await ctx.route(ORIGIN + '/release.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ release: published, built_at: '2026-10-28T08:00:00.000Z' }) }))
    await ctx.route(ORIGIN + '/backup/health', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'ok\n' }))
    const page = await ctx.newPage()
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    await page.goto(ORIGIN + '/')
    await page.getByLabel('Your first name').fill('Cy Coder')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})

    // 3a update banner on start
    t.ok('3: the banner shows when /release.json differs from the running build', !!(await until(async () => (await page.locator('[data-update-banner]').isVisible()) ? true : null)))
    await shot(page, 'su-banner.png')

    // a main name, claimed in Meet
    await page.locator('.hdr [aria-label^="Show my code"]').click()
    await until(async () => (await record(page)).connectCode ? true : null, 15_000)
    await openAdvanced(page)
    await page.locator('[data-username]').fill('cyril')
    await page.locator('[data-act="claim-name"]').click()
    await until(async () => server.names.has('cyril') && (await record(page)).connectCode.name === 'cyril' ? true : null)

    // 1 backup card in Settings, Inventory off
    await page.reload()
    await page.locator('.hdr [aria-label="Settings"]').click()
    await page.locator('.sheet.on [data-settings-section="features"] > summary').click()
    await page.locator('.sheet.on [data-feature-inventory]').click()
    await page.locator('.sheet.on [data-settings-section="devices"] > summary').click()
    const card = page.locator('.sheet.on [data-settings-section="devices"] [data-backup-slot="settings"]')
    t.ok('1: the backup card is in Devices and backups (Inventory off)', !!(await until(async () => (await card.locator('.backup').count()) ? true : null)))
    t.ok('1: it offers to start a backup', (await card.innerText()).includes('Do you want'), await card.innerText())
    await shot(page, 'su-backup-in-settings.png')

    // 2 the tappable link
    await page.locator('.sheet.on [data-settings-section="you"] [data-change-link]').click()
    await page.locator('[data-new-link]').fill('cy.new')
    const before = server.posts.length
    await page.locator('[data-link-go]').dispatchEvent('click')
    const sure = await page.locator('[data-link-sure]').innerText()
    t.ok('2: "Are you sure?" says the new link and that the old one stops working', /Are you sure/.test(sure) && sure.includes('trustweb.one/cy.new') && sure.includes('trustweb.one/cyril') && /stops working/.test(sure), sure)
    await shot(page, 'su-link-sure.png')
    await page.locator('[data-link-no]').dispatchEvent('click')
    t.ok('2: Cancel sends nothing', server.posts.length === before && !server.names.has('cy.new') && server.names.has('cyril'))
    await page.locator('[data-new-link]').fill('cy.new')
    await page.locator('[data-link-go]').dispatchEvent('click')
    await page.locator('[data-link-yes]').dispatchEvent('click')
    t.ok('2: Yes claims the new main name', !!(await until(async () => (await record(page)).connectCode.name === 'cy.new' && server.names.has('cy.new') ? true : null)))

    // 3b manual check
    await page.locator('.sheet.on [data-settings-section="advanced"] > summary').click()
    await page.locator('.sheet.on [data-check-updates]').dispatchEvent('click')
    t.ok('3: "Check for updates" offers Reload when a newer build is published', !!(await until(async () => (await page.locator('.sheet.on [data-update-status]').getAttribute('data-result')) === 'newer' ? true : null)))
    published = RUNNING
    await page.locator('.sheet.on [data-check-updates]').dispatchEvent('click')
    t.ok('3: and says Up to date when it is not', !!(await until(async () => /^Up to date$/.test(await page.locator('.sheet.on [data-update-status]').innerText()) ? true : null)))
    t.ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser?.close()
    await front?.stop?.()
    await app.stop()
  }
  console.log(t.failures ? `FAILED ${t.failures}` : 'ALL PASS')
  process.exit(t.failures ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
