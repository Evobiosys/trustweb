// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 offline-outbox: Settings > Pending on a 360x780 phone and a 1280x900 laptop, stock data only.
 *   1. A waiting item shows "Sent when you are online", a sent one "Sent"; both survive a reload (kept in the record).
 *   2. The rows fit the 360 screen.
 * Run: PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<chrome-headless-shell> TW_PORT=5482 tsx offline_outbox.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5482)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const dismiss = (page) => page.locator('.sheet.on button', { hasText: 'Not now' }).first().click({ timeout: 2500 }).catch(() => {})

async function openSettings(page) {
  await dismiss(page)
  await page.evaluate(() => localStorage.setItem('trustweb.ui.settings.outbox', '1'))
  await page.locator('.hdr [aria-label="Settings"]').first().click()
  await page.locator('[data-settings-section="outbox"]').waitFor({ state: 'attached', timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
}

async function main() {
  const relay = await startRelay({ port: PORT })
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log('offline-outbox against ' + vite.base)
  const browser = await launch()
  try {
    for (const [label, viewport] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
      const page = await newPhone(browser, errors, { viewport })
      await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
      await startPhone(page, vite.base, 'Jakob')
      await page.evaluate(() => {
        const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
        const now = Date.now()
        r.peers = [{ id: 'probe-peer', did: 'did:key:probe', displayName: 'Probe Pal', ring: 3, connectedAt: now }]
        r.sendQueue = [
          { id: 'w1', peerId: 'probe-peer', kind: 'text', env: { v: 1, t: 'chat', text: 'x' }, queuedAt: now - 2000, tries: 2, nextAt: now + 3_600_000, state: 'waiting' },
          { id: 's1', peerId: 'probe-peer', kind: 'event', env: { v: 1 }, queuedAt: now - 5000, tries: 0, nextAt: now, state: 'sent', sentAt: now - 1000 },
        ]
        localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
      })
      await page.reload(); await page.waitForTimeout(1500)
      await openSettings(page)
      const waiting = page.locator('[data-outbox-row="w1"]')
      const sent = page.locator('[data-outbox-row="s1"]')
      ok(`${label}: the waiting item says "Sent when you are online"`, (await waiting.count()) === 1 && (await waiting.innerText()).includes('Sent when you are online') && (await waiting.innerText()).includes('Probe Pal'))
      ok(`${label}: the sent item says "Sent"`, (await sent.count()) === 1 && /\bSent\b/.test(await sent.innerText()) && !(await sent.innerText()).includes('online'))
      const box = await waiting.boundingBox()
      ok(`${label}: the row fits the screen`, !!box && box.x >= 0 && box.x + box.width <= viewport.width + 1, JSON.stringify(box))
      await waiting.scrollIntoViewIfNeeded()
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `offline-outbox-${label}.png`) })
      await page.reload(); await page.waitForTimeout(1500)
      const kept = (await record(page)).sendQueue ?? []
      ok(`${label}: both items survive a reload`, kept.some((x) => x.id === 'w1' && x.state === 'waiting') && kept.some((x) => x.id === 's1'))
    }
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
  }
  console.log(`\n${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
