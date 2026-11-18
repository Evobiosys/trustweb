// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker-2 (headless, stock dev only): names on member tiles, QR view fits the laptop viewport, Scan a code + zone dropdown under my code,
 *  foreign person-bound code refused, scan zones acquainted or closer, held person not re-added (toast clear of the event button), Chat first on a card.
 *  PORT=5294 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node steer_people_picker_2.mjs */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const ORIGIN = `http://127.0.0.1:${process.env.PORT ?? 5294}`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, extra = {}) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields: {}, ...extra })
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }]
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const phone = async (vp, rec) => {
  const ctx = await browser.newContext({ viewport: vp, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(ORIGIN + '/'); await page.waitForTimeout(900)
  if (rec) {
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [JSON.stringify(rec), JSON.stringify(tags)])
    await page.reload()
  }
  await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
  return { ctx, page, errors }
}
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const inside = (a, b) => a && b && a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1
const meetOpen = async (page) => { await page.locator('.status-pill.qr').click(); await page.locator('[data-connect-placement]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(1200) }
const ownLink = async (page) => {
  await meetOpen(page)
  const copy = page.locator('button.btn', { hasText: /^Copy/ }).first()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^Copy/.test(b.textContent ?? '') && !b.disabled), null, { timeout: 15_000 })
  await copy.click(); await page.waitForTimeout(300)
  return page.evaluate(() => navigator.clipboard.readText())
}
const toLocal = (url) => { const u = new URL(url); return ORIGIN + '/' + u.search + u.hash }

try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const people = [person('p1', 'Ben Gruber', 'close', { fields: { iyg: 'true' } }), person('p2', 'Maximiliane Hohenlohe-Schillingsfürst', 'friend', { fields: { iyg: 'true' } }), person('p3', 'Dan Huber', 'acquaintance', { fields: { iyg: 'true' } })]
    const events = [{ id: 'e1', name: 'Spring meetup', from: '2026-12-01T18:00', where: 'Wien', organizers: ['p1'] }]
    const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events, extData: { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: [] } } } } }
    const { ctx, page, errors } = await phone(vp, record)
    const shot = (n) => page.screenshot({ path: `${SHOTS}/steer-people-picker-2-${vw}-${n}.png` })

    // 1. names visible on member tiles
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)
    if (await page.locator('[data-community-menu]').isVisible()) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
    await page.locator('[data-community-nav="members"]').click(); await page.waitForTimeout(500)
    const tiles = await page.locator('[data-community-member]').evaluateAll((els) => els.map((t) => {
      const n = t.querySelector('.name'), z = t.querySelector('.chip.ring'), tr = t.getBoundingClientRect(), nr = n.getBoundingClientRect(), zr = z.getBoundingClientRect()
      return { clipped: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1, nameAboveZone: nr.bottom <= zr.top + 1, inTile: nr.top >= tr.top - 1 && zr.bottom <= tr.bottom + 1, text: n.textContent }
    }))
    check(`${vw}: three tiles`, tiles.length === 3)
    check(`${vw}: every name shows in full (not clipped)`, tiles.every((t) => !t.clipped), JSON.stringify(tiles))
    check(`${vw}: the name sits above the zone pill, both inside the tile`, tiles.every((t) => t.nameAboveZone && t.inTile), JSON.stringify(tiles))
    await shot('1-names')

    // 9. Chat first on the card
    await page.locator('[data-community-member="p1"]').click(); await page.waitForTimeout(700)
    const first = await page.locator('[data-small-card="p1"] > *').first().getAttribute('data-chat-row')
    check(`${vw}: Chat row is the first thing on the card`, first !== null)
    await shot('9-card')
    await page.keyboard.press('Escape')

    check(`${vw}: no page errors (tiles, card)`, errors.length === 0, errors.join(' | '))
    await ctx.close()

    // 9b. an organizer shown in an event: the card opened from there starts with Chat
    const ev = await phone(vp, { ...record, events: [{ id: 'e1', name: 'Spring meetup', from: new Date().toISOString().slice(0, 10) + 'T18:00', where: 'Wien', organizers: ['p1'] }] })
    await ev.page.locator('[data-go="events"]').click(); await ev.page.waitForTimeout(700)
    await ev.page.locator('text=Spring meetup').first().click(); await ev.page.waitForTimeout(600)
    await ev.page.locator('[data-event-roles-toggle]').first().click(); await ev.page.waitForTimeout(300)
    await ev.page.locator('[data-role-chip="p1"] .lnk').first().click(); await ev.page.waitForTimeout(800)
    const chat = await ev.page.locator('.sheet.on [data-chat-row]').first().boundingBox(); const cur = await ev.page.locator('.sheet.on .curator-person').first().boundingBox()
    check(`${vw}: an organizer's card from an event starts with Chat`, !!chat && !!cur && chat.y < cur.y, JSON.stringify({ chat, cur }))
    await ev.page.screenshot({ path: `${SHOTS}/steer-people-picker-2-${vw}-9b-organizer.png` })
    await ev.ctx.close()
  }

  // 3 + 4 + 5: Meet view per viewport
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }], ['1024', { width: 1024, height: 768 }]]) {
    const rec = { v: 1, me: { id: 'me2', displayName: 'Ana' }, peers: [], log: [], inventory: [], people: [person('p1', 'Ben Gruber', 'close')], events: [] }
    const { ctx, page, errors } = await phone(vp, rec)
    await meetOpen(page)
    const frame = page.locator('.scroll.pad').first()
    const fb = await frame.boundingBox()
    const wide = vp.width >= 900
    const code = await page.locator('.meet-page .qrwrap').boundingBox()
    const scan = await page.locator('[data-scan-code]').boundingBox()
    const sel = await page.locator('[data-connect-placement]').boundingBox()
    const tabs = await page.locator('.tabs').boundingBox()
    check(`${vw}: Scan a code sits directly under the code`, scan && code && scan.y >= code.y + code.height - 1 && scan.y - (code.y + code.height) < 80, JSON.stringify({ scan, code }))
    check(`${vw}: the zone dropdown follows the scan button`, sel && scan && sel.y >= scan.y + scan.height - 1)
    if (wide) {
      const bottom = Math.min(fb.y + fb.height, tabs.y)
      check(`${vw}: code, scan button and dropdown all in one viewport without scrolling`, code.y >= 0 && sel.y + sel.height <= bottom + 1 && scan.y + scan.height <= bottom + 1, JSON.stringify({ code, scan, sel, bottom }))
      check(`${vw}: the page itself does not scroll`, await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1))
      check(`${vw}: code is big enough to scan (>= 200px)`, code.width >= 200, String(code.width))
    }
    const opts = await page.locator('[data-connect-placement] button').evaluateAll((o) => o.map((x) => x.getAttribute('data-ring')))
    check(`${vw}: dropdown offers the four zones (no Intending)`, JSON.stringify(opts) === JSON.stringify(['closest', 'close', 'friend', 'acquaintance']), opts.join(','))
    check(`${vw}: default is the default zone`, (await page.locator('[data-connect-placement] .on').getAttribute('data-ring')) === 'acquaintance')
    await page.locator('[data-connect-placement] [data-ring="friend"]').click(); await page.waitForTimeout(200)
    check(`${vw}: choosing a zone is stored`, (await store(page)).connectPlacement === 'friend')
    await page.locator('[data-scan-code]').click(); await page.waitForTimeout(1200)
    check(`${vw}: Scan a code opens the scanner (or says the camera did not open)`, (await page.locator('[data-scan-video]:not([hidden])').count()) === 1 || /camera/i.test(await page.locator('[data-scan-note]').innerText()))
    await page.screenshot({ path: `${SHOTS}/steer-people-picker-2-${vw}-meet.png` })
    check(`${vw}: no page errors (Meet)`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 2, 6, 7, 8: links between two phones (A makes the code, B scans)
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const a = await phone(vp, { v: 1, me: { id: 'meA', displayName: 'Ana' }, peers: [], log: [], inventory: [], people: [], events: [] })
    const link = await ownLink(a.page)
    await a.ctx.close()
    const aDid = new URL(link).searchParams.get('connect')
    check(`${vw}: Ana's own connect link names her DID`, !!aDid && aDid.startsWith('did:'), link.slice(0, 120))

    // 2. foreign scan of a person-bound code
    const bound = link + (link.includes('#') ? '&' : '#') + 'to=did%3Apeer%3AzSomeoneElse'
    let b = await phone(vp, null)
    await b.page.goto(toLocal(bound)); await b.page.addStyleTag({ content: hide }); await b.page.waitForTimeout(900)
    await b.page.locator('input[autocomplete="given-name"]').fill('Cleo'); await b.page.keyboard.press('Enter'); await b.page.waitForTimeout(1500)
    const msg = await b.page.locator('[data-foreign-code]').innerText().catch(() => '')
    check(`${vw}: a code made for someone else is refused, no name`, /^This code was made for someone else\. Ask the person who showed it to you for a code made for you \(or their open QR\)\.$/.test(msg), msg)
    await b.page.screenshot({ path: `${SHOTS}/steer-people-picker-2-${vw}-foreign.png` })
    check(`${vw}: nothing was added`, ((await store(b.page))?.people ?? []).length === 0 && !(await b.page.locator('[data-connect-add]').count()))
    await b.ctx.close()

    // 6. generic code: the zone choices are acquainted or closer only
    b = await phone(vp, null)
    await b.page.goto(toLocal(link)); await b.page.addStyleTag({ content: hide }); await b.page.waitForTimeout(900)
    await b.page.locator('input[autocomplete="given-name"]').fill('Cleo'); await b.page.keyboard.press('Enter'); await b.page.waitForTimeout(1500)
    const rings = await b.page.locator('.sheet [data-ring]').evaluateAll((e) => e.map((x) => x.getAttribute('data-ring')))
    check(`${vw}: the scan's zone choices are acquainted or closer`, JSON.stringify(rings) === JSON.stringify(['closest', 'close', 'friend', 'acquaintance']), rings.join(','))
    await b.page.screenshot({ path: `${SHOTS}/steer-people-picker-2-${vw}-scan-zones.png` })
    await b.ctx.close()

    // 7 + 8. an event code from a person already held: no second add, the toast clears the event button
    const evp = Buffer.from(JSON.stringify({ kind: 'peer', id: 'e9', name: 'Spring meetup', from: '2026-12-01T18:00', where: 'Wien' })).toString('base64url')
    const evLink = link + (link.includes('#') ? '&' : '#') + 'ev=' + evp
    const held = { v: 1, me: { id: 'meB', displayName: 'Cleo' }, peers: [{ id: 'peA', displayName: 'Ana', did: aDid, ring: 'friend', connectedAt: 1, heardAt: 1 }], log: [], inventory: [], people: [person('pa', 'Ana', 'friend', { peerId: 'peA' })], events: [] }
    b = await phone(vp, held)
    await b.page.goto(toLocal(evLink)); await b.page.addStyleTag({ content: hide }); await b.page.waitForTimeout(1800)
    const rec = await store(b.page)
    check(`${vw}: already connected: one person, one peer, zone unchanged`, rec.people.length === 1 && rec.peers.length === 1 && rec.peers[0].ring === 'friend' && rec.people[0].ring === 'friend', JSON.stringify({ p: rec.people.length, r: rec.peers.map((x) => x.ring) }))
    check(`${vw}: no add sheet; the event join sheet opens`, (await b.page.locator('[data-connect-add]').count()) === 0 && (await b.page.locator('[data-event-join]').count()) === 1)
    const toastText = await b.page.locator('.toast.on').innerText().catch(() => '')
    check(`${vw}: the toast says "Already connected with Ana."`, /Already connected with Ana\./.test(toastText), toastText)
    const tb = await b.page.locator('.toast.on').boundingBox(); const jb = await b.page.locator('[data-event-join]').boundingBox()
    const overlap = tb && jb && !(tb.x + tb.width <= jb.x || jb.x + jb.width <= tb.x || tb.y + tb.height <= jb.y || jb.y + jb.height <= tb.y)
    check(`${vw}: the toast does not cover the event button`, !!tb && !!jb && !overlap, JSON.stringify({ tb, jb }))
    await b.page.screenshot({ path: `${SHOTS}/steer-people-picker-2-${vw}-held-event.png` })
    check(`${vw}: no page errors (links)`, b.errors.length === 0, b.errors.join(' | '))
    await b.ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
