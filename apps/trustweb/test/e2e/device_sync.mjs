/**
 * Device sync (wave 7), two browser profiles = two devices, a real RelayServer behind the Vite /relay proxy:
 *   1. Mac holds Ada and Bo, Phone holds Cy. Mac shows a code, Phone enters it, both show the SAME 4 characters, both Confirm.
 *   2. Phone "Sync now": Mac is asked "Receive 1 person ...?" and merges; Mac sends its record back; Phone asks and merges.
 *   3. Both end with Ada, Bo, Cy; nothing deleted; no relay request body contains a name (all sealed).
 *   4. A second Sync now with nothing new changes nothing; "Sync now" to a closed device says it is not on.
 *   Wave 13: events, my messenger link and chat text travel too; a local snapshot exists on both before the merge; the "Also save an
 *   encrypted file" box offers a .twb download; a chat whose connection only the Mac has stays reachable on the Phone; two persons
 *   with one name are listed as possible duplicates and "Same person" makes them one (sameAs written).
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

async function withPeople(page, base, people, extra = {}) {
  await page.evaluate(([ps, more]) => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.people = ps; Object.assign(s, more); localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) }, [people, extra])
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
    const macExtra = {
      myChannels: { signal: 'https://signal.me/#eu/abcdEFGH1234' },
      events: [{ id: 'ev1', name: 'Bike meetup', from: '2026-10-01', where: 'Vienna', createdAt: 1, attended: true }],
      // Wave 15: the Mac holds the public link + username; the localhost origin is no app origin, so the service is not asked (the record carries it).
      connectCode: { code: 'A'.repeat(22), secret: 'S'.repeat(43), url: 'https://app.trustweb.one/?connect=did%3Apeer%3A2.' + 'z'.repeat(40), updatedAt: 1, name: 'ada' },
      chats: { 'mac-only-peer': { unread: 1, messages: [{ key: 'i:5:x', dir: 'in', text: 'hello from a mac-only connection', at: 5, sentAt: 5, state: 'received' }] } },
    }
    await withPeople(mac, vite.base, [person('a1', 'Ada Mac'), person('b1', 'Bo Mac')], macExtra)
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
    ok('the confirm sheet offers "Also share my username and public link", ticked', await phone.locator('[data-share-code]').isChecked())
    await phone.locator('[data-pair-confirm]').click()
    await mac.locator('[data-pair-confirm]').click()
    ok('both list the other device', (await phone.locator('[data-device]').count()) === 1 && (await mac.locator('[data-device]').count()) === 1)

    await phone.locator('[data-sync-now]').click()
    await mac.locator('[data-receive]').waitFor({ timeout: 40_000 })
    ok('Mac is asked first, with the counts', await mac.getByText('1 person, 1 line, 0 resources, 0 meetings, 0 events, 0 messages.').isVisible())
    const download = mac.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
    await mac.locator('[data-also-file]').evaluate((e) => e.click())
    await mac.locator('[data-receive]').click()
    ok('"Also save an encrypted file" downloads a .twb', (await download)?.suggestedFilename().endsWith('.twb') === true)
    await phone.locator('[data-receive]').waitFor({ timeout: 40_000 })
    ok('Phone is asked before it merges what Mac sends back', await phone.getByText('3 people, 3 lines, 0 resources, 0 meetings, 1 event, 1 message.').isVisible())
    await phone.locator('[data-receive]').click()
    const adopted = await until(async () => (await record(phone)).connectCode)
    ok('Wave 15: the Phone adopted the Mac\'s public link as a record of another device (the keeper leaves it alone)', adopted?.owner === 'other' && adopted.name === 'ada' && adopted.code === 'A'.repeat(22), JSON.stringify({ code: adopted?.code, owner: adopted?.owner, name: adopted?.name }))
    ok('Wave 15: My devices shows "My username" and where the link opens', (await phone.locator('[data-un-opens]').innerText()).includes('trustweb.one/ada opens on') && (await phone.locator('[data-un-name="ada"]').count()) === 1)

    const both = ['Ada Mac', 'Bo Mac', 'Cy Phone']
    ok('Mac holds all three', JSON.stringify(await names(mac)) === JSON.stringify(both), JSON.stringify(await names(mac)))
    ok('Phone holds all three', JSON.stringify(await names(phone)) === JSON.stringify(both), JSON.stringify(await names(phone)))
    ok('every note line came along', (await record(phone)).people.every((p) => p.lines.length === 1))
    ok('the relay carried sealed text only', bodies.length > 0 && bodies.every((b) => !/Ada Mac|Bo Mac|Cy Phone|fixes bikes/.test(b)), `${bodies.length} bodies`)
    const pr = await record(phone)
    ok('Phone got the event, the Signal link and the chat text', pr.events?.length === 1 && pr.myChannels?.signal?.endsWith('abcdEFGH1234') && pr.chats?.['mac-only-peer']?.messages.length === 1, JSON.stringify([pr.events, pr.myChannels]))
    ok('a local snapshot was taken before the merge on both devices', JSON.parse(await mac.evaluate(() => localStorage.getItem('trustweb.v1.me:snapshots'))).length >= 1 && JSON.parse(await phone.evaluate(() => localStorage.getItem('trustweb.v1.me:snapshots'))).length >= 1)
    ok('a chat with a connection only the Mac has stays reachable', (await phone.locator('[data-orphan-chat]').count()) === 1)
    ok('the log shows progress', (await phone.locator('#dv-log').innerText()).includes('Merged from'))

    await phone.locator('[data-sync-now]').click()
    await mac.locator('[data-receive]').waitFor({ timeout: 40_000 })
    await mac.locator('[data-receive]').click()
    await phone.locator('[data-receive]').waitFor({ timeout: 40_000 })
    await phone.locator('[data-receive]').click()
    ok('a second sync adds nothing and deletes nothing', JSON.stringify(await names(mac)) === JSON.stringify(both) && JSON.stringify(await names(phone)) === JSON.stringify(both))

    // A new device with no record at all: "Already use TrustWeb on another device? Link it" on the welcome screen, then the first sync.
    const fresh = await newPhone(browser, errors)
    await fresh.goto(vite.base)
    await fresh.locator('[data-link-from-start]').click()
    await fresh.locator('[data-enter-code]').click()
    await mac.locator('[data-link-device]').click()
    const code2 = (await mac.locator('[data-device-code]').innerText()).trim()
    await fresh.locator('[data-code-input]').fill(code2)
    await fresh.locator('[data-code-ok]').click()
    await fresh.locator('[data-pair-confirm]').waitFor({ timeout: 20_000 })
    await until(() => mac.locator('[data-pair-confirm]').isVisible())
    await mac.locator('[data-pair-confirm]').click()
    await fresh.locator('[data-pair-confirm]').click()
    await mac.locator('[data-sync-now]').last().click()
    await fresh.locator('[data-receive]').waitFor({ timeout: 40_000 })
    await fresh.locator('[data-receive]').click()
    const fr = await until(async () => { const r = await record(fresh); return r?.people?.length === 3 ? r : null })
    ok('a device with no record links from the welcome screen and receives everything', !!fr && fr.events?.length === 1 && !!fr.myChannels?.signal, JSON.stringify(fr?.people?.length))
    ok('its first snapshot (of the empty record) exists', JSON.parse(await fresh.evaluate(() => localStorage.getItem('trustweb.v1.me:snapshots'))).length === 1)

    await mac.context().close()
    await phone.locator('[data-sync-now]').click()
    ok('a closed device: "not on" in words', await phone.getByText('The other device is not on.').waitFor({ timeout: 45_000 }).then(() => true, () => false))
    await withPeople(phone, vite.base, [...(await record(phone)).people, person('c2', 'cy phone')])
    // The relay may hand the reloaded page an older wire again; the person just says "Not now".
    if (await phone.locator('[data-receive]').waitFor({ timeout: 3_000 }).then(() => true, () => false)) await phone.getByRole('button', { name: 'Not now' }).click()
    else await openDevices(phone)
    await phone.locator('[data-open-review]').click()
    ok('two persons with one name are listed as possible duplicates', (await phone.locator('[data-duplicate]').count()) === 1)
    await phone.locator('[data-duplicate] button').click()
    await phone.locator('[data-same-keep]').first().click()
    const after = await until(async () => { const r = await record(phone); return r.sameAs && r.people.filter((p) => /cy phone/i.test(p.name)).length === 1 ? r : null })
    ok('"Same person" made them one and wrote sameAs', !!after && Object.keys(after.sameAs).length === 1, JSON.stringify(after?.sameAs))
    ok('a snapshot was taken before it', JSON.parse(await phone.evaluate(() => localStorage.getItem('trustweb.v1.me:snapshots'))).some((e) => e.reason === 'before merging two people'))
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
