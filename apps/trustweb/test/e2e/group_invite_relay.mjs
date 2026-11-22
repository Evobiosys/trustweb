// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list, end to end over a real RelayServer behind the Vite /relay proxy (two phones, stock data only):
 *   1. Ina: Chat > New group "Flat", Active list: adds "Milk"; Invite opens the sheet for just this group; the personal link.
 *   2. Anna opens it: the confirmation names Ina and "Flat"; Join connects; Anna's phone holds the group (no community tag), with Ina as member,
 *      the list and "Milk" (sent by Ina's phone when it admitted her); Ina's phone holds Anna as member, a join line in the chat.
 *   3. Anna writes in the group: Ina's phone has it; Anna checks Milk: Ina's phone has it checked by Anna, and the quiet line.
 *   4. Nothing of the group travels in clear over the relay.
 * Run from apps/demo:  PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<headless shell> TW_PORT=5477 ../../node_modules/.bin/tsx ../trustweb/test/e2e/group_invite_relay.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 5477)
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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `group-chat-list-relay-${name}-${VIEW.width}.png`) }) }
const groupOf = async (page) => Object.values((await record(page)).chatGroups ?? {})[0]
const home = (page) => page.locator('.sheet.on .sheet-home').click().catch(() => {})

async function main() {
  const tap = []
  const relay = await startRelay({ port: PORT, tap })
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log(`group-chat-list relay against ${vite.base} at ${VIEW.width}x${VIEW.height}`)
  const browser = await launch()
  try {
    const ina = await newPhone(browser, errors, { viewport: VIEW })
    const ann = await newPhone(browser, errors, { viewport: VIEW })
    for (const p of [ina, ann]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(ina, vite.base, 'Ina')
    await startPhone(ann, vite.base, 'Anna')

    // 1. Ina makes the group, a list item, the invite
    await ina.locator('button.tab[data-go="chat"]').first().click(); await ina.waitForTimeout(400)
    await ina.locator('[data-group-new]').click()
    await ina.locator('[data-group-new-name]').fill('Flat'); await ina.locator('[data-group-create]').click()
    await ina.locator('[data-group-chat]').waitFor({ timeout: 10_000 })
    const gid = (await groupOf(ina))?.id
    ok('1. Ina: New group "Flat" opens its chat', !!gid)
    await ina.locator('[data-group-active-list]').click()
    await ina.locator('[data-group-add-text]').fill('Milk'); await ina.locator('[data-group-add-text]').press('Enter')
    await ina.waitForTimeout(300)
    ok('1. Ina: "Milk" on the active list', (await groupOf(ina)).li.some((i) => i.text === 'Milk'))
    await ina.locator('[data-group-back]').click()
    await ina.locator('[data-group-invite]').click()
    await ina.locator(`[data-invite-sheet="grp:${gid}"]`).waitFor({ timeout: 10_000 })
    ok('1. Invite: the sheet for just this group', /Invite to Flat/.test(await ina.locator('[data-invite-sheet] h3').innerText()))
    await ina.locator('[data-invite-qr-personal-btn]').click()
    const box = ina.locator('[data-invite-qr-personal]')
    await box.locator('canvas, svg, img').first().waitFor({ timeout: 15_000 })
    const link = (await box.getAttribute('data-link')).replace(/^https?:\/\/[^/]+\//, vite.base)
    await home(ina)

    // 2. Anna joins through the link
    await ann.goto(link)
    await ann.locator('[data-invite-accept]').waitFor({ timeout: 20_000 })
    ok('2. the confirmation names Ina and the group', /Ina invites you to Flat\./.test(await ann.locator('[data-invite-accept]').innerText()))
    await ann.locator('[data-invite-accept-join]').click()
    await acceptAdd(ann).catch(() => {})
    const annG = await until(async () => { const g = await groupOf(ann); return g?.li?.some((i) => i.text === 'Milk') ? g : null })
    ok('2. Anna\'s phone holds "Flat" with its list and Milk (from Ina\'s phone)', !!annG && annG.name === 'Flat' && annG.lists.length === 1, JSON.stringify(await groupOf(ann)))
    const ar = await record(ann)
    const inaOnAnn = ar.people.find((p) => p.name === 'Ina')
    ok('2. Ina is a member on Anna\'s phone; no community tag was made', !!inaOnAnn && annG?.mem?.[inaOnAnn.id]?.on === true && !Object.keys(inaOnAnn.fields ?? {}).some((k) => k.startsWith('grp')))
    const inaG = await until(async () => { const g = await groupOf(ina); return Object.values(g.mem).some((m) => m.name === 'Anna' && m.on) ? g : null })
    ok('2. Ina\'s phone holds Anna as member, a join line in the chat', !!inaG && inaG.items.some((i) => i.k === 'join' && i.by === 'Anna'), JSON.stringify(await groupOf(ina)))

    // 3. Anna writes and checks
    await ann.locator('button.tab[data-go="chat"]').first().click(); await ann.waitForTimeout(400)
    await ann.locator(`[data-group-row="${gid}"]`).click()
    await ann.locator('[data-group-text]').fill('I will buy it')
    await ann.locator('[data-group-send]').click()
    const got = await until(async () => (await groupOf(ina)).items.find((i) => i.k === 'msg' && i.text === 'I will buy it'))
    ok('3. Ina\'s phone has Anna\'s message, by Anna', got?.by === 'Anna', JSON.stringify(got))
    await ann.locator('[data-group-active-list]').click()
    const milk = annG?.li.find((i) => i.text === 'Milk')?.id
    await ann.locator(`[data-group-check="${milk}"]`).check()
    const done = await until(async () => { const g = await groupOf(ina); return g.li.find((i) => i.id === milk)?.done?.by === 'Anna' && g.items.some((i) => i.k === 'check' && i.by === 'Anna') })
    ok('3. Ina\'s phone: Milk checked by Anna, and the quiet line', !!done, JSON.stringify((await groupOf(ina)).li))
    await shot(ann, 'list')
    await ina.locator('button.tab[data-go="chat"]').first().click(); await ina.waitForTimeout(300)
    await ina.locator(`[data-group-row="${gid}"]`).click(); await ina.waitForTimeout(300)
    await shot(ina, 'chat')

    // 4. sealed
    ok('4. nothing of the group in clear on the relay', tap.length > 0 && tap.every((w) => !w.wire.includes('I will buy it') && !w.wire.includes('Milk') && !w.wire.includes('"gg"')))
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
  }
  console.log(`${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}
await main()
