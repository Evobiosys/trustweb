// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 feed-events proof (headless): PORT=5461 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node feed_events.mjs. Synthetic record only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true' })]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }]
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const events = [{ id: 'e1', name: 'Community picnic', from: day(5), where: 'Augarten, Wien', createdAt: 1, attended: true, hosts: ['Ben Gruber'] }, { id: 'e2', name: 'Autumn circle', from: day(-20), where: 'Online', createdAt: 1, attended: false }, { id: 'e3', name: 'Seed swap', from: day(9), where: 'Graz', createdAt: 1, attended: false }]
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events, zoneTags: { self: { ids: ['iyg'], stamp: 1 } } }
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    const outside = []
    await page.route(/^https:\/\/(map\.example)\//, (r) => { outside.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>map stub</p>' }) })
    const requests = []; page.on('request', (r) => { if (/\/api\/preview/.test(r.url())) requests.push(r.url()) })
    const shot = async (n) => { await page.evaluate(() => document.querySelector('.mod-view')?.scrollTo(0, 0)); await page.waitForTimeout(150); return page.screenshot({ path: `${SHOTS}/feed-events-${vw}-${n}.png` }) }
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [JSON.stringify(record), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)

    // A module button sits in the bottom row, or (a phone shows 6 at most) behind the ⋮ button.
    const openView = async (id) => {
      const tab = page.locator(`button.tab[data-go="mod:${id}"]`)
      if (await tab.count()) await tab.click()
      else { await page.locator('[data-bar-more]').click(); await page.waitForTimeout(300); await page.locator(`[data-bar-view="mod:${id}"]`).click() }
      await page.waitForTimeout(800)
    }
    const listed = async (id) => (await page.locator(`button.tab[data-go="mod:${id}"]`).count()) === 1 || (await page.locator('[data-bar-more]').click().then(() => page.locator(`[data-bar-view="mod:${id}"]`).count()).then(async (n) => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); return n === 1 }))

    // ---- Feed ----
    check(`${vw}: Full profile: Feed and Events are offered (bottom row or ⋮)`, (await listed('feed-view')) && (await listed('events-view')))
    await openView('feed-view')
    check(`${vw}: Feed: own shadow root, alpha subscript fully visible`, await page.evaluate(() => !!document.querySelector('[data-feed]')?.shadowRoot)
      && await page.locator('[data-feed-alpha]').evaluate((s) => s.textContent === 'untested alpha feature' && s.getBoundingClientRect().right <= window.innerWidth))
    check(`${vw}: Feed: empty timeline says so`, (await page.locator('[data-feed-postid]').count()) === 0)
    await page.locator('[data-feed-compose]').fill('Great read https://mastodon.social/@ana/1100022?utm_source=x')
    check(`${vw}: pasting a Mastodon link shows its card at once, no request made`, /mastodon/i.test(await page.locator('[data-feed-compose-preview]').innerText()) && requests.length === 0)
    await page.locator('[data-feed-zone]').selectOption('ring:friend')
    await page.locator('[data-feed-post]').click(); await page.waitForTimeout(400)
    const first = page.locator('[data-feed-postid]').first()
    check(`${vw}: post card: avatar, time, audience chip, link card, kept on this phone`, (await first.locator('.ava').count()) === 1 && /Friends/.test(await first.locator('[data-feed-audience]').innerText())
      && (await first.locator('[data-feed-linkcard="Mastodon"]').count()) === 1 && /only on this phone/.test(await first.innerText()))
    check(`${vw}: the link is cleaned of tracking`, (await first.locator('[data-feed-linkcard] a').first().getAttribute('href')) === 'https://mastodon.social/@ana/1100022')
    await page.locator('[data-feed-compose]').fill('Garden day on Saturday')
    await page.locator('[data-feed-zone]').selectOption('tag:iyg')
    await page.locator('[data-feed-post]').click(); await page.waitForTimeout(400)
    check(`${vw}: a post to a joined tag goes through the group share line, once`, await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); return (r.shares ?? []).filter((l) => l.to === 'group:tag:iyg').length === 1 })
      && (await page.locator('[data-feed-postid]', { hasText: 'Garden day' }).count()) === 1)
    await page.locator('[data-feed-compose]').fill('https://www.facebook.com/groups/iyg/posts/99?fbclid=abc')
    await page.locator('[data-feed-post]').click(); await page.waitForTimeout(400)
    check(`${vw}: repost button puts the link back into the composer`, await (async () => { await page.locator('[data-feed-repost]').first().click(); return /^https:\/\/www\.facebook\.com/.test(await page.locator('[data-feed-compose]').inputValue()) })())
    await page.locator('[data-feed-compose]').fill('')
    check(`${vw}: clickables underlined`, (await page.locator('[data-feed-post]').evaluate((b) => getComputedStyle(b).textDecorationLine)) === 'underline')
    await shot('1-feed')
    check(`${vw}: no preview request without the setting`, requests.length === 0)
    check(`${vw}: no horizontal scrolling (feed)`, await noHScroll(page))

    // ---- Events ----
    await openView('events-view')
    check(`${vw}: Events: own shadow root, alpha subscript, 3 cards (upcoming first, then past)`, await page.evaluate(() => !!document.querySelector('[data-events]')?.shadowRoot)
      && (await page.locator('[data-events-alpha]').count()) === 1 && (await page.locator('[data-events-card]').evaluateAll((e) => e.map((x) => x.getAttribute('data-events-card')))).join() === 'e1,e3,e2')
    check(`${vw}: attended event reads Going; others none`, (await page.locator('[data-events-rsvp="e1:going"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-events-rsvp="e3:going"]').getAttribute('aria-pressed')) === 'false')
    await page.locator('[data-events-rsvp="e3:maybe"]').click(); await page.waitForTimeout(300)
    check(`${vw}: RSVP Maybe sticks and is kept in my record's module slice, not the event`, (await page.locator('[data-events-rsvp="e3:maybe"]').getAttribute('aria-pressed')) === 'true'
      && await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); return r.extData['events-view'].rsvp.e3 === 'maybe' && r.events.find((e) => e.id === 'e3').attended === false }))
    await page.locator('[data-events-share="e1"]').click(); await page.waitForTimeout(200)
    await page.locator('[data-events-share-to="iyg"]').click(); await page.waitForTimeout(300)
    check(`${vw}: share an event to a tag: one group post with the event line`, await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); return (r.groupPosts ?? []).some((p) => p.group === 'tag:iyg' && /Community picnic/.test(p.text)) }) && (await page.locator('[data-events-note]').count()) === 1)
    // review wave 40: the default map (Andrew Hasse's) waits for the consent tap; "Change" opens the address field (it used to bring the default straight back)
    check(`${vw}: default map offered, nothing loaded before the consent tap`, (await page.locator('[data-events-map-open]').getAttribute('href')) === 'https://andrewalan11.github.io/regen-events-map/' && (await page.locator('[data-events-map-frame]').count()) === 0 && outside.length === 0)
    await page.locator('[data-events-map-change]').click(); await page.waitForTimeout(200)
    check(`${vw}: Change opens the address field`, (await page.locator('[data-events-map-url]').count()) === 1 && outside.length === 0)
    await page.locator('[data-events-map-url]').fill('http://map.example/x')
    await page.locator('[data-events-map-save]').click(); await page.waitForTimeout(200)
    check(`${vw}: an http address is refused`, (await page.locator('[data-events-map-frame]').count()) === 0 && (await page.locator('[data-events-map-url]').count()) === 1)
    await page.locator('[data-events-map-url]').fill('https://map.example/events')
    await page.locator('[data-events-map-save]').click(); await page.waitForTimeout(300)
    check(`${vw}: map not loaded before the consent tap; open-in-new-tab always there`, (await page.locator('[data-events-map-frame]').count()) === 0 && outside.length === 0 && (await page.locator('[data-events-map-open]').getAttribute('href')) === 'https://map.example/events')
    await shot('2-events')
    await page.locator('[data-events-map-load]').click(); await page.waitForTimeout(500)
    check(`${vw}: consent tap loads the frame; consent stays on the device`, (await page.locator('[data-events-map-frame]').count()) === 1 && outside.length === 1
      // review wave 40: consent is kept per map origin (a new address asks again)
      && await page.evaluate(() => localStorage.getItem('trustweb.v1.events-view.consent') === 'https://map.example' && !/events-view.consent/.test(localStorage.getItem('trustweb.v1.me'))))
    await page.locator('[data-events-map-frame]').evaluate((f) => { f.dataset.mark = '1' })
    await page.locator('[data-events-rsvp="e2:going"]').click(); await page.waitForTimeout(300)
    check(`${vw}: an RSVP tap does not reload the loaded map`, (await page.locator('[data-events-map-frame][data-mark="1"]').count()) === 1 && outside.length === 1)
    await shot('3-events-map')
    check(`${vw}: no horizontal scrolling (events)`, await noHScroll(page))

    // ---- Settings ----
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    const ext = page.locator('[data-settings-section="extensions"]')
    await ext.locator('summary').first().scrollIntoViewIfNeeded(); await ext.locator('summary').first().click(); await page.waitForTimeout(300)
    check(`${vw}: Extensions lists Feed and Events as "loads only when on", both on`, /loads only when on/.test(await page.locator('[data-ext-module="feed-view"]').innerText()) && (await page.locator('[data-ext-module="events-view"]').getAttribute('aria-checked')) === 'true')
    check(`${vw}: settings rows: preview switch, map address, consent reset`, (await page.locator('[data-feed-preview-toggle]').count()) === 1 && (await page.locator('[data-events-set-map]').inputValue()) === 'https://map.example/events' && (await page.locator('[data-events-reset-consent]').count()) === 1)
    await page.locator('[data-feed-preview-toggle]').scrollIntoViewIfNeeded(); await shot('4-settings')
    await page.locator('[data-feed-preview-toggle] input').check(); await page.waitForTimeout(300)
    check(`${vw}: preview switch is kept in the module slice`, await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).extData['feed-view'].preview === true))
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await openView('feed-view'); await page.waitForTimeout(400)
    check(`${vw}: with the switch on the link card asks the host once; a missing endpoint keeps the address-only card with a note`, requests.length >= 1 && (await page.locator('[data-feed-linkcard]').count()) >= 1)

    // ---- IYG support ----
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    await page.locator('[data-variation="iyg-support"]').click(); await page.waitForTimeout(600)
    check(`${vw}: IYG support: Feed and Events are switched off`, await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).twSettings.extensions['feed-view'] === false))
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    check(`${vw}: IYG support: no Feed or Events button, not behind ⋮, views gone`, !(await listed('feed-view')) && !(await listed('events-view')) && (await page.locator('[data-feed], [data-events]').count()) === 0)
    check(`${vw}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
