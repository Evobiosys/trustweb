// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-embed (headless, stock dev only, remote hosts route-mocked): PORT=5449 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node feed_embed.mjs. Synthetic record only. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5449}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
const record = { v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [], people: [], events: [{ id: 'e1', name: 'Winter IYG', from: '2099-01-01', where: 'Wien', createdAt: 1, attended: true }] }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const MASTO = 'https://mastodon.social/@alice/111222333'
const BSKY = 'https://bsky.app/profile/ann.bsky.social/post/3kabc'
const answers = {
  'https://mastodon.social/api/v1/statuses/111222333': { id: '111222333', visibility: 'public', created_at: '2026-11-15T08:00:00.000Z', url: MASTO, content: '<p>Hello from <b>Mastodon</b></p>', account: { username: 'alice', acct: 'alice', display_name: 'Alice Fedi' }, media_attachments: [] },
  'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=ann.bsky.social': { did: 'did:plc:zzz' },
  [`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent('at://did:plc:zzz/app.bsky.feed.post/3kabc')}&depth=0&parentHeight=0`]: { thread: { post: { author: { displayName: 'Ann Sky', handle: 'ann.bsky.social' }, record: { text: 'Hello from Bluesky', createdAt: '2026-11-14T10:00:00.000Z' } } } },
}
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; const outside = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.route((u) => !u.href.startsWith(URL) && !/^(data|blob):/.test(u.href), (route) => {
      const u = route.request().url()
      outside.push(u)
      const body = answers[u]
      return body ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }) : route.abort()
    })
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([k, r]) => localStorage.setItem(k, r), [KEY, JSON.stringify(record)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const rec = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY)
    await page.locator('.tabs [data-go="feed"]').click(); await page.waitForTimeout(500)
    const box = page.locator('[data-feed-compose]'); const embed = page.locator('[data-feed-embed]')
    check(`${w}: no Embed button before a link is typed`, !(await embed.isVisible()))
    await box.fill('just some words'); check(`${w}: words alone: no Embed button`, !(await embed.isVisible()))
    for (const [link, who, text] of [[MASTO, 'Alice Fedi', 'Hello from Mastodon'], [BSKY, 'Ann Sky', 'Hello from Bluesky']]) {
      await box.fill(link)
      check(`${w}: a lone link shows "Embed this post"`, await embed.isVisible())
      await embed.click(); await page.waitForTimeout(700)
      const p = page.locator(`[data-post="embed:${link}"]`)
      check(`${w}: ${who} embedded with author and text`, (await p.count()) === 1 && (await p.innerText()).includes(who) && (await p.innerText()).includes(text), await p.allInnerTexts())
    }
    await box.fill('https://x.com/someone/status/1'); await embed.click(); await page.waitForTimeout(500)
    const card = page.locator('[data-post="embed:https://x.com/someone/status/1"]')
    check(`${w}: x.com is a link card showing the domain`, (await card.count()) === 1 && (await card.innerText()).includes('x.com'))
    check(`${w}: only the two post hosts were asked, x.com never`, outside.length === 3 && outside.every((u) => /^https:\/\/(mastodon\.social|public\.api\.bsky\.app)\//.test(u)), outside.join(' '))
    check(`${w}: three embeds kept in the record, composer emptied`, (await rec()).feedEmbeds?.length === 3 && (await box.inputValue()) === '' && !(await embed.isVisible()))
    check(`${w}: no iframe or script from outside`, (await page.locator('iframe').count()) === 0)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    check(`${w}: no document scroll`, await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1))
    await box.fill(MASTO)
    const barBox = await page.locator('.tabs').boundingBox()
    const boxes = await Promise.all(['[data-feed-embed]', '[data-feed-compose-send]', '[data-feed-compose]', '[data-feed-src="all"]'].map((s) => page.locator(s).boundingBox()))
    check(`${w}: composer, Embed button and chips overlap neither each other nor the bottom bar`, boxes.every((b) => b && !hit(b, barBox)) && ![[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3]].some(([a, b]) => hit(boxes[a], boxes[b])), JSON.stringify(boxes))
    await page.screenshot({ path: `${SHOTS}/feed-embed-${w}.png` })
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
