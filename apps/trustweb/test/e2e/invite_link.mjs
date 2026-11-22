// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-invite-link: the community invite links. Three phones (360x780, TW_WIDE=1 -> 1280x900), a real RelayServer behind the Vite
 * /relay proxy, stock data only:
 *   1. Ina: Community > Members > Invite: the sheet with Personal and Open, each Copy + QR; Advanced shows max uses 10 and 30 days.
 *   2. Anna opens the personal link: the confirmation names Ina and the community and says "Only accept if Ina sent you this"; Join
 *      connects; Ina holds Anna tagged with the community, Anna holds Ina tagged and has joined it. No token on the relay in clear.
 *   3. Anna opens the personal link again: refused on her phone ("already used"), nothing sent.
 *   4. Ben opens the same personal link: Ina refuses it (counter: used), adds nobody, says so.
 *   5. Ben opens the open link: joins; the sheet counts "Used 1 of 10".
 * Run from apps/demo (PORT 5296):
 *   PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=5296 ../../node_modules/.bin/tsx ../trustweb/test/e2e/invite_link.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 5296)
const SHOTS = process.env.TW_SHOTS
const VIEW = process.env.TW_WIDE ? { width: 1280, height: 900 } : { width: 360, height: 780 }
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 30_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `steer-invite-link-${name}-${VIEW.width}.png`) }) }
const bodyText = (page) => page.locator('body').innerText().catch(() => '')
const TAGS = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }]

async function openMembers(page) {
  await page.locator('[data-mode="community"]').click()
  await page.locator('[data-community]').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(400)
  if (VIEW.width < 900) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) }
  await page.locator('[data-community-nav="members"]').click()
  await page.waitForTimeout(300)
}

