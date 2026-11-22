// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list (headless, stock dev server, synthetic record): Chat lists the group "Flat" on top (unread dot) and offers New group;
 * the group sheet shows the members (V expander), Active list and Invite; a message sent lands in the thread; Active list opens the list sheet:
 * check an item (who, when; a quiet line in the chat), add one inline (Enter), move it up, Archive done, + list and Make this the active list;
 * Invite opens the invite sheet titled with the group; New group creates "Choir". No document scroll, the header chips never overlap.
 * 360x780 and 1280x900.
 * PORT=5477 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node group_chat_list.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5477}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const people = [{ id: 'b', name: 'Ben Gruber', context: '', ring: 'friend', metAt: 1, lines: [], peerId: 'peer-b' }]
const flat = {
  id: 'g1', name: 'Flat', at: 1, unread: 1,
  mem: { me: { name: '', on: true, at: 1 }, b: { name: 'Ben Gruber', on: true, at: 2 }, 'n:cleo': { name: 'Cleo', on: true, at: 3 } },
  items: [{ m: 'a1', k: 'join', by: 'Ben Gruber', ts: 1_000, at: 1_000 }, { m: 'a2', k: 'msg', by: 'Ben Gruber', ts: 2_000, at: 2_000, text: 'Who buys milk?' }],
  lists: [{ id: 'l1', name: 'Shopping & errands', u: 1 }, { id: 'l2', name: 'Hardware', u: 1 }], active: { id: 'l1', u: 1 },
  li: [{ id: 'i1', l: 'l1', text: 'Milk', o: 1, u: 1, by: 'Ben Gruber' }, { id: 'i2', l: 'l1', text: 'Bread', o: 2, u: 1, by: 'Ben Gruber' }],
}
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [{ id: 'peer-b', displayName: 'Ben' }], log: [], inventory: [], people, chatGroups: { g1: flat } }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const overlap = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); sessionStorage.clear() }, JSON.stringify(record))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('button.tab[data-go="chat"]').first().click(); await page.waitForTimeout(500)
    const row = page.locator('[data-group-row="g1"]')
    check(`${w}: Chat lists the group on top, with its unread dot`, (await row.count()) === 1 && (await row.locator('.dot').count()) === 1 && /Who buys milk/.test(await row.textContent()))
    check(`${w}: New group sits next to New message`, (await page.locator('[data-group-new]').count()) === 1 && (await page.locator('[data-chat-new]').count()) === 1)
    if (w === 360) await page.screenshot({ path: `${SHOTS}/group-chat-list-chats-${w}.png` })
    await row.click(); await page.waitForTimeout(400)
    const sheet = page.locator('[data-group-chat="g1"]')
    check(`${w}: the group's chat opens, read`, (await sheet.count()) === 1 && (await rec(page)).chatGroups.g1.unread === 0)
    const toggle = sheet.locator('[data-group-members-toggle]')
    check(`${w}: "3 members" with the names behind the V`, /3 members/.test(await toggle.textContent()) && (await sheet.locator('[data-group-members]').isHidden()))
    await toggle.click(); await page.waitForTimeout(150)
    const names = await sheet.locator('[data-group-members]').textContent()
    check(`${w}: members: me, Ben, Cleo`, ['Ana (you)', 'Ben Gruber', 'Cleo'].every((n) => names.includes(n)), names)
    const [b1, b2, b3] = await Promise.all(['[data-group-members-toggle]', '[data-group-active-list]', '[data-group-invite]'].map((s) => sheet.locator(s).boundingBox()))
    check(`${w}: the header controls never overlap and stay inside the screen`, !overlap(b1, b2) && !overlap(b2, b3) && !overlap(b1, b3) && [b1, b2, b3].every((b) => b && b.x >= 0 && b.x + b.width <= w + 1))
    await sheet.locator('[data-group-text]').fill('I buy it')
    await sheet.locator('[data-group-send]').click(); await page.waitForTimeout(600)
    const mine = (await rec(page)).chatGroups.g1.items.find((i) => i.mine)
    check(`${w}: my message in the group's thread (stored, on the right)`, mine?.text === 'I buy it' && (await sheet.locator('.chat-out .chat-text').last().textContent()) === 'I buy it', JSON.stringify(mine))
    check(`${w}: no document scroll (chat)`, await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1))
    await page.screenshot({ path: `${SHOTS}/group-chat-list-chat-${w}.png` })
    // the active list as a sheet
    await sheet.locator('[data-group-active-list]').click(); await page.waitForTimeout(400)
    const ls = page.locator('[data-group-list-sheet="g1"]')
    const texts = () => ls.locator('.gl-text').allTextContents()
    check(`${w}: Active list opens the active list (two lists, the first marked active)`, (await ls.count()) === 1 && (await ls.locator('[data-group-list]').count()) === 2 && (await ls.locator('[data-group-list="l1"]').getAttribute('aria-pressed')) === 'true' && JSON.stringify(await texts()) === '["Milk","Bread"]')
    await ls.locator('[data-group-check="i1"]').check(); await page.waitForTimeout(400)
    let r = await rec(page)
    check(`${w}: a check stores who and when, and posts a quiet line`, r.chatGroups.g1.li.find((i) => i.id === 'i1').done?.by === 'Ana' && r.chatGroups.g1.items.some((i) => i.k === 'check' && i.text === 'Milk'))
    check(`${w}: the checked item shows who`, /Ana/.test(await ls.locator('[data-group-item-row="i1"] .gl-by').textContent()))
    await ls.locator('[data-group-add-text]').fill('Eggs'); await ls.locator('[data-group-add-text]').press('Enter'); await page.waitForTimeout(400)
    check(`${w}: Enter adds an item at the end, the input empties`, JSON.stringify(await texts()) === '["Milk","Bread","Eggs"]' && (await ls.locator('[data-group-add-text]').inputValue()) === '')
    const eggs = (await rec(page)).chatGroups.g1.li.find((i) => i.text === 'Eggs').id
    await ls.locator(`[data-group-up="${eggs}"]`).click(); await page.waitForTimeout(300)
    check(`${w}: up moves it one place`, JSON.stringify(await texts()) === '["Milk","Eggs","Bread"]')
    if (w === 360) await page.screenshot({ path: `${SHOTS}/group-chat-list-list-${w}.png` })
    await ls.locator('[data-group-archive]').click(); await page.waitForTimeout(300)
    check(`${w}: Archive done takes the checked item away, counted`, JSON.stringify(await texts()) === '["Eggs","Bread"]' && (await ls.locator('[data-group-archived="1"]').count()) === 1)
    await ls.locator('[data-group-new-list]').click(); await page.waitForTimeout(150)
    await ls.locator('[data-group-new-list-name]').fill('Garden'); await ls.locator('[data-group-new-list-name]').press('Enter'); await page.waitForTimeout(400)
    check(`${w}: + list adds a list and shows it (empty)`, (await ls.locator('[data-group-list]').count()) === 3 && (await ls.locator('[data-group-items-empty]').count()) === 1)
    await ls.locator('[data-group-make-active]').click(); await page.waitForTimeout(300)
    r = await rec(page)
    const garden = r.chatGroups.g1.lists.find((l) => l.name === 'Garden')
    check(`${w}: Make this the active list`, r.chatGroups.g1.active.id === garden?.id && (await ls.locator('[data-group-make-active]').count()) === 0)
    check(`${w}: no document scroll (list)`, await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1))
    await ls.locator('[data-group-back]').click(); await page.waitForTimeout(300)
    check(`${w}: back in the chat, the quiet check line shows`, /Ana checked Milk/.test(await page.locator('[data-group-chat="g1"] [data-group-item="check"]').first().textContent()))
    await page.locator('[data-group-invite]').click(); await page.waitForTimeout(400)
    check(`${w}: Invite opens the invite sheet for just this group`, (await page.locator('[data-invite-sheet="grp:g1"]').count()) === 1 && /Invite to Flat/.test(await page.locator('[data-invite-sheet] h3').textContent()))
    if (w === 360) await page.screenshot({ path: `${SHOTS}/group-chat-list-invite-${w}.png` })
    // New group
    await page.locator('[data-sheet-home]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-group-new]').click(); await page.waitForTimeout(300)
    await page.locator('[data-group-new-name]').fill('Choir'); await page.locator('[data-group-create]').click(); await page.waitForTimeout(400)
    r = await rec(page)
    const choir = Object.values(r.chatGroups).find((g) => g.name === 'Choir')
    check(`${w}: New group makes "Choir" with me and one active list, and opens it`, !!choir && choir.lists.length === 1 && choir.active.id === choir.lists[0].id && (await page.locator(`[data-group-chat="${choir?.id}"]`).count()) === 1)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
