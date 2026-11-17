// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b community-shell (headless, stock dev only, synthetic record): the settings list no longer wraps per letter (B34), the menu (name dropdown, Add event,
 * connect events, items in order, gear only), rename by long press / right click (B33), Home tiles (B35/B36), the chat page (B8), the event-only variant (B5), Your Profile first (B6).
 * PORT=5444 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node community_shell.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5444}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true' }), person('p3', 'Dan Huber', 'acquaintance', {})]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }, { id: 'book', colour: '#aa3300', label: 'Book club', community: true }]
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, communityId: 'iyg' }
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['me'] }, book: { kind: 'informal', organizers: [] } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events: [EV], extData })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const errors = []
    const open = async (hash = '') => {
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
      await page.goto(URL); await page.waitForTimeout(900)
      await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, [record, JSON.stringify(tags)])
      await page.goto(URL + hash); await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
      await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {})
      return page
    }
    const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const slice = async (page) => (await store(page)).extData['community-mighty']
    const menu = async (page) => { if (w < 900 && (await page.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) } }
    const goNav = async (page, n) => { await menu(page); await page.locator(`[data-community-nav="${n}"]`).click(); await page.waitForTimeout(300) }

    let page = await open()
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)

    // ---- B33 menu
    await menu(page)
    const order = await page.locator('[data-community-nav], [data-community-ask]').evaluateAll((b) => b.map((x) => x.getAttribute('data-community-nav') ?? 'ask'))
    check(`${w}: menu order Home Spaces Events Docs Chat Ask for Support, then Timeline, Members`, order.join() === 'home,spaces,events,docs,chat,ask,timeline,members', order.join())
    const navKids = await page.locator('.nav > *').evaluateAll((k) => k.map((x) => x.getAttribute('data-community-switch') !== null ? 'switch' : x.querySelector('[data-community-switch]') ? 'switch' : x.hasAttribute('data-community-settings') ? 'gear' : x.hasAttribute('data-community-add-event') ? 'add' : x.className))
    check(`${w}: the community name dropdown is the very top, the gear the very last`, navKids[0] === 'switch' && navKids[navKids.length - 1] === 'gear', navKids.join())
    check(`${w}: the gear carries no words`, ((await page.locator('[data-community-settings]').innerText()).trim() === '') && (await page.locator('[data-community-settings] svg').count()) === 1)
    check(`${w}: Ask for Support left the top (the first item is Home, Add event sits under the name)`, order[0] === 'home' && navKids[1] === 'add')
    await page.screenshot({ path: `${SHOTS}/community-shell-${w}-menu.png` })
    const gearBox = await page.locator('[data-community-settings]').boundingBox()
    const lastItem = await page.locator('[data-community-nav="members"]').boundingBox()
    check(`${w}: gear and the last menu item do not overlap`, !overlap(gearBox, lastItem))

    // Add event: informal / hosted
    await page.locator('[data-community-add-event]').click(); await page.waitForTimeout(150)
    check(`${w}: Add event offers Informal and Hosted`, (await page.locator('[data-community-add-event-kind]').evaluateAll((b) => b.map((x) => x.getAttribute('data-community-add-event-kind')))).join() === 'informal,hosted')
    await page.locator('[data-community-add-event]').click(); await page.waitForTimeout(150)
    // connect events
    await page.locator('[data-community-connect-events]').check(); await page.waitForTimeout(250)
    check(`${w}: connect events is stored for this community`, (await slice(page)).meta.iyg.connectEvents === true)

    // switcher + rename
    await page.locator('[data-community-switch]').click(); await page.waitForTimeout(200)
    check(`${w}: press on the name lists the communities`, (await page.locator('[data-community-pick]').count()) === 2)
    await page.locator('[data-community-switch]').click(); await page.waitForTimeout(150)
    await page.locator('[data-community-switch]').dispatchEvent('contextmenu'); await page.waitForTimeout(200)
    check(`${w}: right click on the name edits it`, (await page.locator('[data-community-rename]').count()) === 1)
    await page.locator('[data-community-rename]').fill('IYG Crew'); await page.locator('[data-community-rename]').press('Enter'); await page.waitForTimeout(300)
    check(`${w}: the new name is on the community tag`, JSON.parse(await page.evaluate(() => localStorage.getItem('trustweb.v1.colourtags'))).find((t) => t.id === 'iyg').label === 'IYG Crew')

    // ---- B34 settings list: no per-letter wrapping
    await menu(page); await page.locator('[data-community-settings]').click(); await page.waitForTimeout(300)
    const labels = await page.locator('[data-community-settings-panel] .pick').evaluateAll((rows) => rows.map((r) => { const s = r.querySelector('span'); const lh = parseFloat(getComputedStyle(s).lineHeight) || 20; return { text: s.textContent, lines: Math.round(s.getBoundingClientRect().height / lh), width: Math.round(s.getBoundingClientRect().width), box: Math.round(r.querySelector('input').getBoundingClientRect().width) } }))
    check(`${w}: the left-column list has all seven labels`, labels.length >= 8, JSON.stringify(labels))
    check(`${w}: every label renders on one line and is wider than a letter`, labels.every((l) => l.lines <= 1 && l.width > 30), JSON.stringify(labels.filter((l) => l.lines > 1 || l.width <= 30)))
    check(`${w}: the checkbox keeps its own small width`, labels.every((l) => l.box < 60), JSON.stringify(labels.map((l) => l.box)))
    check(`${w}: settings fit without sideways scroll`, await noHScroll(page))
    await page.screenshot({ path: `${SHOTS}/community-shell-${w}-settings.png` })
    await page.locator('[data-community-settings-done]').click(); await page.waitForTimeout(200)

    // ---- B35/B36 Home dashboard
    await goNav(page, 'home')
    const tiles = await page.locator('[data-community-tiles] [data-community-tile]').evaluateAll((b) => b.map((x) => x.getAttribute('data-community-tile')))
    check(`${w}: Home shows tiles, not the timeline`, tiles.join() === 'events,spaces,docs,members' && (await page.locator('[data-community-compose], .post').count()) === 0, tiles.join())
    await page.screenshot({ path: `${SHOTS}/community-shell-${w}-home.png` })
    await page.locator('[data-community-tiles-edit] summary').click(); await page.waitForTimeout(150)
    await page.locator('[data-community-tile-toggle="timeline"]').check(); await page.waitForTimeout(250)
    check(`${w}: switching the Timeline tile on adds it, stored per community`, (await page.locator('[data-community-tile="timeline"]').count()) === 1 && (await slice(page)).meta.iyg.tiles.includes('timeline'))
    // manager: managed tiles above, bordered
    await page.locator('[data-community-managed-tile="resources"]').check(); await page.waitForTimeout(250)
    check(`${w}: a manager's tile shows in a bordered section above mine`, (await page.locator('[data-community-tiles-managed] [data-community-tile="resources"]').count()) === 1)
    check(`${w}: a managed tile cannot be switched off by me`, await page.locator('[data-community-tile-toggle="resources"]').isDisabled())
    await page.locator('[data-community-tile="events"]').click(); await page.waitForTimeout(300)
    check(`${w}: a tile opens its section and counts its use locally`, (await slice(page)).tileUse?.events === 1 && (await page.locator('.cm').getAttribute('data-nav')) === 'events')
    check(`${w}: no social "follow them?" prompt (switch off)`, (await page.locator('[data-community-social]').count()) === 0)
    // the other community starts from the first one's layout
    await goNav(page, 'home'); await menu(page)
    await page.locator('[data-community-switch]').click(); await page.locator('[data-community-pick="book"]').click(); await page.waitForTimeout(300)
    await menu(page); await page.locator('[data-community-nav="home"]').click(); await page.waitForTimeout(200)
    check(`${w}: another community offers my layout as the start`, (await page.locator('[data-community-start-layout]').count()) === 1)
    await page.locator('[data-community-start-use]').click(); await page.waitForTimeout(250)
    check(`${w}: using it sets the tiles`, (await slice(page)).meta.book.tiles.includes('timeline'))
    await menu(page); await page.locator('[data-community-switch]').click(); await page.locator('[data-community-pick="iyg"]').click(); await page.waitForTimeout(300)

    // Timeline = menu item
    await goNav(page, 'timeline')
    check(`${w}: Timeline is its own menu item with the posts and the composer`, (await page.locator('[data-community-compose], [data-community-go="spaces"]').count()) >= 1)

    // ---- B8 chat page
    await goNav(page, 'chat')
    const head = page.locator('[data-community-chat]')
    check(`${w}: Chat is a page, not an overlay`, (await head.count()) === 1 && (await head.evaluate((n) => getComputedStyle(n).position)) !== 'fixed' && (await page.locator('.chat').count()) === 0)
    check(`${w}: "Only people of this community" is on by default`, await page.locator('[data-community-chat-only]').isChecked())
    check(`${w}: a switcher between communities`, (await page.locator('[data-community-chat-pick] option').count()) === 2)
    await page.locator('[data-community-chat-only]').uncheck(); await page.waitForTimeout(250)
    check(`${w}: switching it off is stored`, (await slice(page)).chatOnly === false)
    await page.locator('[data-community-chat-advanced] summary').click(); await page.waitForTimeout(150)
    check(`${w}: the WhatsApp bridge row is there and disabled`, await page.locator('[data-community-chat-bridge]').isDisabled())
    const hb = await head.boundingBox(); const cb = await page.locator('[data-community-chats]').boundingBox()
    check(`${w}: chat controls and chat list do not overlap`, !overlap(hb, cb))
    check(`${w}: chat page fits`, await noHScroll(page))
    await page.screenshot({ path: `${SHOTS}/community-shell-${w}-chat.png` })
    check(`${w}: no page errors (community)`, errors.length === 0, errors.join(' | '))
    await page.close()

    // ---- B6 settings: Your Profile first
    page = await open()
    await page.locator('.hdr [aria-label="Settings"]').first().click(); await page.waitForTimeout(500)
    const first = await page.locator('.sheet.on[data-kind=settings] [data-settings-group=simple] [data-setting]').evaluateAll((r) => r.map((x) => x.getAttribute('data-setting')))
    check(`${w}: Settings starts with Your Profile; Your AI sits below`, first[0] === 'ui.profile' && first.indexOf('ui.ai') > first.indexOf('ui.bar'), first.join())
    await page.screenshot({ path: `${SHOTS}/community-shell-${w}-settings-top.png` })
    await page.close()

    // ---- B5 event-only variant (a host link with mode=event) and the host's switch
    const payload = Buffer.from(JSON.stringify({ kind: 'host', id: 'ex1', name: 'Open Day', from: '2026-12-30', where: 'Graz', mode: 'event' })).toString('base64url')
    page = await open(`#ev_host=${payload}`)
    const bar = await page.locator('.tabs [data-go]').evaluateAll((b) => b.map((x) => x.getAttribute('data-go')))
    check(`${w}: an event link with mode=event shows only Web, Ask your web, Chat`, bar.filter((x) => !['more'].includes(x)).join() === 'web,ask,chat', bar.join())
    check(`${w}: no Recorder in the bar`, !bar.includes('record'))
    check(`${w}: Ask your web in the bar does not also float on Web (either-or)`, await page.locator('.phone.ask-in-bar, .ask-in-bar').count() >= 1)
    await page.screenshot({ path: `${SHOTS}/community-shell-${w}-event-only.png` })
    check(`${w}: no page errors (event only)`, errors.length === 0, errors.join(' | '))
    await page.close()

    page = await open()
    await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
    if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    await page.locator('[data-event-advanced] summary').click(); await page.waitForTimeout(200)
    const opt = page.locator('[data-event-link-mode-opt="event"]')
    check(`${w}: the host's Advanced offers Full app | Event only`, (await opt.count()) === 1 && (await page.locator('[data-event-link-mode-opt="full"]').count()) === 1)
    await opt.click(); await page.waitForTimeout(300)
    check(`${w}: Event only is stored on the event`, (await store(page)).events[0].linkMode === 'event')
    await page.screenshot({ path: `${SHOTS}/community-shell-${w}-event-advanced.png` })
    await page.close()
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
