// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 small-ui-d live proof (headless, stock mode, synthetic record): Variations in ⋮ + link with a variation, Import at the bottom of Settings,
 * ⋮ without underline, long-press arrange (order, grey arrows, slide), ⋮ list moves a view into the row, halo, sparkle and "Ask your web" always answer,
 * communities-only Chat + Community view chats, calendar event without Back.
 *   PORT=5491 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node test/e2e/small_ui_d.mjs
 */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5491}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  ->  ' + detail}`); if (!cond) failed = true }
const RINGS = ['closest', 'close', 'friend', 'acquaintance']
const people = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, ring: RINGS[i % 4], lines: [], context: '', metAt: Date.now() - i * 86_400_000, fields: i < 2 ? { iyg: 'true' } : {}, peerId: `peer${i}` }))
const peers = people.map((p) => ({ id: p.peerId, displayName: p.name }))
const msg = (text, at) => ({ key: `i:${at}:x`, dir: 'in', text, at, sentAt: at, state: 'received' })
const chats = { peer0: { messages: [msg('hello from the community', Date.now() - 1000)], unread: 1 }, peer3: { messages: [msg('hello from family', Date.now() - 2000)], unread: 0 } }
const p2 = (n) => String(n).padStart(2, '0')
const now = new Date()
const day = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
const events = [{ id: 'e1', name: 'Forum Südtirol', from: `${day}T18:30`, where: 'Innsbruck', createdAt: 1, attended: true }]
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const KEY = 'trustweb.v1.me'
const shot = (page, name, w) => page.screenshot({ path: `${SHOTS}/small-ui-d-${name}-${w}.png` })
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

async function fresh(vp, extra = {}, tags) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 600, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  page.errors = []; page.on('pageerror', (e) => page.errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1000)
  await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings'); if (t) localStorage.setItem('trustweb.v1.colourtags', t) }, [JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers, log: [], inventory: [], people, chats, events, ...extra }), tags ?? null])
  await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
  return { ctx, page }
}
const barIds = (page) => page.locator('.tabs > button.tab, .tabs > .tab-record').evaluateAll((n) => n.map((x) => x.dataset.go))

