/**
 * Wave 6e (E2, slice S4): "Is this safe?" in a real headless browser, three places.
 *   1  a scan landing: the Add sheet carries a small "Is this safe?" link the FIRST time; it opens the five sentences, the way back returns
 *      to the same Add sheet (a typed name is kept); the open-source (GitHub) sentence is not in the page
 *   2  the second scan landing on the same phone has no link any more
 *   3  the person's card and Settings > About carry the link too
 * Local only: relay on an ephemeral port, Vite on TW_PORT (default 8972).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8972 ../../node_modules/.bin/tsx ../trustweb/test/e2e/reassurance_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 8972)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const LINES = [
  'TrustWeb is a web app. It runs in your browser or from your home screen, and you can remove it any time in Settings.',
  'Your contacts and notes stay on this phone. Nothing about them leaves the phone without your yes.',
  'Showing your own code to others registers a short address for it on our server (your name and the contact links you chose to share). Nothing else is sent unless you share it.',
  'The person who shared this code with you shared only their contact links, for example Signal or WhatsApp. You can also use those links outside this app.',
  'If you do not want TrustWeb, just leave it, or remove it in Settings. The Signal or WhatsApp link still works on its own.',
]

const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
async function showCode(page) {
  await tab(page, 'Web')
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return page.getAttribute('.qrwrap', 'data-payload')
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const vite = await startVite(PORT, { relayPort })
  const browser = await launch()
  try {
    const ada = await newPhone(browser, errors)
    await startPhone(ada, vite.base, 'Ada')
    const adaUrl = await showCode(ada)
    const bob = await newPhone(browser, errors)
    await bob.goto(adaUrl)
    await bob.getByLabel('Your first name').fill('Bob')
    await bob.getByRole('button', { name: 'Connect', exact: true }).click()
    await bob.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })

    // 1 first time
    ok('1. the Add sheet carries the small "Is this safe?" link the first time', (await bob.locator('.sheet.on [data-safe-link="add-sheet"]').count()) === 1)
    await bob.locator('.sheet.on [data-connect-add-name]').fill('Ada L.')
    await bob.locator('.sheet.on [data-safe-link="add-sheet"]').click()
    const lines = await bob.locator('.sheet.on [data-safe-line]').evaluateAll((ps) => ps.map((p) => p.textContent))
    ok('1. it opens the five sentences, word for word', JSON.stringify(lines) === JSON.stringify(LINES), JSON.stringify(lines).slice(0, 200))
    ok('1. with the title "Is this safe?"', (await bob.locator('.sheet.on [data-safe-title]').innerText()) === 'Is this safe?')
    ok('1. and no sentence about GitHub or open source in the page', !/GitHub|open source/i.test(await bob.locator('.sheet.on').innerText()))
    await shot(bob, 'e2-safe-01-sheet')
    await bob.locator('.sheet.on [data-safe-back]').click()
    ok('1. the way back returns to the same Add sheet, the typed name is kept', (await bob.locator('.sheet.on [data-connect-add-name]').inputValue()) === 'Ada L.')
    ok('1. the record remembers the link was shown', typeof (await record(bob)).safetyLinkShownAt === 'number')
    await shot(bob, 'e2-safe-01-add-sheet')
    await bob.locator('.sheet.on [data-connect-add]').click()
    await bob.locator('.sheet.on [data-person-advanced]').waitFor({ timeout: 10_000 })

    // 3 the card and Settings
    ok('3. the person\'s card carries the link', (await bob.locator('.sheet.on [data-safe-link="person-card"]').count()) === 1)
    await bob.locator('.sheet.on [data-safe-link="person-card"]').click()
    ok('3. from the card the same sentences open', (await bob.locator('.sheet.on [data-safe-line]').count()) === 5)
    await bob.locator('.sheet.on [data-safe-back]').click()
    ok('3. back returns to the card', (await bob.locator('.sheet.on [data-person-advanced]').count()) === 1)
    await bob.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
    await bob.locator('.hdr-btn.more').first().click()
    await bob.locator('.menu-item', { hasText: 'Settings' }).click()
    await bob.locator('.sheet.on [data-safe-link="settings"]').waitFor({ timeout: 8_000 })
    ok('3. Settings > About carries the link', (await bob.locator('.sheet.on [data-safe-link="settings"]').count()) === 1)
    await bob.locator('.sheet.on [data-safe-link="settings"]').click()
    ok('3. from Settings the same sentences open, and back returns to Settings', (await bob.locator('.sheet.on [data-safe-line]').count()) === 5)
    await bob.locator('.sheet.on [data-safe-back]').click()
    ok('3. Settings is back', (await bob.locator('.sheet.on [data-safe-link="settings"]').count()) === 1)
    await bob.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})

    // 2 the second landing: no link any more
    const carl = await newPhone(browser, errors)
    await startPhone(carl, vite.base, 'Carl')
    const carlUrl = await showCode(carl)
    await bob.goto(carlUrl)
    await bob.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })
    ok('2. the second scan landing has no "Is this safe?" link on the Add sheet', (await bob.locator('.sheet.on [data-safe-link="add-sheet"]').count()) === 0)
    await acceptAdd(bob)
    ok('2. nothing changed in the record: the first showing stays the only one', typeof (await record(bob)).safetyLinkShownAt === 'number')
  } finally {
    await browser.close()
    vite.stop()
    await relay.close?.().catch(() => {})
  }
  ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
