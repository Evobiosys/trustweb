/**
 * Web Curator v5 proof (dev only, LIVE Tana for the ring sync): needs the 5191 dev server with Jakob's record and token.
 * FAKE_TANA=1 answers Tana itself (no live write; the counts still show what would be sent). Counts the ring writes (set_field_option "ring" + "ring approved") a fresh profile pushes, then, with Tana sync off, checks the ring
 * chooser (X, Show advanced, confirm sheet), the intending lock and the merge sheet with its undo.
 *   node test/e2e/curator_v5.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const profile = mkdtempSync(path.join(tmpdir(), 'curator-v5-'))
const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, args: ['--use-mock-keychain', '--password-store=basic'] })
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const writes = { ring: 0, approvedOpen: 0, approvedTicked: 0, other: 0 }
page.on('request', (r) => {
  const b = r.url().includes(':8262') ? r.postData() ?? '' : ''
  if (!b.includes('tools/call')) return
  if (b.includes('rVfw62lb7BYD')) writes.ring++
  else if (b.includes('_7wgarGd90ZR')) b.includes('[X]') ? writes.approvedTicked++ : writes.approvedOpen++
  else writes.other++
})
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' }
const fakeTana = (route) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: cors })
  : route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json', 'mcp-session-id': 'fake' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }) })
if (process.env.FAKE_TANA) await page.route('http://127.0.0.1:8262/**', fakeTana)
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb-crm.v1.prefs') ?? '{}'))

try {
  await page.goto('http://127.0.0.1:5191/')
  await page.getByRole('searchbox').waitFor()
  for (let i = 0; i < 90; i++) { if ((await prefs()).queue?.length === 0 && writes.ring > 0) break; await page.waitForTimeout(2000) }
  const p = await prefs()
  console.log(`TANA RING WRITES: ring ${writes.ring} | approved [ ] ${writes.approvedOpen} | approved [X] ${writes.approvedTicked} | other writes ${writes.other} | queue left ${p.queue.length}`)
  check('suggested rings written to Tana with approved [ ], queue empty', writes.ring > 200 && writes.ring === writes.approvedOpen && p.queue.length === 0)

  // Tana sync off from here: no live writes for the UI checks.
  await page.evaluate(() => { const k = 'trustweb-crm.v1.prefs'; const v = JSON.parse(localStorage.getItem(k)); v.pkms = []; v.autoSync = false; localStorage.setItem(k, JSON.stringify(v)) })
  await page.reload()
  await page.getByRole('searchbox').waitFor()

  await page.getByRole('searchbox').fill('a')
  const row = page.locator('.person-row:has(.ring-label.suggested)').first()
  const name = await row.locator('strong').innerText()
  await row.locator('.ring-label').click()
  const pop = page.locator('[data-part="ring-pop"]')
  check('chooser opens with an X', (await pop.count()) === 1 && (await pop.locator('[data-action="ring-close"]').count()) === 1)
  await pop.locator('[data-action="ring-close"]').click()
  check('X closes without changing the ring', (await pop.count()) === 0)
  await row.locator('.ring-label').click()
  await pop.locator('[data-action="ring-advanced"]').click()
  const adv = pop.locator('[data-part="ring-advanced"]')
  check('Show advanced unfolds Deceased, famous, hide, family, desire', (await adv.locator('[data-field="__XNQ42Dtiwx"], [data-field="6QzDHIfrlmSz"], [data-field="4J9bhDw1UdTj"], [data-field="LNlpliq4GdNI"], [data-field="UAfC4PcYo2po"]').count()) === 5)
  await adv.locator('[data-field="LNlpliq4GdNI"] input').check()
  check('a field set in place (family)', (await adv.locator('[data-field="LNlpliq4GdNI"] input').isChecked()) && (await pop.locator('.family-dot, [data-part="family"]').count()) + (await row.locator('[data-part="family"]').count()) >= 1)
  await adv.locator('[data-field="LNlpliq4GdNI"] input').uncheck()
  await pop.locator('[data-action="ring-delete"]').click()
  check('Delete asks first', (await pop.locator('[data-part="ring-sheet"]').count()) === 1)
  await pop.locator('[data-action="ring-cancel"]').click()
  check('Cancel keeps the person', (await page.locator(`.person-row:has-text("${name}")`).count()) >= 1)
  check('Untag hidden while Tana sync is off', (await pop.locator('[data-action="ring-untag"]').count()) === 0)

  // Intending lock: a person with a note line / first-met sees no 0-10 scale.
  await page.getByRole('searchbox').fill('')
  await page.locator('.person-row strong').first().click()
  const lockedOrScale = (await page.locator('[data-part="intending-locked"]').count()) + (await page.locator('[data-part="intending"]').count())
  check('intending block shows either the scale or the "already in contact" line', lockedOrScale === 1)

  // Merge: two people, sheet, merge, undo.
  await page.locator('.back').click()
  await page.getByRole('searchbox').fill('a')
  const names = await page.locator('.person-row strong').allInnerTexts()
  const [a, b] = [names[0], names[1]]
  await page.locator(`.person-row:has-text("${a}") strong`).first().click()
  await page.locator('[data-action="merge-open"]').click()
  await page.locator('[data-field="merge-search"]').fill(b)
  await page.locator('[data-action="merge-pick"]').first().click()
  check('merge sheet shows keep choice and Merge', (await page.locator('[data-part="merge-sheet"] [data-action="merge-keep"]').count()) === 2 && (await page.locator('[data-action="merge-go"]').count()) === 1)
  await page.locator('[data-action="merge-go"]').click()
  check('toast with Undo after the merge', (await page.locator('[data-part="merge-toast"]').count()) === 1)
  await page.locator('[data-action="merge-undo"]').click()
  check('Undo removes the toast', (await page.locator('[data-part="merge-toast"]').count()) === 0)
  await page.locator('.back').click()
  await page.getByRole('searchbox').fill(b.slice(0, 4))
  check(`the merged-away person is back after Undo (${b})`, (await page.locator(`.person-row:has-text("${b}")`).count()) >= 1)

  // A ring the person sets goes to Tana with approved [X]. Tana is faked here (no live write for a real person).
  {
    if (!process.env.FAKE_TANA) await page.route('http://127.0.0.1:8262/**', fakeTana)
    await page.evaluate(() => { const k = 'trustweb-crm.v1.prefs'; const v = JSON.parse(localStorage.getItem(k)); v.pkms = ['tana']; v.autoSync = true; localStorage.setItem(k, JSON.stringify(v)) })
    await page.reload()
    await page.getByRole('searchbox').fill('a')
    const row = page.locator('.person-row:has(.ring-label:not(.suggested))').first()
    await row.locator('.ring-label').click()
    const before = { ...writes }
    await row.locator('.rchip[aria-pressed="true"]').first().click()
    await page.waitForTimeout(6000)
    check('a tapped ring writes the ring option and approved [X]', writes.ring === before.ring + 1 && writes.approvedTicked === before.approvedTicked + 1)
  }
} catch (e) {
  console.log('ERROR', e.message)
  failed = true
}
check('0 page errors', errors.length === 0)
if (errors.length) console.log(errors)
await ctx.close()
process.exit(failed ? 1 : 0)