async function linkFrom(page, kind, base) {
  await page.locator(`[data-invite-qr-${kind}-btn]`).click()
  const box = page.locator(`[data-invite-qr-${kind}]`)
  await box.locator('canvas, svg, img').first().waitFor({ timeout: 15_000 })
  return (await box.getAttribute('data-link')).replace(/^https?:\/\/[^/]+\//, base)
}

async function main() {
  const tap = []
  const relay = await startRelay({ port: PORT, tap })
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log(`steer-invite-link against ${vite.base} at ${VIEW.width}x${VIEW.height}`)
  const browser = await launch()
  try {
    const ina = await newPhone(browser, errors, { viewport: VIEW })
    const ann = await newPhone(browser, errors, { viewport: VIEW })
    const ben = await newPhone(browser, errors, { viewport: VIEW })
    for (const p of [ina, ann, ben]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(ina, vite.base, 'Ina')
    await startPhone(ann, vite.base, 'Anna')
    await startPhone(ben, vite.base, 'Ben')
    await ina.evaluate((t) => {
      const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
      r.extData = { ...r.extData, 'community-mighty': { tag: 'iyg' } }
      localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
      localStorage.setItem('trustweb.v1.colourtags', t)
    }, JSON.stringify(TAGS))
    await ina.reload()
    await ina.waitForTimeout(1200)
    const inaDid = (await record(ina)).identity?.did

    // 1. the sheet
    await openMembers(ina)
    ok('1. Members shows the Invite control', (await ina.locator('[data-community-invite]').count()) === 1)
    await shot(ina, 'members')
    await ina.locator('[data-community-invite]').click()
    await ina.locator('[data-invite-sheet="iyg"]').waitFor({ timeout: 10_000 })
    const sheet = await ina.locator('[data-invite-sheet]').innerText()
    ok('1. sheet: Personal invite (only for one person) and Open invite (can be passed on)', /Personal invite \(only for one person\)/.test(sheet) && /Open invite \(can be passed on\)/.test(sheet), sheet.slice(0, 160))
    ok('1. each has Copy and QR', (await ina.locator('[data-invite-copy-personal], [data-invite-copy-open], [data-invite-qr-personal-btn], [data-invite-qr-open-btn]').count()) === 4)
    // wave45 invite-qr-same: both QRs are on the sheet at once, the same .qrwrap component as the top-of-page share QR, payload = the signed link
    for (const k of ['personal', 'open']) {
      const q = ina.locator(`.qrwrap[data-invite-qr-${k}]`)
      await q.locator('canvas').waitFor({ timeout: 15_000 })
      ok(`1. ${k} QR shows without a tap, as .qrwrap, payload is the #inv link`, /#inv=/.test((await q.getAttribute('data-payload')) ?? '') && (await q.getAttribute('data-payload')) === (await q.getAttribute('data-link')))
    }
    const personal = await linkFrom(ina, 'personal', vite.base)
    const open = await linkFrom(ina, 'open', vite.base)
    ok('1. both links carry the QR key and the token in the fragment', [personal, open].every((l) => new URL(l).searchParams.get('k') && /^#inv=/.test(new URL(l).hash)) && personal !== open)
    await ina.locator('[data-invite-advanced]').click()
    ok('1. Advanced: max uses 10, days 30, revoke all', (await ina.locator('[data-invite-max]').inputValue()) === '10' && (await ina.locator('[data-invite-days]').inputValue()) === '30' && (await ina.locator('[data-invite-revoke]').count()) === 1)
    ok('1. the open link counts "Used 0 of 10"', /Used 0 of 10/.test(await ina.locator('[data-invite-open-status]').innerText().catch(() => '')))
    await shot(ina, 'sheet')
    await ina.locator('.sheet.on .sheet-home').click().catch(() => {})
    ok('1. no document scroll', await ina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

    // 2. Anna accepts the personal link
    await ann.goto(personal)
    await ann.locator('[data-invite-accept]').waitFor({ timeout: 20_000 })
    const lead = await ann.locator('[data-invite-accept]').innerText()
    ok('2. the confirmation: "Ina invites you to IYG." + "Only accept if Ina sent you this."', /Ina invites you to IYG\./.test(lead) && /Only accept if Ina sent you this\./.test(lead), lead.slice(0, 160))
    ok('2. nothing sent before Join', !tap.some((w) => w.to === inaDid))
    await ann.waitForTimeout(600)
    await shot(ann, 'accept')
    await ann.locator('[data-invite-accept-join]').click()
    await acceptAdd(ann).catch(() => {})
    const annOnIna = await until(async () => (await record(ina)).people.find((p) => p.name === 'Anna' && String(p.fields?.iyg) === 'true'))
    ok('2. Ina holds Anna, tagged IYG', !!annOnIna, JSON.stringify((await record(ina)).people.map((p) => [p.name, p.fields])))
    const ar = await record(ann)
    const inaOnAnn = ar.people.find((p) => p.name === 'Ina')
    ok('2. Anna holds Ina tagged with the community, and joined it', String(inaOnAnn?.fields?.iyg) === 'true' && (ar.zoneTags?.self?.ids ?? Object.values(ar.zoneTags ?? {})[0]?.ids ?? []).includes('iyg'), JSON.stringify({ f: inaOnAnn?.fields, z: ar.zoneTags }))
    const tok = new URL(personal).hash.slice(5)
    ok('2. the token never travels in clear over the relay', tap.every((w) => !w.wire.includes(tok.slice(0, 30))))
    const inaRec = await record(ina)
    ok('2. Ina\'s counter: the personal link used by one', inaRec.invites?.some((e) => e.kind === 'personal' && e.uses.length === 1))
    await shot(ann, 'joined')

    // 3. Anna again
    await ann.goto(personal)
    const again = await until(async () => /already used/.test(await bodyText(ann)), 15_000)
    ok('3. Anna: the same link again is refused on her phone', !!again, (await bodyText(ann)).slice(0, 120))
    ok('3. no confirmation shown, nothing sent', (await ann.locator('[data-invite-accept]').count()) === 0)
    await shot(ann, 'refused-again')

    // 4. Ben with the same personal link
    await ben.goto(personal)
    await ben.locator('[data-invite-accept-join]').click({ timeout: 20_000 })
    await acceptAdd(ben).catch(() => {})
    const refused = await until(async () => /already used/.test(await bodyText(ina)), 25_000)
    ok('4. Ina refuses Ben on the used personal link, with a notice', !!refused, (await bodyText(ina)).slice(0, 160))
    ok('4. Ina added nobody', !(await record(ina)).people.some((p) => p.name === 'Ben') && !(await record(ina)).peers.some((p) => p.displayName === 'Ben'))
    await shot(ina, 'refused-used')

    // 5. Ben with the open link
    await ben.goto(open)
    await ben.locator('[data-invite-accept-join]').click({ timeout: 20_000 })
    await acceptAdd(ben).catch(() => {})
    const benOnIna = await until(async () => (await record(ina)).people.find((p) => p.name === 'Ben' && String(p.fields?.iyg) === 'true'))
    ok('5. the open link: Ina holds Ben, tagged IYG', !!benOnIna)
    await ina.locator('.sheet.on .sheet-home').click().catch(() => {})
    await ina.locator('[data-community-invite]').click()
    ok('5. the sheet counts "Used 1 of 10"', !!(await until(async () => /Used 1 of 10/.test(await ina.locator('[data-invite-open-status]').innerText()), 5_000)))
    await shot(ina, 'used-1')

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
