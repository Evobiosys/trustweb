// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c connect-extras (headless, stock dev server, synthetic record): theta, the community Home's opt-in "Share my tile layout anonymously"
 * (struck through while off, nothing sent while off, the aggregate card, Follow), and zeta, an event with Feed on and no instance of its own reads the
 * public hashtag timeline on mastodon.social (read-only, stubbed here; the live check is connect_extras_live.mjs). Endpoints are stubbed in the page.
 * PORT=5456 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node connect_extras_home.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5456}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true' })]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }]
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, communityId: 'iyg', offers: { feed: true } }
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: [] } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events: [EV], extData, feed: { on: true } })
const hide = '.twf, .twf-ok, .twp { display: none !important }'

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const errors = []
    const posts = []
    const gets = []
    const mastodon = []
    await ctx.route('**/community/agg', async (r) => { posts.push(JSON.parse(r.request().postData() ?? '{}')); await r.fulfill({ status: 204 }) })
    await ctx.route('**/community/agg/iyg', async (r) => { gets.push(r.request().url()); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ n: 10, tiles: { events: 8, docs: 6, members: 2 } }) }) })
    await ctx.route('https://mastodon.social/api/v1/timelines/tag/**', async (r) => { mastodon.push(r.request().url()); await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }) })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, [record, JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {})
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

    // ---- theta: community Home
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)
    const card = page.locator('[data-community-social]')
    const sw = page.locator('[data-community-share-layout]')
    check(`${w}: Home has "Share my tile layout anonymously", off by default`, (await sw.count()) === 1 && (await sw.getAttribute('aria-checked')) === 'false')
    check(`${w}: the label is struck through while off`, (await card.locator('label.tw-off > span').evaluate((s) => getComputedStyle(s).textDecorationLine)).includes('line-through'))
    await page.screenshot({ path: `${SHOTS}/connect-extras-home-off-${w}.png` })
    await page.waitForTimeout(600)
    check(`${w}: nothing is sent or read while it is off`, posts.length === 0 && gets.length === 0, `${posts.length} posts ${gets.length} gets`)
    const box = await card.boundingBox()
    check(`${w}: the card sits inside the viewport`, !!box && box.x >= 0 && box.x + box.width <= w + 1)

    await sw.click(); await page.waitForTimeout(1200)
    check(`${w}: switching on stores shareLayout and one anonymous slot`, await page.evaluate(() => { const m = JSON.parse(localStorage.getItem('trustweb.v1.me')).extData['community-mighty'].meta.iyg; return m.shareLayout === true && /^[0-9a-f]{24}$/.test(m.slot) }))
    check(`${w}: the tile set goes out once, as {communityId, slot, tiles} and nothing else`, posts.length === 1 && Object.keys(posts[0]).sort().join() === 'communityId,slot,tiles' && posts[0].communityId === 'iyg' && posts[0].tiles.join() === 'events,spaces,docs,members', JSON.stringify(posts))
    const body = JSON.stringify(posts)
    check(`${w}: no name, key or person data in what was sent`, !/Ben|Cleo|Ana|peer-|did:/.test(body))
    const others = page.locator('[data-community-social-others]')
    check(`${w}: Home shows what other members show, then "Follow them?"`, (await others.innerText()) === 'Other members show: Events 80 %, Docs 60 %, Members 20 %. Follow them?', await others.innerText().catch(() => ''))
    await page.screenshot({ path: `${SHOTS}/connect-extras-home-on-${w}.png` })
    await page.locator('[data-community-social-follow]').click(); await page.waitForTimeout(500)
    const meta = (await store()).extData['community-mighty'].meta.iyg
    check(`${w}: Follow takes the tiles most members show (Events, Docs)`, meta.tiles?.join() === 'events,docs', JSON.stringify(meta.tiles))
    check(`${w}: the changed layout is sent again`, posts.length === 2 && posts[1].tiles.join() === 'events,docs', JSON.stringify(posts.map((p) => p.tiles)))
    await page.locator('[data-community-social-no]').click().catch(() => {}); await page.waitForTimeout(300)
    await page.locator('[data-community-share-layout]').click(); await page.waitForTimeout(500)
    const off = (await store()).extData['community-mighty'].meta.iyg
    check(`${w}: switching off stores false (so a device merge keeps it off) and sends nothing more`, off.shareLayout === false && posts.length === 2)
    check(`${w}: ... and the struck-through label is back`, (await page.locator('[data-community-social] label.tw-off > span').count()) === 1)

    // ---- zeta: event Feed without its own instance reads the default instance
    await page.goto(URL + '#'); await page.waitForTimeout(500)
    const s = await store()
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, { ...s, feed: { on: true, remote: true } })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {})
    await page.locator('[data-mode-pill] [data-mode="personal"]').first().click(); await page.waitForTimeout(800)
    await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(400)
    if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').evaluate((n) => n.click())
    await page.locator('[data-event="e1"]').evaluate((n) => n.click()); await page.waitForTimeout(500)
    await page.locator('[data-event-feed-toggle]').click(); await page.waitForTimeout(300)
    await page.locator('[data-event-feed-open]').click(); await page.waitForTimeout(1500)
    check(`${w}: the event Feed read the public tag timeline on mastodon.social, read-only`, mastodon.length >= 1 && /^https:\/\/mastodon\.social\/api\/v1\/timelines\/tag\/event_/.test(mastodon[0]) && !/POST/.test(mastodon.join()), mastodon.join(' '))
    check(`${w}: the event named no instance of its own`, !(await store()).events[0].mastodonInstance)
    await page.screenshot({ path: `${SHOTS}/connect-extras-feed-${w}.png` })
    // Settings > Feed lists the instance and says posting is off
    await page.locator('nav.tabs button', { hasText: 'Resources' }).click(); await page.waitForTimeout(400)
    await page.evaluate(() => { localStorage.setItem('trustweb.ui.settings.advanced', '1'); localStorage.setItem('trustweb.ui.settings.features', '1') })
    await page.getByRole('button', { name: 'Settings' }).click(); await page.locator('[data-feed-toggle]').waitFor({ timeout: 5000 }).catch(() => {})
    const text = await page.locator('[data-feed-default-instance]').first().textContent().catch(() => '')
    check(`${w}: Settings > Feed lists mastodon.social and says posting comes with the TrustWeb account`, /mastodon\.social/.test(text) && /posting comes with the TrustWeb account/.test(text), text)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