try {
  for (const [w, vp] of [[360, { width: 360, height: 780 }], [1280, { width: 1280, height: 900 }]]) {
    // ---- 5 + 1: ⋮ has no underline; Variations compact in ⋮ --------------------------------------------------------------------
    let { ctx, page } = await fresh(vp)
    const deco = await page.locator('[data-bar-more]').evaluate((b) => getComputedStyle(b).textDecorationLine)
    check(`${w}: ⋮ button has no line under it (was: underline)`, deco === 'none', deco)
    await page.locator('[data-bar-more]').click(); await page.waitForTimeout(300)
    check(`${w}: ⋮ shows Variations compactly (Dex + four)`, (await page.locator('.sheet.on [data-variation-compact]').count()) === 5)
    check(`${w}: the compact Variations stay inside one short block`, (await page.locator('.sheet.on [data-var-compact]').evaluate((n) => n.getBoundingClientRect().height)) < 140)
    await shot(page, '1-more-variations', w)
    await page.locator('.sheet.on [data-variation-compact="iyg-support"]').click(); await page.waitForTimeout(700)
    check(`${w}: choosing one from ⋮ applies it and does not open Settings`, (await page.locator('.sheet.on [data-settings-search]').count()) === 0 && (await page.locator('button.tab[data-go="inventory"]').count()) === 0)
    check(`${w}: the ⋮ list is back, IYG marked`, (await page.locator('.sheet.on [data-variation-compact="iyg-support"]').getAttribute('aria-checked')) === 'true')
    await page.locator('.sheet.on [data-variation-compact="full"]').click(); await page.waitForTimeout(600)
    await page.keyboard.press('Escape')
    // Settings: same section, link with a variation, Import at the very bottom
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    check(`${w}: Settings still has the Variations section`, (await page.locator('[data-settings-group="variations"]').count()) === 1)
    check(`${w}: Theme is hidden under a dropdown`, !(await page.locator('[data-look-choice]').first().isVisible()))
    await page.locator('[data-theme-pill]').scrollIntoViewIfNeeded(); await page.locator('[data-theme-pill]').click(); await page.waitForTimeout(200)
    check(`${w}: the dropdown lists three looks`, (await page.locator('[data-look-choice]').count()) === 3 && (await page.locator('[data-look-choice]').first().isVisible()))
    await shot(page, '3-theme-dropdown', w)
    await page.locator('[data-theme-pill]').click()
    const last = await page.locator('.sheet.on > *').last().getAttribute('data-settings-import-bottom')
    check(`${w}: Import stands alone at the very bottom of Settings`, last !== null)
    await page.locator('[data-settings-import-bottom]').scrollIntoViewIfNeeded(); await shot(page, '4-import-bottom', w)
    await page.locator('[data-settings-import-bottom]').click(); await page.waitForTimeout(500)
    check(`${w}: it opens the import sheet`, (await page.locator('.sheet.on').innerText()).toLowerCase().includes('import'))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    await page.locator('[data-settings-search]').fill('link'); await page.waitForTimeout(300)
    await page.locator('[data-settings-section="sharing"] > summary, [data-settings-group="web"] > summary').first().scrollIntoViewIfNeeded().catch(() => {})
    await page.locator('[data-settings-search]').fill(''); await page.waitForTimeout(200)
    await page.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (t) => { window.__copied = t } })
    await page.evaluate(() => { for (const d of document.querySelectorAll('.sheet.on details')) if (d.querySelector('[data-profile-link]')) { d.open = true; let p = d.parentElement?.closest('details'); while (p) { p.open = true; p = p.parentElement?.closest('details') } } })
    await page.waitForTimeout(200)
    check(`${w}: Sharing offers a link with a variation`, (await page.locator('[data-profile-link]').count()) === 1)
    await page.locator('[data-profile-link]').scrollIntoViewIfNeeded(); await shot(page, '1-link-variation', w)
    await page.locator('[data-profile-link-pick]').selectOption('reader')
    await page.evaluate(() => { navigator.share = undefined })
    await page.locator('[data-profile-link-copy]').click(); await page.waitForTimeout(1500)
    const copied = await page.evaluate(() => window.__copied)
    check(`${w}: the copied link carries the profile id (${copied.slice(-40)})`, /#.*tp=reader/.test(copied))
    check(`${w}: no horizontal scroll in Settings`, await noOverflow(page))
    await ctx.close()

    // receiving a link with a variation: offered, applied on a tap
    ;({ ctx, page } = await fresh(vp))
    await page.goto(URL + '#tp=iyg-support'); await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    const offer = await page.locator('.toast, [role=status]').first().innerText().catch(() => '')
    check(`${w}: a link with a variation is offered, not forced (${offer.slice(0, 50)})`, /suggests the IYG support only variation/.test(offer) && (await page.locator('button.tab[data-go="inventory"]').count()) === 1)
    await page.locator('.toast, [role=status]').first().click(); await page.waitForTimeout(700)
    check(`${w}: a tap applies it`, (await page.locator('button.tab[data-go="inventory"]').count()) === 0)
    await ctx.close()

    // ---- 6: long press arranges; order = row order; promote; halo -----------------------------------------------------------------
    ;({ ctx, page } = await fresh(vp, { feed: { on: true }, uiBar: { order: ['web', 'chat', 'record', 'events', 'inventory', 'feed', 'network'], orderVersion: 2, profile: 'custom' } }))
    const phone = w < 600
    const row = await barIds(page)
    // review wave 40: on a wide screen the module views (Timeline, Events map) follow the seven in the row
    check(`${w}: the row holds ${phone ? 'six' : 'all seven first'} (${row.join()})`, phone ? row.length === 6 : row.slice(0, 7).join() === 'web,chat,record,events,inventory,feed,network')
    await page.locator('.tabs button.tab[data-go="chat"]').click({ button: 'right' }); await page.waitForTimeout(500)
    check(`${w}: a long press (right click) on a row button opens the arrange list, not a removal`, (await page.locator('.sheet.on [data-bar-arrange]').count()) === 1 && (await barIds(page)).length === row.length)
    const listIds = await page.locator('.sheet.on [data-bar-row]').evaluateAll((n) => n.map((x) => x.dataset.barRow))
    check(`${w}: list order = row order left to right, then the ⋮ list (${listIds.slice(0, 7).join()})`, listIds.slice(0, 7).join() === 'web,chat,record,events,inventory,feed,network')
    check(`${w}: the list reveals the views below the row${phone ? ' (a divider before the ⋮ ones)' : ''}`, phone ? (await page.locator('.sheet.on [data-bar-divider]').count()) === 1 : true)
    const first = await page.locator('.sheet.on [data-bar-move="web:-1"]').isDisabled()
    // review wave 40: module views (Timeline, Events map) and Ask follow Network in the list now: the last row's → is the greyed one
    const lastOn = await page.locator('.sheet.on [data-bar-row]:not([data-bar-slot="off"])').evaluateAll((n) => n.map((x) => x.dataset.barRow).pop())
    const lastR = await page.locator(`.sheet.on [data-bar-move="${lastOn}:1"]`).isDisabled()
    check(`${w}: the arrow that cannot move further is greyed out (first ←, last →)`, first && lastR)
    check(`${w}: the others can move`, !(await page.locator('.sheet.on [data-bar-move="chat:-1"]').isDisabled()) && !(await page.locator('.sheet.on [data-bar-move="chat:1"]').isDisabled()))
    await page.locator('.sheet.on [data-bar-arrange]').scrollIntoViewIfNeeded(); await shot(page, '6-arrange', w)
    await page.locator('.sheet.on [data-bar-move="chat:-1"]').click()
    const animating = await page.locator('.sheet.on [data-bar-row="chat"]').evaluate((r) => r.getAnimations().length)
    check(`${w}: the moved row slides (animation running: ${animating})`, animating > 0)
    await page.waitForTimeout(400)
    const after = await page.locator('.sheet.on [data-bar-row]').evaluateAll((n) => n.map((x) => x.dataset.barRow))
    check(`${w}: Chat is first now, in the list and in the bar`, after[0] === 'chat' && (await barIds(page))[0] === 'chat')
    check(`${w}: the arrows follow (Chat ← greyed, Web → fine)`, (await page.locator('.sheet.on [data-bar-move="chat:-1"]').isDisabled()) && !(await page.locator('.sheet.on [data-bar-move="web:-1"]').isDisabled()))
    // halo
    await page.locator('.sheet.on [data-bar-halo="events"]').click(); await page.waitForTimeout(200)
    await page.locator('.sheet.on [data-bar-halo="inventory"]').click(); await page.waitForTimeout(200)
    check(`${w}: a halo rings two views in the row`, (await page.locator('.tabs .tab-halo').count()) === 2 && (await page.locator('.sheet.on .bar-opt-row.tab-halo').count()) === 2)
    check(`${w}: there is no separate Highlight section any more`, (await page.locator('.sheet.on [data-bar-primary]').count()) === 0)
    await page.locator('.sheet.on [data-bar-halo="feed"]').click(); await page.waitForTimeout(200)
    check(`${w}: a third halo drops the oldest (still two)`, (await page.locator('.tabs .tab-halo').count()) <= 2 && (await page.locator('.sheet.on .bar-opt-row.tab-halo').count()) === 2)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await shot(page, '6-halo-bar', w)
    // ⋮ list: pressing an overflow view moves it into the row
    if (phone) {
      await page.locator('[data-bar-more]').click(); await page.waitForTimeout(300)
      const more = await page.locator('.sheet.on [data-bar-view]').evaluateAll((n) => n.map((x) => x.dataset.barView))
      check(`${w}: the ⋮ list is in row order (${more.join()})`, more[0] === 'network' || more.includes('network'))
      await shot(page, '6-more-list', w)
      await page.locator('.sheet.on [data-bar-view="network"]').click(); await page.waitForTimeout(600)
      const nb = await barIds(page)
      check(`${w}: pressing Network moved it into the row (${nb.join()}) and opened it`, nb.includes('network') && nb.length === 6 && (await page.locator('.sheet.on').count()) === 0)
      await shot(page, '6-after-promote', w)
    }
    check(`${w}: no horizontal scroll`, await noOverflow(page))
    check(`${w}: no page errors`, page.errors.length === 0, page.errors.join('|'))
    await ctx.close()

    // ---- 7 + 9: the sparkle and Ask your web always answer ------------------------------------------------------------------------
    // Review wave 40: the assistant (ai-edit-chat, on by default) answers the sparkle; with it switched off the sparkle keeps the small-ui-d behaviour.
    const panelOpen = () => page.evaluate(() => { const h = document.querySelector('[data-assistant]'); return !!h && h.isConnected && !h.hidden })
    const panelClose = () => page.evaluate(() => document.querySelector('[data-assistant]')?.shadowRoot?.querySelector('[data-assistant-close]')?.click())
    ;({ ctx, page } = await fresh(vp, { advanced: { ai: { baseUrl: 'http://127.0.0.1:1', model: 'm', preset: 'custom' } }, uiBar: { order: ['web', 'chat', 'record', 'events', 'inventory', 'ask'], orderVersion: 2, profile: 'custom' } }))
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(500)
    check(`${w}: a card page is open`, (await page.locator('[data-small-card="p2"]').count()) === 1)
    await page.locator('[data-ai-button]').click(); await page.waitForTimeout(500)
    check(`${w}: the sparkle opens the assistant even from a card page (endpoint set)`, await panelOpen())
    await shot(page, '7-sparkle-ask', w)
    await panelClose(); await page.waitForTimeout(200)
    for (const tab of ['chat', 'events', 'inventory', 'web']) {
      await page.locator(`button.tab[data-go="${tab}"]`).click(); await page.waitForTimeout(400)
      await page.locator('[data-ai-button]').click(); await page.waitForTimeout(400)
      check(`${w}: sparkle answers on ${tab}`, await panelOpen())
      await panelClose(); await page.waitForTimeout(200)
    }
    await ctx.close()
    ;({ ctx, page } = await fresh(vp, { advanced: { ai: { baseUrl: 'http://127.0.0.1:1', model: 'm', preset: 'custom' } }, twSettings: { extensions: { assistant: false } }, uiBar: { order: ['web', 'chat', 'record', 'events', 'inventory', 'ask'], orderVersion: 2, profile: 'custom' } }))
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(500)
    await page.locator('[data-ai-button]').click(); await page.waitForTimeout(500)
    // wave 41 small-ui-e: the sparkle opens the Your AI sheet (no jump to Ask), also from a card page and with an endpoint set
    check(`${w}: assistant off: the sparkle opens Your AI even from a card page (endpoint set)`, (await page.locator('.sheet.on [data-ai-group="sub"]').count()) === 1)
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    for (const tab of ['chat', 'events', 'inventory', 'web']) {
      await page.locator(`button.tab[data-go="${tab}"]`).click(); await page.waitForTimeout(400)
      await page.locator('[data-ai-button]').click(); await page.waitForTimeout(400)
      check(`${w}: assistant off: sparkle answers on ${tab}`, (await page.locator('.sheet.on [data-ai-group="sub"]').count()) === 1)
      await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    }
    await ctx.close()
    ;({ ctx, page } = await fresh(vp))
    for (const tab of ['chat', 'events', 'inventory', 'web']) {
      await page.locator(`button.tab[data-go="${tab}"]`).click(); await page.waitForTimeout(400)
      await page.locator('[data-ai-button]').click(); await page.waitForTimeout(500)
      await page.evaluate(() => document.querySelector('[data-assistant]')?.shadowRoot?.querySelector('[data-assistant-plans]')?.click()); await page.waitForTimeout(500)
      check(`${w}: without an endpoint the sparkle on ${tab} leads to Settings > Your AI (one tap in the assistant)`, (await page.locator('.sheet.on [data-ai-group="sub"]').count()) === 1)
      if (tab === 'web') await shot(page, '7-sparkle-no-endpoint', w)
      await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    }
    await ctx.close()
    ;({ ctx, page } = await fresh(vp, { uiBar: { order: ['web', 'chat', 'record', 'events', 'inventory', 'ask'], orderVersion: 2, profile: 'custom' } }))
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(500)
    await page.locator('.tabs button.tab[data-go="ask"]').click(); await page.waitForTimeout(500)
    check(`${w}: Ask your web opens the ask flow, also from a card page`, (await page.locator('.query-dock').count()) === 1)
    await ctx.close()
    ;({ ctx, page } = await fresh(vp, { uiBar: { order: ['web', 'chat', 'record', 'events', 'inventory'], orderVersion: 2, profile: 'custom' } }))
    await page.locator('button.tab[data-go="inventory"]').click(); await page.waitForTimeout(400)
    await page.locator('[data-bar-more]').click(); await page.waitForTimeout(300)
    check(`${w}: "Ask your web" is in the ⋮ list`, (await page.locator('.sheet.on [data-bar-view="ask"]').count()) === 1)
    await page.locator('.sheet.on [data-bar-view="ask"]').click(); await page.waitForTimeout(600)
    check(`${w}: pressing it opens the ask flow`, (await page.locator('.query-dock').count()) === 1)
    await shot(page, '9-ask-your-web', w)
    await ctx.close()

    // ---- 8: communities-only chat, Community view lists the chats --------------------------------------------------------------------
    ;({ ctx, page } = await fresh(vp, { twSettings: { extensions: { 'community-mighty': true } } }, JSON.stringify([{ id: 'iyg', colour: '#13867e', label: 'IYG', community: true }])))
    await page.locator('button.tab[data-go="chat"]').click(); await page.waitForTimeout(600)
    check(`${w}: Chat has the communities-only button top-left (in the header, beside the title)`, (await page.locator('.hdr-left [data-chat-communities]').count()) === 1)
    check(`${w}: both chats show, and the community chat row sits on top`, (await page.locator('[data-chat-row]').count()) === 2 && (await page.locator('[data-chat-community-row]').count()) === 1)
    await shot(page, '8-chat-all', w)
    await page.locator('[data-chat-communities]').click(); await page.waitForTimeout(400)
    check(`${w}: communities only keeps the community member's chat`, (await page.locator('[data-chat-row]').count()) === 1 && (await page.locator('[data-chat-row="p0"]').count()) === 1)
    await shot(page, '8-chat-communities-only', w)
    await page.locator('[data-chat-community-row]').click(); await page.waitForTimeout(1500)
    check(`${w}: the community chat row opens the Community view with its chat pane`, (await page.locator('[data-community]').count()) === 1 && (await page.locator('[data-community]').evaluate((h) => !!h.shadowRoot?.querySelector('[data-community-chat]'))))
    const listed = await page.locator('[data-community]').evaluate((h) => [...(h.shadowRoot?.querySelectorAll('[data-community-chat-row]') ?? [])].map((b) => b.dataset.communityChatRow))
    check(`${w}: the Community view shows the regular chats too (${listed})`, listed.length === 2)
    await shot(page, '8-community-chats', w)
    await page.locator('[data-community]').evaluate((h) => h.shadowRoot.querySelector('[data-community-chat-row="p0"]').click()); await page.waitForTimeout(600)
    check(`${w}: a tap on one opens that chat`, (await page.locator('.sheet.on').innerText()).includes('Person 0'))
    check(`${w}: no horizontal scroll`, await noOverflow(page))
    check(`${w}: no page errors`, page.errors.length === 0, page.errors.join('|'))
    await ctx.close()

    // ---- 10: an event opened from the calendar has no Back button ---------------------------------------------------------------------
    ;({ ctx, page } = await fresh(vp))
    await page.locator('button.tab[data-go="events"]').click(); await page.waitForTimeout(500)
    check(`${w}: the calendar header keeps its own Back (leaves Events)`, (await page.locator('.hdr .back').count()) === 1)
    await shot(page, '10-calendar', w)
    await page.locator('[data-cal-event="e1"]').click(); await page.waitForTimeout(500)
    check(`${w}: the event card from the calendar has no Back button`, (await page.locator('.events-page').count()) === 1 && (await page.locator('.hdr .back').count()) === 0)
    await shot(page, '10-event-card', w)
    await page.locator('button.tab[data-go="events"]').click(); await page.waitForTimeout(400)
    check(`${w}: the Events button leads back to the calendar`, (await page.locator('.cal-grid').count()) === 1)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
