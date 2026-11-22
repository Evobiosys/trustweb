// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 4 (headless, stock dev server, synthetic record; Jakob's Tana memo "Improve community event sharing and participant visibility"):
 * 4b/e the top of a community event: mode note, cover with the first sentence and the share icons, Hosted by, by <community> (opens it), Joining,
 * the Community row of an intimate community, Message everyone, Resources of the event; the share controls also at the very bottom; 4a the share
 * audience; 4g the Personal | Community switch reads Community after opening it; 4f adding a new person from the page keeps the scroll position;
 * a big community lists no members. 360x780 and 1280x900, bounding boxes (D-P06).
 * PORT=5485 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node a44d_event_page.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5485}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...over })
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }, { id: 'big', colour: '#aa3300', label: 'Big Org', community: true }]
const people = [P('b', 'Ben Gruber', { events: ['e1'], fields: { iyg: 'true' }, peerId: 'peer-b' }), P('h', 'Hanna Host', { fields: { iyg: 'true' } }), P('c', 'Cleo Maier', { fields: { iyg: 'true' } }),
  ...Array.from({ length: 35 }, (_, i) => P(`g${i}`, `Guest ${i}`, { fields: { big: 'true' } }))]
const EV = { id: 'e1', name: 'Winter OG', from: day(3), where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna Host'], communityId: 'iyg', docs: { description: 'Three days in the snow together. Bring boots.' } }
const EV2 = { id: 'e2', name: 'Big Gala', from: day(5), where: 'Hall', createdAt: 1, attended: true, hosts: ['Hanna Host'], communityId: 'big' }
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: ['me'] }, big: { kind: 'informal', organizers: ['me'] } } } }
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [{ id: 'peer-b', displayName: 'Ben' }], log: [], inventory: [], people, events: [EV, EV2], extData, twSettings: { extensions: { 'community-mighty': true, 'community-mode': true } } }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [JSON.stringify(record), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    const openEvent = async (id) => {
      await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
      await page.waitForTimeout(200)
      await page.locator(`[data-event="${id}"]`).click(); await page.waitForTimeout(400)
    }
    await openEvent('e1')
    const order = await page.locator('.events-page > *').evaluateAll((n) => n.slice(0, 7).map((x) => Object.keys(x.dataset)[0] ?? x.className))
    check(`${w}: top order: mode note, cover, hosted by, by community, joining, community row`, JSON.stringify(order.slice(0, 6)) === JSON.stringify(['eventModeNote', 'eventCover', 'eventHostedBy', 'eventByCommunity', 'eventPeople', 'eventCommunityMembers']), JSON.stringify(order))
    check(`${w}: the mode note says Community view: IYG`, (await page.locator('[data-event-mode-note]').textContent()) === 'Community view: IYG')
    check(`${w}: the cover has the first sentence and the share icons`, (await page.locator('[data-event-what]').textContent()) === 'Three days in the snow together.' && (await page.locator('[data-event-cover] [data-event-qr-top]').count()) === 1)
    check(`${w}: Hosted by Hanna Host; Joining lists Ben`, (await page.locator('[data-event-hosted-by]').textContent()) === 'Hosted by Hanna Host' && (await page.locator('[data-event-people-list] [data-person-chip="b"]').count()) === 1)
    check(`${w}: the intimate community's other members are listed (Hanna as host is not "joining")`, (await page.locator('[data-event-community-list] [data-person-chip]').evaluateAll((n) => n.map((x) => x.dataset.personChip).sort().join())) === 'c,h')
    check(`${w}: Message everyone and Resources of #event:Winter OG`, (await page.locator('[data-event-chat]').count()) === 1 && /Resources of/.test(await page.locator('[data-event-resources]').textContent()))
    check(`${w}: the share controls also at the very bottom, with the audience (default: become community members)`, (await page.locator('.events-page > *').last().getAttribute('data-event-share-bottom')) === '' && (await page.locator('[data-event-share-audience]').getAttribute('data-event-share-audience')) === 'community')
    const boxes = await Promise.all(['[data-event-mode-note]', '[data-event-cover]', '[data-event-hosted-by]', '[data-event-by-community]', '[data-event-people]'].map((s) => page.locator(s).first().boundingBox()))
    check(`${w}: no control of the top overlays another`, boxes.every((a, i) => boxes.every((b, j) => i === j || !overlap(a, b))))
    await page.screenshot({ path: `${SHOTS}/answers-44d-event-top-${w}.png` })
    // 4a: Choose later is stored
    await page.locator('[data-event-share-aud="later"]').click(); await page.waitForTimeout(300)
    check(`${w}: Choose later is stored on the event`, (await rec(page)).events[0].shareAudience === 'later')
    // 4f: a new person from the picker keeps the scroll position
    const scroller = page.locator('.events-page')
    await page.locator('[data-event-tag-search]').scrollIntoViewIfNeeded(); await page.waitForTimeout(200)
    const before = await scroller.evaluate((n) => n.scrollTop)
    await page.locator('[data-event-tag-search]').fill('Zora Neu'); await page.waitForTimeout(250)
    await page.locator('[data-person-create]').first().click(); await page.waitForTimeout(500)
    const after = await scroller.evaluate((n) => n.scrollTop)
    check(`${w}: "Add as a new person" keeps the scroll position (${before} -> ${after})`, before > 0 && Math.abs(after - before) <= 2)
    check(`${w}: the new person is tagged with the event`, (await rec(page)).people.some((p) => p.name === 'Zora Neu' && p.events?.includes('e1')))
    // 4g: the Personal | Community switch reads Community
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(500)
    const mode = await page.locator('[data-mode-pill] [aria-checked="true"]').getAttribute('data-mode').catch(() => null)
    check(`${w}: after opening the community event the switch reads Community`, mode === 'community', String(mode))
    // big community: only joiners, no Community row
    await openEvent('e2')
    check(`${w}: a big community lists no members`, (await page.locator('[data-event-community-members]').count()) === 0 && (await page.locator('[data-event-people]').getAttribute('data-event-people')) === '1')
    // by <community> opens the community view
    await openEvent('e1')
    await page.locator('[data-event-by-community]').click(); await page.waitForTimeout(800)
    check(`${w}: "by IYG" opens the IYG community view`, (await page.locator('[data-community-menu], [data-community-nav]').count()) > 0)
    check(`${w}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
