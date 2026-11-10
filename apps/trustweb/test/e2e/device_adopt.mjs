// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Take another device's state (wave 40), two browser profiles = two devices, a real RelayServer behind the Vite /relay proxy:
 *   Mac (390 px; its screenshots at 1280) holds Ada and Bo, Phone (360 px) holds Cy. Paired as in device_sync.mjs.
 *   1. Phone "Take this device's state": sheet with the difference count; confirm; Phone holds exactly Ada and Bo; a copy of the old record is under Settings > Advanced > Archived copies.
 *   2. Restore puts Cy back (and archives the state it replaced).
 *   3. Phone "Send my state to this device": Mac is asked, shows the "give" sheet, confirms; Mac holds exactly what the Phone holds.
 * Port: Vite 5497 (TW_PORT). Run with TW_STOCK=1 from apps/demo:
 *   TW_STOCK=1 PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/device_adopt.mjs
 * Screens: TW_SHOTS=<dir>.
 */
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5497)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const person = (id, name, lines = []) => ({ id, name, context: '', ring: 'friend', metAt: Date.now(), lines })
const note = (id, text) => ({ id, text, tag: 'offer', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 })
const names = async (page) => (await record(page)).people.filter((p) => !p.deleted_at).map((p) => p.name).sort()
/** `wide`: the shot is taken at 1280 px (the Mac profile runs at phone width so the flow matches device_sync.mjs). */
const shot = async (page, name, wide = false) => {
  if (!SHOTS) return
  if (wide) await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: `${SHOTS}/device-adopt-${name}.png` })
  if (wide) await page.setViewportSize({ width: 390, height: 844 })
}

async function withRecord(page, base, people, extra = {}) {
  await page.evaluate(([ps, more]) => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.people = ps; Object.assign(s, more); localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) }, [people, extra])
  await page.goto(base)
  await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
}
/** Settings groups are folded (wave 27); the test opens them all. */
const unfold = (page) => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))

async function openDevices(page) {
  await page.reload()
  await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.evaluate(() => localStorage.setItem('trustweb.ui.settings.devices', '1'))
  await page.locator('.hdr [aria-label="Settings"]').click()
  await unfold(page)
  await page.locator('[data-open-devices]').click()
  await page.getByRole('heading', { name: 'My devices' }).waitFor({ timeout: 10_000 })
}
async function openArchived(page) {
  await page.reload()
  await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
  await page.evaluate(() => localStorage.setItem('trustweb.ui.settings.advanced', '1'))
  await page.locator('.hdr [aria-label="Settings"]').click()
  await unfold(page)
  await page.waitForTimeout(600)
  await page.locator('[data-archived-copies]').evaluate((e) => e.scrollIntoView())
}

/** The shared harness relay checks the sender signature against its own origin, which the Vite proxy rewrites: this suite runs its relay with sender auth off. */
async function startOpenRelay() {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const server = new RelayServer({ queueStore: new InMemoryRelayQueueStore(), senderAuth: 'off' })
  const { port } = await server.listen(0, '127.0.0.1')
  return { port, stop: () => server.close?.() }
}

