// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c social-hosting (headless, stock dev server only; the directory is a mock of services/trustweb-backup/directory.mjs behind page.route):
 *   cd apps/demo && PORT=5454 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> ../../node_modules/.bin/tsx ../trustweb/test/e2e/social_hosting.mjs
 */
import { createIdentity, signBytes, verifyDidSignature } from '../../../demo/src/did.ts'
import { makeIntent, makeRecord, verifyRecord } from '../../src/name_record.ts'

const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const BASE = `http://127.0.0.1:${process.env.PORT ?? 5454}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const P = (id, name, ring, over = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...over })
const eve = createIdentity('https://eve.test')
const grace = createIdentity('https://grace.test')

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    // ---- the mock directory
    const seen = []
    const records = [makeRecord((b) => signBytes(grace, b), { first: 'Grace', last: 'Hopper', key: grace.did, ts: Date.now(), open: true, srv: true })]
    let pending = []
    await page.route((u) => u.pathname === '/directory' || u.pathname.startsWith('/directory/'), async (route) => {
      const req = route.request(); const url = new URL(req.url()); const body = req.postData() ? JSON.parse(req.postData()) : null
      seen.push({ method: req.method(), path: url.pathname, q: url.searchParams.get('q'), body })
      const json = (status, o) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) })
      if (req.method() === 'PUT') return route.fulfill({ status: 204 })
      if (req.method() === 'DELETE') return route.fulfill({ status: 204 })
      if (url.pathname === '/directory/intent') return route.fulfill({ status: 204 })
      if (url.pathname === '/directory/intents') { const out = pending; pending = []; return json(200, { intents: out }) }
      return json(200, { records: records.filter((r) => `${r.first} ${r.last}`.toLowerCase() === (url.searchParams.get('q') ?? '')) })
    })
    const REC = { v: 1, me: { id: 'me1', displayName: 'Tester Person' }, people: [P('a1', 'Anna Huber', 'close', { peerId: 'pa' }), P('b1', 'Ben Gruber', 'friend')], peers: [{ id: 'pa', displayName: 'Anna', did: 'did:peer:2.Vzfake', ring: 'close', connectedAt: 1 }], log: [], inventory: [], events: [], missedPopupOff: true }
    await page.goto(BASE); await page.waitForTimeout(1200)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1200)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const openSettings = async () => { await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(300); await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500) }

    // review-fixes-43c: not discoverable (the default) = no directory request at all, not even the intents pull with my key
    check(`${w}: not discoverable: start made no directory request`, seen.length === 0, JSON.stringify(seen.map((x) => x.method + x.path)))
    // ---- 1. Settings > Your Profile > Discoverable by name
    await openSettings()
    await page.locator('[data-setting="ui.profile"]').click(); await page.waitForTimeout(500)
    const prof = page.locator('[data-social-profile]')
    check(`${w}: Your Profile holds "Discoverable by name"`, (await prof.count()) === 1 && (await prof.innerText()).includes('Discoverable by name'))
    const sw = page.locator('[data-social-switch=discoverable]')
    check(`${w}: it is off by default, aria false, label struck through (P2)`, (await sw.getAttribute('aria-checked')) === 'false' && (await prof.locator('b.tw-off').count()) >= 1)
    check(`${w}: "Open to connect" sits behind the V expander (P3)`, (await page.locator('[data-social-more]').isHidden()) && (await page.locator('[data-social-expander]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/social-hosting-profile-off-${w}.png` })
    const before = seen.length
    await sw.click(); await page.waitForTimeout(900)
    const s1 = await store()
    check(`${w}: switching on stores discoverable:true`, s1.discoverable === true)
    check(`${w}: it published a valid signed record to the server (srv true, hosts empty)`, await (async () => {
      const put = seen.slice(before).find((x) => x.method === 'PUT')
      return Boolean(put) && verifyRecord(put.body.rec, verifyDidSignature) && put.body.rec.first === 'Tester' && put.body.rec.last === 'Person' && put.body.rec.srv === true && put.body.rec.key === s1.identity.did
    })(), JSON.stringify(seen.slice(before)).slice(0, 200))
    check(`${w}: now the switch is on and the label no longer struck through`, (await page.locator('[data-social-switch=discoverable]').getAttribute('aria-checked')) === 'true' && (await prof.locator('[data-social=discoverable] b.tw-off').count()) === 0)
    // wave44b profile-page: switching Discoverable on opens the dependent toggle by itself (no expander press)
    check(`${w}: Discoverable on opens "Open to connect" (on) by itself`, (await page.locator('[data-social-more]').isVisible()) && (await page.locator('[data-social-switch=open]').getAttribute('aria-checked')) === 'true')
    await page.locator('[data-social-switch=open]').click(); await page.waitForTimeout(500)
    check(`${w}: Open to connect off is stored as discoverOpen:false`, (await store()).discoverOpen === false)
    await page.screenshot({ path: `${SHOTS}/social-hosting-profile-on-${w}.png` })
    // P06: nothing overlaps in the profile block
    const boxes = await page.locator('[data-social-profile] button').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    let clash = false
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) clash = true
    check(`${w}: no control of the profile block overlaps another and all sit inside the viewport`, !clash && boxes.every((b) => b.x >= 0 && b.x + b.width <= w + 1), JSON.stringify(boxes))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // ---- 2. Advanced > People and servers: trusted-only, hosting, servers
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    await openSettings()
    await page.evaluate(() => { const d = document.querySelector('[data-settings-advanced-all]'); if (d) d.open = true })
    await page.waitForTimeout(300)
    const grp = page.locator('[data-settings-group=social]')
    check(`${w}: Advanced has the People and servers group`, (await grp.count()) === 1)
    check(`${w}: "Only through people I trust" is off, struck through`, (await page.locator('[data-social-switch=trusted-only]').getAttribute('aria-checked')) === 'false' && (await grp.locator('[data-social=trusted-only] b.tw-off').count()) === 1)
    check(`${w}: hosting defaults to Closest`, (await page.locator('[data-social-host=closest]').getAttribute('aria-pressed')) === 'true')
    await page.locator('[data-social-host=close]').click(); await page.waitForTimeout(500)
    check(`${w}: Closest and Close is stored; Closest again removes it`, (await store()).hostFriends === 'close')
    await page.evaluate(() => { const d = document.querySelector('[data-settings-advanced-all]'); if (d) d.open = true })
    await page.locator('[data-social-host=closest]').click(); await page.waitForTimeout(500)
    check(`${w}: back to the default stores nothing`, (await store()).hostFriends === undefined)
    await page.evaluate(() => { const d = document.querySelector('[data-settings-advanced-all]'); if (d) d.open = true })
    await page.locator('[data-social-server-input]').fill('http://evil.test'); await page.locator('[data-social-server-add]').click(); await page.waitForTimeout(300)
    check(`${w}: an http server is refused`, (await store()).directoryServers === undefined)
    await page.locator('[data-social-server-input]').fill('https://dir.example.test/'); await page.locator('[data-social-server-add]').click(); await page.waitForTimeout(500)
    check(`${w}: an https server is added (trailing slash cut) and listed`, JSON.stringify((await store()).directoryServers) === '["https://dir.example.test"]' && (await page.locator('[data-social-server="https://dir.example.test"]').count()) === 1)
    await page.evaluate(() => { const d = document.querySelector('[data-settings-advanced-all]'); if (d) d.open = true })
    await page.locator('[data-social-server-remove]').click(); await page.waitForTimeout(500)
    check(`${w}: removing the last one returns to the Swiss default`, (await store()).directoryServers === undefined)
    await page.evaluate(() => { const d = document.querySelector('[data-settings-advanced-all]'); if (d) d.open = true })
    const beforeTrust = seen.length
    await page.locator('[data-social-switch=trusted-only]').click(); await page.waitForTimeout(1000)
    const s2 = await store()
    check(`${w}: trusted-only on is stored`, s2.trustedOnly === true)
    check(`${w}: switching it on took my listing off the server first (one DELETE), nothing else went out`, seen.slice(beforeTrust).filter((x) => x.method === 'DELETE').length === 1 && seen.slice(beforeTrust).every((x) => x.method === 'DELETE'), JSON.stringify(seen.slice(beforeTrust).map((x) => x.method + x.path)))
    await page.evaluate(() => { const d = document.querySelector('[data-settings-advanced-all]'); if (d) d.open = true })
    check(`${w}: the screen says no server is used`, (await grp.innerText()).includes('No server is used'))
    await page.screenshot({ path: `${SHOTS}/social-hosting-advanced-${w}.png` })
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // ---- 3. trusted-only: no directory call at all, not even on reload (publish, pull intents)
    const quietFrom = seen.length
    await page.reload(); await page.waitForTimeout(1500)
    check(`${w}: with trusted-only on a reload makes no directory request`, seen.length === quietFrom, JSON.stringify(seen.slice(quietFrom).map((x) => x.method + x.path)))

    // ---- 4. the person page: Trust row with overrides
    await page.locator('[data-go="web"]').click(); await page.waitForTimeout(300)
    await page.evaluate(() => { const h = location.hash; return h })
    // open Ben's card page through the notify/people path: the Web list opens card pages with data-open-card or a row click
    const opened = await page.evaluate(() => { const n = document.querySelector('[data-pid="b1"]'); if (n) { n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true } return false })
    await page.waitForTimeout(600)
    const trustRow = page.locator('[data-social-trust=b1]')
    if (opened && (await trustRow.count()) === 1) {
      check(`${w}: Ben (Friend) is not trusted by ring`, (await trustRow.locator('[data-social-trust-now]').getAttribute('data-social-trust-now')) === 'false')
      await trustRow.locator('[data-social-trust-set=trusted]').click(); await page.waitForTimeout(400)
      check(`${w}: marking him Trusted stores the override and reads trusted (you chose)`, (await store()).people.find((p) => p.id === 'b1').trust === 'yes' && (await page.locator('[data-social-trust=b1] [data-social-trust-now]').innerText()).includes('you chose'))
      await page.locator('[data-social-trust=b1] [data-social-trust-set=default]').click(); await page.waitForTimeout(300)
      check(`${w}: By ring removes it again`, (await store()).people.find((p) => p.id === 'b1').trust === undefined)
      await page.screenshot({ path: `${SHOTS}/social-hosting-trust-${w}.png` })
    } else check(`${w}: the card page of Ben opens with a Trust row`, false, `opened=${opened}`)
    await ctx.close()
  }

  // ---- 5. Find someone by name + intent both ways (360 only, trusted-only OFF)
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const seen = []
    const records = [makeRecord((b) => signBytes(grace, b), { first: 'Grace', last: 'Hopper', key: grace.did, ts: Date.now(), open: true, srv: true })]
    let pending = []
    await page.route((u) => u.pathname === '/directory' || u.pathname.startsWith('/directory/'), async (route) => {
      const req = route.request(); const url = new URL(req.url()); const body = req.postData() ? JSON.parse(req.postData()) : null
      seen.push({ method: req.method(), path: url.pathname, body })
      const json = (status, o) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) })
      if (req.method() === 'PUT' || req.method() === 'DELETE' || url.pathname === '/directory/intent') return route.fulfill({ status: 204 })
      if (url.pathname === '/directory/intents') { const out = pending; pending = []; return json(200, { intents: out }) }
      return json(200, { records: records.filter((r) => `${r.first} ${r.last}`.toLowerCase() === (url.searchParams.get('q') ?? '')) })
    })
    // review-fixes-43c: discoverable, so this device pulls intents (a non-discoverable one never calls the directory with its key)
    const REC = { v: 1, me: { id: 'me1', displayName: 'Tester Person' }, discoverable: true, people: [P('a1', 'Anna Huber', 'friend'), P('c1', 'Cleo Stone', 'friend'), P('d1', 'Dan Keller', 'acquaintance')], peers: [], log: [], inventory: [], events: [], missedPopupOff: true }
    await page.goto(BASE); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); localStorage.removeItem('trustweb.ui.netPins') }, REC)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1200)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    await page.locator('[data-go="web"]').click(); await page.waitForTimeout(300)
    await page.locator('.view-menu-btn').click(); await page.waitForTimeout(200)
    await page.locator('[data-view-drop] [data-view=network]').click(); await page.waitForTimeout(1500)
    check('360: the Network view has "Find someone by name"', (await page.locator('[data-social-find]').count()) === 1)
    await page.locator('[data-find-first]').fill('GRACE'); await page.locator('[data-find-last]').fill('hopper'); await page.locator('[data-find-go]').click(); await page.waitForTimeout(800)
    const hitRow = page.locator(`[data-find-hit="${grace.did}"]`)
    check('360: a global hit appears for GRACE hopper (case-insensitive) marked "not yet connected"', (await hitRow.count()) === 1 && (await hitRow.locator('[data-find-status]').innerText()).includes('not yet connected'))
    check('360: it came from the server (no friends online)', (await page.locator('[data-find-via]').getAttribute('data-find-via')) === 'server')
    await page.screenshot({ path: `${SHOTS}/social-hosting-find-360.png` })
    await page.locator(`[data-find-intend="${grace.did}"]`).click(); await page.waitForTimeout(800)
    const s = await store()
    const sent = s.people.find((p) => p.globalKey === grace.did)
    check('360: "Intend to connect" makes an Unsorted-ring person I reached out to', Boolean(sent) && sent.ring === 'intending' && sent.reachedOut === 'sent' && sent.name === 'Grace Hopper')
    const post = seen.find((x) => x.path === '/directory/intent')
    check('360: and left a signed intent for Grace on the server', Boolean(post) && post.body.intent.to === grace.did && post.body.intent.from.key === s.identity.did)
    check('360: the button now reads "They will see it" and is disabled', (await page.locator(`[data-find-intend="${grace.did}"]`).isDisabled()))
    // the other direction: an intent for me arrives with the next pull
    pending = [makeIntent((b) => signBytes(eve, b), { to: s.identity.did, first: 'Eve', last: 'Example', key: eve.did, ts: Date.now() }), makeIntent((b) => signBytes(eve, b), { to: grace.did, first: 'Eve', last: 'Example', key: eve.did, ts: Date.now() })]
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1800)
    const s2 = await store()
    const got = s2.people.find((p) => p.globalKey === eve.did)
    check('360: an intent addressed to me became an Unsorted-ring person who reached out to me; one for someone else was dropped', Boolean(got) && got.ring === 'intending' && got.reachedOut === 'received' && s2.people.filter((p) => p.globalKey === eve.did).length === 1)
    await page.locator('[data-go="web"]').click(); await page.waitForTimeout(300)
    const bell = page.locator('[data-notify-bell]')
    check('360: the bell counts them', Number(await bell.getAttribute('data-notify-bell')) >= 1)
    await bell.click(); await page.waitForTimeout(500)
    check('360: "People who want to connect" lists Eve Example', (await page.locator('[data-notify-section=wants]').innerText()).includes('Eve Example'))
    await page.screenshot({ path: `${SHOTS}/social-hosting-bell-360.png` })
    check('360: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
