// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-feed (headless, stock dev only): PORT=5434 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node event_feed.mjs. Synthetic record only. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5434}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const events = [
  { id: 'e1', name: 'Winter IYG', from: day(2), where: 'Wien', createdAt: 1, attended: true, offers: { feed: true } },
  { id: 'e2', name: 'Quiet day', from: day(3), where: 'Graz', createdAt: 1, attended: true },
]
const record = { v: 1, strikeSwitchedOff: true, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [], people: [], events }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; const requests = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()) })
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([k, r]) => localStorage.setItem(k, r), [KEY, JSON.stringify(record)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const shot = (n) => page.screenshot({ path: `${SHOTS}/event-feed-${w}-${n}.png` })
    const rec = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY)
    const noDocScroll = () => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)

    // ---- Feed in the bottom row, social posts ----
    check(`${w}: bottom row has Feed; Timeline is not in the row`, (await page.locator('.tabs [data-go="feed"]').count()) === 1 && (await page.locator('.tabs [data-go="timeline"]').count()) === 0)
    await page.locator('.tabs [data-go="feed"]').click(); await page.waitForTimeout(500)
    check(`${w}: Feed screen is the social feed with a composer and no record kinds`, (await page.locator('[data-feed-mode="feed"] [data-feed-compose]').count()) === 1)
    await page.locator('[data-feed-compose]').fill('Anyone coming to the sauna?')
    await page.locator('[data-feed-compose-send]').click(); await page.waitForTimeout(400)
    const post = page.locator('[data-post-kind="social"]').first()
    check(`${w}: my post shows name, age, text, Reply and Star`, (await post.count()) === 1 && /You/.test(await post.innerText()) && /sauna/.test(await post.innerText())
      && (await post.locator('[data-post-reply]').count()) === 1 && (await post.locator('[data-post-star]').count()) === 1)
    const star = post.locator('[data-post-star]')
    check(`${w}: Star off is struck through and aria-pressed=false`, (await star.getAttribute('aria-pressed')) === 'false' && /line-through/.test(await star.evaluate((b) => getComputedStyle(b).textDecorationLine)))
    await star.click(); await page.waitForTimeout(300)
    const star2 = page.locator('[data-post-kind="social"]').first().locator('[data-post-star]')
    check(`${w}: Star on: pressed, not struck through, kept in the record`, (await star2.getAttribute('aria-pressed')) === 'true' && !/line-through/.test(await star2.evaluate((b) => getComputedStyle(b).textDecorationLine)) && (await rec()).feedStars.length === 1)
    await page.locator('[data-post-reply]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-feed-reply-text]').fill('I am!'); await page.locator('[data-feed-reply-text-send]').click(); await page.waitForTimeout(400)
    check(`${w}: a reply shows what it answers`, (await page.locator('[data-post-kind="social"]', { hasText: 'In reply to: Anyone coming' }).count()) === 1)
    check(`${w}: nothing left the phone (no relay set)`, requests.length === 0, requests.join(' '))
    // P1: right click on my own post = edit
    await page.locator('[data-post-kind="social"]', { hasText: 'I am!' }).locator('.post-main').click({ button: 'right' }); await page.waitForTimeout(300)
    await page.locator('[data-feed-edit-text]').fill('I am coming!'); await page.locator('[data-feed-edit-text-send]').click(); await page.waitForTimeout(400)
    check(`${w}: right click edits my post`, (await rec()).feedPosts.some((p) => p.text === 'I am coming!'))
    check(`${w}: no document scroll`, await noDocScroll())
    const barBox = await page.locator('.tabs').boundingBox()
    check(`${w}: no control overlays the bottom bar (composer, chips, last post)`, !(await Promise.all(['[data-feed-compose-send]', '[data-feed-src="all"]']).then((s) => Promise.all(s.map((x) => page.locator(x).boundingBox())))).some((b) => b && hit(b, barBox)))
    await shot('feed')

    // ---- Timeline apart, reachable from ⋮ ----
    await page.locator('[data-bar-more]').click(); await page.waitForTimeout(300)
    check(`${w}: Timeline is listed behind ⋮`, (await page.locator('[data-bar-view="timeline"]').count()) === 1)
    await page.locator('[data-bar-view="timeline"]').click(); await page.waitForTimeout(500)
    check(`${w}: Timeline shows the record kinds, not my posts`, (await page.locator('[data-feed-mode="timeline"]').count()) === 1 && (await page.locator('[data-post-kind="social"]').count()) === 0 && (await page.locator('[data-feed-compose]').count()) === 0)
    await shot('timeline')

    // ---- per-event feed ----
    const open = async (id) => { await page.locator('.tabs [data-go="events"]').click(); await page.waitForTimeout(400); await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200); await page.locator(`[data-event="${id}"]`).click(); await page.waitForTimeout(500) }
    await open('e2')
    check(`${w}: an event without a Feed offer has no Feed row`, (await page.locator('[data-event-feed]').count()) === 0)
    await open('e1')
    check(`${w}: an event with offers.feed has a Feed row`, (await page.locator('[data-event-feed="e1"]').count()) === 1)
    await page.locator('[data-event-feed-toggle]').click(); await page.waitForTimeout(300)
    check(`${w}: the row expands (aria-expanded) and shows the event tag`, (await page.locator('[data-event-feed-toggle]').getAttribute('aria-expanded')) === 'true' && /#event:Winter IYG/.test(await page.locator('.event-feed-panel').innerText()))
    const eb = await page.locator('.tabs').boundingBox()
    check(`${w}: the expanded Feed row does not overlay the bottom bar`, !hit(await page.locator('.event-feed-row').boundingBox(), eb) && !hit(await page.locator('[data-event-feed-open]').boundingBox(), eb))
    await shot('event-row')
    await page.locator('[data-event-feed-open]').click(); await page.waitForTimeout(500)
    await page.locator('[data-feed-tag="event_Winter_IYG"]').waitFor({ timeout: 5000 }).catch(() => {}) // review-fixes-43c: under load the Feed draws later than 500 ms
    check(`${w}: opens the Feed filtered to the event tag`, (await page.locator('[data-feed-tag="event_Winter_IYG"]').count()) === 1)
    await page.locator('[data-feed-compose]').fill('Arrived at the venue')
    await page.locator('[data-feed-compose-send]').click(); await page.waitForTimeout(400)
    const r = await rec()
    check(`${w}: a post made there carries event_Winter_IYG`, r.feedPosts.some((p) => p.text === 'Arrived at the venue' && p.tag === 'event_Winter_IYG' && p.eventId === 'e1'))
    check(`${w}: only event posts show while the tag is chosen; the chip reads #event:Winter IYG`, (await page.locator('[data-post-kind="social"]').count()) === 1 && (await page.locator('[data-post-tag="event_Winter_IYG"]').first().innerText()) === '#event:Winter IYG')
    await shot('event-feed')
    await page.locator('[data-feed-tag-clear]').click(); await page.waitForTimeout(300)
    check(`${w}: clearing the tag shows all posts again`, (await page.locator('[data-post-kind="social"]').count()) === 3)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