async function main() {
  const relay = await startOpenRelay()
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log('device-adopt against ' + vite.base)
  const browser = await launch()
  try {
    const mac = await newPhone(browser, errors, { viewport: { width: 390, height: 844 } })
    const phone = await newPhone(browser, errors, { viewport: { width: 360, height: 800 } })
    await startPhone(mac, vite.base, 'Jakob')
    await startPhone(phone, vite.base, 'Jakob')
    await mac.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Mac'))
    await phone.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Phone'))
    await withRecord(mac, vite.base, [person('a1', 'Ada Mac', [note('a1l', 'fixes bikes')]), person('b1', 'Bo Mac')], { city: 'Wien' })
    await withRecord(phone, vite.base, [person('c1', 'Cy Phone')])

    await openDevices(mac)
    await mac.locator('[data-link-device]').click()
    const code = (await mac.locator('[data-device-code]').innerText()).trim()
    await openDevices(phone)
    await phone.locator('[data-enter-code]').click()
    await phone.locator('[data-code-input]').fill(code)
    await phone.locator('[data-code-ok]').click()
    await phone.locator('[data-pair-confirm]').waitFor({ timeout: 20_000 })
    await mac.locator('[data-pair-confirm]').waitFor({ timeout: 20_000 })
    await phone.locator('[data-pair-confirm]').click()
    await mac.locator('[data-pair-confirm]').click()

    // 1. Take
    await phone.locator('[data-take-state]').click()
    await phone.locator('[data-adopt-confirm]').waitFor({ timeout: 40_000 })
    const diff = await phone.locator('[data-adopt-diff]').getAttribute('data-adopt-diff')
    ok('the sheet counts the differences (3 people, 0 notes, settings)', /^3,0,\d+$/.test(diff ?? ''), diff)
    ok('the sheet says what happens to the old state', await phone.getByText('kept for 30 days').isVisible())
    ok('the sheet carries the alpha label', (await phone.locator('[data-alpha-label]').count()) >= 1)
    await shot(phone, 'confirm-360')
    ok('nothing replaced before the confirm', JSON.stringify(await names(phone)) === JSON.stringify(['Cy Phone']))
    await phone.locator('[data-adopt-confirm]').click()
    await phone.locator('[data-take-state]').waitFor({ timeout: 10_000 })
    ok('Phone holds exactly what the Mac holds', JSON.stringify(await names(phone)) === JSON.stringify(['Ada Mac', 'Bo Mac']), JSON.stringify(await names(phone)))
    ok('the Mac was not changed', JSON.stringify(await names(mac)) === JSON.stringify(['Ada Mac', 'Bo Mac']))
    const pr = await record(phone)
    ok('settings came with it (city)', pr.city === 'Wien')

    // 2. Archived copy and Restore
    await openArchived(phone)
    await phone.locator('[data-archived-copy]').first().waitFor({ timeout: 5_000 })
    ok('one archived copy is listed', (await phone.locator('[data-archived-copy]').count()) === 1)
    await shot(phone, 'archived-360')
    await phone.locator('[data-archived-restore]').first().click()
    await phone.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    ok('Restore puts Cy back', JSON.stringify(await names(phone)) === JSON.stringify(['Cy Phone']), JSON.stringify(await names(phone)))
    await openArchived(phone)
    ok('the state the restore replaced is archived too', (await phone.locator('[data-archived-copy]').count()) === 2)

    // 3. Send my state
    await openDevices(phone)
    await phone.locator('[data-give-state]').click()
    await mac.locator('[data-adopt-confirm]').waitFor({ timeout: 40_000 })
    ok('the Mac is asked first and its record is untouched', JSON.stringify(await names(mac)) === JSON.stringify(['Ada Mac', 'Bo Mac']))
    ok('the Mac sheet names the Phone', await mac.getByText('Phone wants to replace the state of this device').isVisible())
    await shot(mac, 'give-1280', true)
    await mac.locator('[data-adopt-confirm]').click()
    await mac.locator('[data-take-state]').waitFor({ timeout: 10_000 })
    ok('the Mac holds exactly what the Phone holds', JSON.stringify(await names(mac)) === JSON.stringify(['Cy Phone']), JSON.stringify(await names(mac)))
    await openArchived(mac)
    await shot(mac, 'archived-1280', true)
    ok('the Mac archived its old state first', (await mac.locator('[data-archived-copy]').count()) === 1)

    // 4. Settled: a next sync lists nothing to review
    await openDevices(phone)
    await phone.locator('[data-sync-now]').click()
    await mac.locator('[data-receive]').waitFor({ timeout: 40_000 })
    await mac.locator('[data-receive]').click()
    await mac.waitForTimeout(800)
    ok('the next sync has no conflict to review', (await record(mac)).syncReview === undefined && (await record(phone)).syncReview === undefined)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `device-adopt: ${c.failures} failed` : `device-adopt: all passed (${c.passes} checks)`)
  process.exit(c.failures ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
