/**
 * Device sync (wave 7), two browser profiles = two devices, a real RelayServer behind the Vite /relay proxy:
 *   1. Mac holds Ada and Bo, Phone holds Cy. Mac shows a code, Phone enters it, both show the SAME 4 characters, both Confirm.
 *   2. Phone "Sync now": Mac is asked "Receive 1 person ...?" and merges; Mac sends its record back; Phone asks and merges.
 *   3. Both end with Ada, Bo, Cy; nothing deleted; no relay request body contains a name (all sealed).
 *   4. A second Sync now with nothing new changes nothing; "Sync now" to a closed device says it is not on.
 * Port: Vite 5297 (TW_PORT). Run from apps/demo:
 *   PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/device_sync.mjs
 */
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5297)
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 30_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const person = (id, name) => ({ id, name, context: '', ring: 'friend', metAt: Date.now(), lines: [{ id: id + 'l', text: name + ' fixes bikes', tag: 'offer', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 }] })

async function withPeople(page, base, people) {
  await page.evaluate((ps) => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.people = ps; localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) }, people)
  await page.goto(base)
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
}
async function openDevices(page) {
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.getByRole('button', { name: 'More' }).click()
  await page.locator('.menu-item', { hasText: 'Settings' }).click()
  await page.locator('[data-open-devices]').click()
  await page.getByRole('heading', { name: 'My devices' }).waitFor({ timeout: 10_000 })
}
const names = async (page) => (await record(page)).people.map((p) => p.name).sort()

async function main() {
  const relay = await startRelay()
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log('device-sync against ' + vite.base)
  const browser = await launch()
  const bodies = []
  try {
    const mac = await newPhone(browser, errors)
    const phone = await newPhone(browser, errors)
    for (const p of [mac, phone]) p.on('request', (r) => { if (r.url().includes('/relay/send')) bodies.push(r.postData() ?? '') })
    await startPhone(mac, vite.base, 'Jakob')
    await startPhone(phone, vite.base, 'Jakob')
    await withPeople(mac, vite.base, [person('a1', 'Ada Mac'), person('b1', 'Bo Mac')])
    await withPeople(phone, vite.base, [person('c1', 'Cy Phone')])

    await openDevices(mac)
    await mac.locator('[data-link-device]').click()
    const code = (await mac.locator('[data-device-code]').innerText()).trim()
    ok('Mac shows a one-time code', code.startsWith('TWD1~did:peer:2.'))
    await openDevices(phone)
    await phone.locator('[data-enter-code]').click()
    await phone.locator('[data-code-input]').fill('nonsense')
    await phone.locator('[data-code-ok]').click()
    ok('a wrong code is refused in words', await phone.getByText('That is not a device code.').isVisible())
    await phone.locator('[data-code-input]').fill(code)
    await phone.locator('[data-code-ok]').click()
    const fpPhone = await phone.locator('[data-fingerprint]').getAttribute('data-fingerprint')
    const fpMac = await until(() => mac.locator('[data-fingerprint]').getAttribute('data-fingerprint'))
    ok('both devices show the same 4-character fingerprint', /^[0-9A-F]{4}$/.test(fpPhone) && fpPhone === fpMac, `${fpPhone} vs ${fpMac}`)
    await phone.locator('[data-pair-confirm]').click()
    await mac.locator('[data-pair-confirm]').click()
    ok('both list the other device', (await phone.locator('[data-device]').count()) === 1 && (await mac.locator('[data-device]').count()) === 1)

    await phone.locator('[data-sync-now]').click()
    await mac.locator('[data-receive]').waitFor({ timeout: 40_000 })
    ok('Mac is asked first, with the counts', await mac.getByText('1 person, 1 line, 0 resources.').isVisible())
    await mac.locator('[data-receive]').click()
    await phone.locator('[data-receive]').waitFor({ timeout: 40_000 })
    ok('Phone is asked before it merges what Mac sends back', await phone.getByText('3 people, 3 lines, 0 resources.').isVisible())
    await phone.locator('[data-receive]').click()

    const both = ['Ada Mac', 'Bo Mac', 'Cy Phone']
    ok('Mac holds all three', JSON.stringify(await names(mac)) === JSON.stringify(both), JSON.stringify(await names(mac)))
    ok('Phone holds all three', JSON.stringify(await names(phone)) === JSON.stringify(both), JSON.stringify(await names(phone)))
    ok('every note line came along', (await record(phone)).people.every((p) => p.lines.length === 1))
    ok('the relay carried sealed text only', bodies.length > 0 && bodies.every((b) => !/Ada Mac|Bo Mac|Cy Phone|fixes bikes/.test(b)), `${bodies.length} bodies`)
    ok('the log shows progress', (await phone.locator('#dv-log').innerText()).includes('Merged from'))

    await phone.locator('[data-sync-now]').click()
    await mac.locator('[data-receive]').waitFor({ timeout: 40_000 })
    await mac.locator('[data-receive]').click()
    await phone.locator('[data-receive]').waitFor({ timeout: 40_000 })
    await phone.locator('[data-receive]').click()
    ok('a second sync adds nothing and deletes nothing', JSON.stringify(await names(mac)) === JSON.stringify(both) && JSON.stringify(await names(phone)) === JSON.stringify(both))

    await mac.context().close()
    await phone.locator('[data-sync-now]').click()
    ok('a closed device: "not on" in words', await phone.getByText('The other device is not on.').waitFor({ timeout: 45_000 }).then(() => true, () => false))
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `device-sync: ${c.failures} failed` : `device-sync: all passed (${c.passes} checks)`)
  process.exit(c.failures ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
