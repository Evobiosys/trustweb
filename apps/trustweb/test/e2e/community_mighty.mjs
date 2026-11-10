// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 community-mighty proof (headless): PORT=5447 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node community_mighty.mjs. Synthetic record only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5447}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true', garden: 'true' }), person('p3', 'Dan Huber', 'acquaintance', {})]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }, { id: 'garden', colour: '#33456B', label: 'Garden', community: true }]
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const events = [{ id: 'e1', name: 'Community picnic', from: day(5), where: 'Augarten, Wien', createdAt: 1, attended: true, hosts: ['Ben Gruber'] }, { id: 'e2', name: 'Autumn circle', from: day(-20), where: 'Online', createdAt: 1, attended: false }]
const extData = { 'community-mighty': {
  resources: [{ id: 'r1', title: 'Circle guide', url: 'https://example.org/guide', by: 'Ben Gruber', at: 1 }, { id: 'r2', title: 'Shared calendar', url: 'https://example.org/cal', by: 'Cleo Maier', at: 2 }],
  views: [{ owner: 'Ben Gruber', order: ['r2', 'r1'], hidden: [] }],
} }
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events, extData }
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    const shot = (n) => page.screenshot({ path: `${SHOTS}/community-mighty-${vw}-${n}.png` })
    const nav = async (n) => {
      if (await page.locator('[data-community-menu]').isVisible()) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
      await page.locator(`[data-community-nav="${n}"]`).click(); await page.waitForTimeout(400)
    }
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [JSON.stringify(record), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    check(`${vw}: off by default: no Community button, no module chunk loaded`, (await page.locator('[data-go="mod:community"]').count()) === 0
      && !(await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /community_body/.test(e.name)))))

    // Settings > General > Extensions > Community on (loads at once, no reload)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    const ext = page.locator('[data-settings-section="extensions"]')
    await ext.locator('summary').first().scrollIntoViewIfNeeded(); await ext.locator('summary').first().click(); await page.waitForTimeout(300)
    check(`${vw}: Community switch says it loads only when on`, /loads only when on/.test(await page.locator('[data-ext-module="community-mighty"]').innerText()))
    await page.locator('[data-ext-module="community-mighty"]').click(); await page.waitForTimeout(1200)
    check(`${vw}: switch on`, (await page.locator('[data-ext-module="community-mighty"]').getAttribute('aria-checked')) === 'true')
    check(`${vw}: Settings > Extensions > Community rows: tag, 6 menu items, consent reset`, (await page.locator('[data-community-tag]').count()) === 1 && (await page.locator('[data-community-nav-toggle]').count()) === 6 && (await page.locator('[data-community-reset-consent]').count()) === 1)
    await page.locator('[data-community-tag]').scrollIntoViewIfNeeded(); await shot('0-settings')
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)

    const tab = page.locator('button.tab[data-go="mod:community"]')
    check(`${vw}: Community joined the bottom row`, (await tab.count()) === 1)
    await tab.click(); await page.waitForTimeout(700)
    check(`${vw}: heading carries the alpha subscript, fully visible`, /Community/.test(await page.locator('.hdr h2').innerText()) && await page.locator('[data-community-alpha]').evaluate((s) => s.textContent === 'untested alpha feature' && s.getBoundingClientRect().right <= window.innerWidth))
    check(`${vw}: view sits in a shadow root`, await page.evaluate(() => !!document.querySelector('[data-community]')?.shadowRoot))
    check(`${vw}: Home: composer asks to join a space first`, (await page.locator('[data-community-go="spaces"]').count()) === 1)
    check(`${vw}: Home: event and nothing else private shown (no asks)`, (await page.locator('[data-community-postid^="ask:"]').count()) === 0)
    await shot('1-home')

    await nav('spaces')
    check(`${vw}: Spaces: two community tags with member counts`, (await page.locator('[data-community-space]').count()) === 2 && /2 members/.test(await page.locator('[data-community-space="iyg"]').innerText()))
    await shot('2-spaces')
    await page.locator('[data-community-join="iyg"]').click(); await page.waitForTimeout(300)
    await page.locator('[data-community-open-space="iyg"]').click(); await page.waitForTimeout(300)
    check(`${vw}: space landing: cover, joined, composer`, (await page.locator('.cover.big').count()) === 1 && (await page.locator('[data-community-compose]').count()) === 1)
    await page.locator('[data-community-compose]').fill('Hello circle, picnic on Saturday?')
    await page.locator('[data-community-post]').click(); await page.waitForTimeout(400)
    check(`${vw}: the post shows in the space, marked as kept on this phone`, /Hello circle/.test(await page.locator('[data-community-postid]').first().innerText()) && /only on this phone/.test(await page.locator('[data-community-postid]').first().innerText()))
    await shot('3-space')
    await nav('home')
    check(`${vw}: the post shows on Home too`, /Hello circle/.test(await page.locator('[data-community-postid]').first().innerText()))
    check(`${vw}: it went out through a share line to that group only`, await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); return (r.shares ?? []).some((l) => l.to === 'group:tag:iyg') }))

    await nav('events')
    check(`${vw}: Events: upcoming card with date block, then past`, (await page.locator('[data-community-event]').count()) === 2 && /You are going/.test(await page.locator('[data-community-event="e1"]').innerText()))
    await shot('4-events')

    await nav('members')
    check(`${vw}: Members: the two people with the tag, ring chip`, (await page.locator('[data-community-member]').count()) === 2 && /Close friends/.test(await page.locator('[data-community-member="p1"]').innerText()))
    await shot('5-members')

    await nav('docs')
    check(`${vw}: Docs: others' links greyed with Add`, (await page.locator('[data-community-res][data-state="new"]').count()) === 2)
    await page.locator('[data-community-res-add="r2"]').click(); await page.waitForTimeout(300)
    check(`${vw}: Add moves it into my order`, (await page.locator('[data-community-res="r2"]').getAttribute('data-state')) === 'shown')
    await page.locator('[data-community-fork="Ben Gruber"]').click(); await page.waitForTimeout(300)
    check(`${vw}: fork from Ben: his order (r2, r1) as mine`, (await page.locator('[data-community-res][data-state="shown"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-community-res')))).join() === 'r2,r1')
    await page.locator('[data-community-docs-url]').fill('https://docs.google.com/document/d/e/2PACX-example/pub')
    await page.locator('[data-community-docs-save]').click(); await page.waitForTimeout(300)
    check(`${vw}: Google Doc not loaded before the consent tap`, (await page.locator('[data-community-docs-frame]').count()) === 0 && (await page.locator('[data-community-docs-load]').count()) === 1)
    check(`${vw}: clickables underlined`, (await page.locator('[data-community-docs-load]').evaluate((b) => getComputedStyle(b).textDecorationLine)) === 'underline')
    await shot('6-docs')

    await nav('chat')
    await page.locator('[data-community-chat-url]').fill('t.me/example_group')
    await page.locator('[data-community-chat-save]').click(); await page.waitForTimeout(300)
    check(`${vw}: Chat: nothing loads before consent; Open Telegram link offered`, (await page.locator('[data-community-chat-frame]').count()) === 0 && (await page.locator('[data-community-chat-open]').getAttribute('href')) === 'https://t.me/example_group')
    const pos = await page.locator('[data-community-chat]').evaluate((a) => getComputedStyle(a).position)
    check(`${vw}: chat is a ${vw === '360' ? 'bottom sheet' : 'pane'}`, vw === '360' ? pos === 'fixed' : pos === 'sticky')
    await shot('7-chat')
    check(`${vw}: no horizontal scrolling`, await noHScroll(page))

    await page.locator('[data-community-chat-close]').click(); await nav('members')
    await page.locator('[data-community-member="p1"]').click(); await page.waitForTimeout(700)
    check(`${vw}: tapping a member opens the app's person card`, (await page.locator('.screen.on.web').count()) === 1 && (await page.locator('[data-community]').count()) === 0)

    // Off again: the view and its bar button go, nothing of it stays mounted
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    if (!(await page.locator('[data-ext-module="community-mighty"]').isVisible())) { await ext.locator('summary').first().click(); await page.waitForTimeout(300) }
    await page.locator('[data-ext-module="community-mighty"]').click(); await page.waitForTimeout(600)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    check(`${vw}: off again: no Community button, no mounted view`, (await tab.count()) === 0 && (await page.locator('[data-community]').count()) === 0)
    check(`${vw}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
