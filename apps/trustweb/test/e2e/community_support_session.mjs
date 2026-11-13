// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-support: a group that just met in person and imported each other, two stock headless phones over a REAL test relay.
 *   A creates the community "Session" (switcher), adds B by B's code (Members "+" tile, same size as a member tile), B asks for support,
 *   A sees the ask (calm card + the one inbox list), A asks the community with a bundle and cancels, the Chat list hides the empty
 *   community chat and shows the Personal | Community switch, settings per community. Overlay boxes never intersect.
 * Synthetic data only; no record of the owner is touched (stock mode, localStorage of fresh contexts).
 * Run (PORT 5416): cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_VITE=<vite8 bin> TW_CHROMIUM_EXE=<headless shell> SHOTS=<dir> ../../node_modules/.bin/tsx ../trustweb/test/e2e/community_support_session.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, tally } from '../helpers/e2e_harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.PORT || 5416)
const SHOTS = process.env.SHOTS
const t = tally()
const errors = []

/** The harness relay, but its sender-auth audience is the page origin (the Vite proxy rewrites the Host header, so the default relay refuses every send). */
async function startApp(port) {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore(), senderAuthAudiences: [`http://127.0.0.1:${port}`] })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const vite = spawn(process.execPath, [process.env.TW_VITE, '--strictPort'], { cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(port), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` }, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)) }
  return { base: `http://127.0.0.1:${port}/`, async stop() { vite.kill('SIGTERM'); await relay.close?.() } }
}

const until = async (fn, ms = 20_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) } return null }
const rec = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const box = (l) => l.boundingBox()
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const shot = (p, n) => (SHOTS ? p.screenshot({ path: path.join(SHOTS, `community-support-${n}.png`) }) : null)

async function phone(browser, name, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(() => { addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(s) }) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, name }
}
async function start(page, base, name) {
  await page.goto(base)
  await page.waitForLoadState('networkidle')   // a fresh dev server reloads the page once (dependency pre-bundling): a name typed before that is lost
  await page.waitForTimeout(1500)
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}
const menu = async (page) => { if (await page.locator('.drawer-open, [data-community-menu][aria-expanded="true"]').count() === 0 && await page.locator('[data-community-menu]').isVisible()) await page.locator('[data-community-menu]').click() }

async function main() {
  const app = await startApp(PORT)
  const browser = await launch()
  try {
    const A = await phone(browser, 'Anna', { width: 360, height: 780 })
    const B = await phone(browser, 'Ben', { width: 360, height: 780 })
    await start(A.page, app.base, 'Anna'); await start(B.page, app.base, 'Ben')
    const a = A.page, b = B.page
    await b.locator('.hdr [aria-label^="Show my code"]').click(); await b.locator('.qrwrap canvas').waitFor({ timeout: 15_000 }); await b.getByRole('button', { name: 'Back' }).click()
    const bDid = (await rec(b)).identity.did

    // ---- 1 switcher
    await a.locator('[data-mode="community"]').click(); await a.locator('[data-community]').waitFor({ timeout: 15_000 })
    t.ok('1: Community view opens, heading carries a caret button', await a.locator('[data-community-switch]').count() === 1)
    await a.locator('[data-community-switch]').click()
    t.ok('1: the caret opens the list of my communities with "New community"', await a.locator('[data-community-switcher]').count() === 1 && await a.locator('[data-community-new-name]').count() === 1)
    // overlay: the dropdown never covers the bar's own controls
    const sw = await box(a.locator('[data-community-switcher]'))
    t.ok('1: the dropdown does not cover the menu button or the heading button', !overlap(sw, await box(a.locator('[data-community-menu]'))) && !overlap(sw, await box(a.locator('[data-community-switch]'))))
    t.ok('1: the dropdown stays inside the screen (no sideways scroll)', sw.x >= 0 && sw.x + sw.width <= 360 && await noHScroll(a))
    await shot(a, '360-1-switcher')
    await a.locator('[data-community-new-name]').fill('Session'); await a.locator('[data-community-new-kind]').selectOption('managed'); await a.locator('[data-community-create]').click()
    await until(async () => /Session/.test(await a.locator('[data-community-switch]').innerText()))
    t.ok('1: the new community is the one in force and managed', /Session/.test(await a.locator('[data-community-switch]').innerText()) && (await rec(a)).extData['community-mighty'].meta.session.kind === 'managed')
    await a.locator('[data-community-switch]').click()
    t.ok('1: the list now has the new community with its kind and member count', /Managed/.test(await a.locator('[data-community-pick="session"]').innerText()) && /0 members/.test(await a.locator('[data-community-pick="session"]').innerText()))
    await a.locator('[data-community-switch]').click()

    // ---- 2 members tile + add B by code
    await a.locator('.tabs [data-go="community:members"]').click(); await a.locator('[data-community-add-member]').waitFor()
    await a.locator('[data-community-add-member]').click(); await a.locator('.sheet.on [data-add-code]').waitFor()
    await a.locator('.sheet.on [data-add-code]').fill(bDid); await a.locator('.sheet.on [data-add-person]').click()
    t.ok('2: B is added through the community (membership tag set)', !!(await until(async () => (await rec(a)).people.some((p) => p.name === 'Ben' && p.fields?.session === 'true'))))
    t.ok('2: B\'s phone holds Anna (connected over the relay)', !!(await until(async () => (await rec(b)).people.some((p) => p.name === 'Anna' && p.peerId))))
    await a.locator('.sheet.on .sheet-home').click().catch(() => {}); await a.locator('.sheet.on').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
      await a.setViewportSize(vp); await a.waitForTimeout(500)
      await a.locator('.tabs [data-go="community:members"]').click().catch(() => {}); await a.locator('[data-community-member]').first().waitFor({ timeout: 10_000 })
      const m = await box(a.locator('[data-community-member]').first()), add = await box(a.locator('[data-community-add-member]'))
      t.ok(`2 @${vw}: the add tile has the size of a member tile`, Math.abs(m.width - add.width) < 1 && Math.abs(m.height - add.height) < 1, JSON.stringify([m, add]))
      t.ok(`2 @${vw}: the add tile comes last and the tiles do not overlap`, add.y >= m.y && !overlap(m, add))
      t.ok(`2 @${vw}: the tile shows only a centred "+"`, (await a.locator('[data-community-add-member]').innerText()).trim() === '+')
      await shot(a, `${vw}-2-members`)
    }
    await a.setViewportSize({ width: 360, height: 780 })

    // ---- 3 settings per community
    await menu(a)
    t.ok('3: the left column starts with "Ask for support"', await a.locator('[data-community-ask]').count() === 1)
    await a.locator('[data-community-settings]').click()
    t.ok('3: an organizer sees the settings (kind, ask button, sections)', await a.locator('[data-community-settings-panel]').count() === 1 && await a.locator('[data-community-nav-toggle]').count() === 6 && !(await a.locator('[data-community-ask-toggle]').isDisabled()))
    t.ok('3: B07 (review wave 42): the settings switches are TrustWeb switches, no native checkbox', await a.locator('[data-community-settings-panel] input[type=checkbox]').count() === 7 && await a.locator('[data-community-settings-panel] input[type=checkbox]:not(.tr-switch[role=switch])').count() === 0)
    await a.locator('[data-community-ask-toggle]').uncheck(); await a.locator('[data-community-nav-toggle="docs"]').uncheck()
    await a.locator('[data-community-settings-done]').click(); await menu(a)
    t.ok('3: switched off: no ask button, no Docs in the left column', await a.locator('[data-community-ask]').count() === 0 && await a.locator('[data-community-nav="docs"]').count() === 0)
    await a.locator('[data-community-settings]').click(); await a.locator('[data-community-ask-toggle]').check(); await a.locator('[data-community-settings-done]').click()
    await shot(a, '360-3-settings')

    // ---- 4 B asks for support, A sees it (B sorted Anna into Friends after the import)
    await b.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.people.forEach((p) => { if (p.name === 'Anna') p.ring = 'friend' }); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await b.reload(); await b.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    await b.locator('[data-go="web"]').dispatchEvent('click')
    await b.locator('[data-open-query]').first().click(); await b.locator('[data-ask-mode="support"]').click(); await b.locator('[data-support-zone]').waitFor()
    await b.locator('[data-support-zone]').selectOption('ring:friend')
    t.ok('4: B\'s ask form has the trust-zone bundle buttons', await b.locator('[data-support-bundle="closest-few"]').count() === 1 && await b.locator('[data-support-bundle="closest-allies"]').count() === 1)
    t.ok('4: the ask reaches Anna (1 person)', /1 person/.test(await b.locator('[data-support-count]').innerText()))
    await b.locator('[data-support-chip="listen"]').click(); await b.locator('[data-support-send]').click()
    t.ok('4: A sees "Ben could use support" as a calm card', !!(await until(async () => { await a.locator('[data-mode="personal"]').click().catch(() => {}); await a.locator('.tabs [data-go="web"]').click().catch(() => {}); return (await a.locator('[data-support-card]').count()) === 1 }, 25_000)))
    await shot(a, '360-4-card')
    // the one inbox list on A (Resources screen, "Review requests")
    await a.locator('.tabs [data-go="inventory"]').click(); await a.locator('.requests-fab').click()
    t.ok('4: the inbox lists the ask in one list', await a.locator('[data-support-inbox-row][data-kind="theirs"]').count() === 1)
    await a.locator('.sheet.on .sheet-home').click().catch(() => {})
    // B's own ask shows in B's inbox and can be cancelled -> A's card goes
    await b.locator('.tabs [data-go="inventory"]').click(); await b.locator('.requests-fab').click()
    t.ok('4: B\'s inbox lists the own ask with Cancel', await b.locator('[data-support-inbox-row][data-kind="mine"]').count() === 1 && await b.locator('[data-support-inbox-cancel]').count() === 1)
    await b.locator('[data-support-inbox-cancel]').click()
    t.ok('4: cancelling removes the ask on B', !!(await until(async () => ((await rec(b)).supportAsks ?? []).length === 0)))
    t.ok('4: and withdraws it from A (the card and the inbox row are gone)', !!(await until(async () => ((await rec(a)).supportIn ?? []).length === 0, 20_000)))
    await b.locator('.sheet.on .sheet-home').click().catch(() => {})

    // ---- 5 A asks the community: default audience = members; bundles; remembered audiences
    await a.locator('.tabs [data-go="web"]').click(); await a.locator('[data-mode="community"]').click(); await a.locator('[data-community]').waitFor({ timeout: 15_000 })
    await menu(a); await a.locator('[data-community-ask]').click(); await a.locator('[data-support-zone]').waitFor()
    t.ok('5: the default audience is the community (zone = its tag)', (await a.locator('[data-support-zone]').inputValue()) === 'tag:session')
    t.ok('5: the community has Ben (a Friend) in it: 1 person', /1 person/.test(await a.locator('[data-support-count]').innerText()))
    await a.locator('[data-support-bundle="closest-allies"]').click()
    t.ok('5: a bundle button is pressable and stays pressed', (await a.locator('[data-support-bundle="closest-allies"]').getAttribute('aria-pressed')) === 'true')
    await a.locator('[data-support-chip="call"]').click(); await shot(a, '360-5-ask'); await a.locator('[data-support-send]').click()
    t.ok('5: B got the ask from A', !!(await until(async () => (await rec(b)).supportIn?.length === 1, 25_000)))
    t.ok('5: the audience is remembered for this community (key tag + bundle)', (await rec(a)).extData['community-mighty'].meta.session.audiences?.[0] === 'tag:session+closest-allies')
    await a.locator('.sheet.on .sheet-home').click().catch(() => {}); await a.locator('.sheet.on').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    await menu(a); await a.locator('[data-community-ask]').click()
    t.ok('5: the remembered audience is offered as a chip', await a.locator('[data-support-remembered-key="tag:session+closest-allies"]').count() === 1)
    await a.locator('.sheet.on .sheet-home').click().catch(() => {})

    // ---- 6 B13: the Chat list
    // Review wave 42: the reload keeps the mode in force (Community, wave 41); go to Personal first, then the Web heading shows.
    await a.reload(); await a.waitForLoadState('networkidle').catch(() => {}); await a.locator('[data-mode]').first().waitFor({ timeout: 30_000 })
    await a.locator('[data-mode="personal"]').click().catch(() => {})
    await a.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 }).catch(async (e) => { if (SHOTS) await a.screenshot({ path: `${SHOTS}/dbg-cs-6.png` }); throw e })
    await a.locator('.tabs [data-go="chat"]').click(); await a.locator('[data-chat-search], .chat-find').first().waitFor({ timeout: 10_000 })
    t.ok('6: the empty community chat has no row in the Chat list', await a.locator('[data-chat-community-row]').count() === 0)
    t.ok('6: the Personal | Community switch is at the top of the Chat list', await a.locator('[data-mode-pill]').count() === 1)
    t.ok('6: no sideways scroll on the Chat list', await noHScroll(a))
    await shot(a, '360-6-chat')
    await a.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.extData = { ...r.extData, embeds: { byTag: { session: { telegramUrl: 'https://t.me/sessiongroup' } } } }; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await a.reload(); await a.locator('.tabs [data-go="chat"]').click(); await a.locator('.chat-find').waitFor({ timeout: 10_000 })
    t.ok('6: with a group chat linked the row is back', await a.locator('[data-chat-community-row]').count() === 1)

    // ---- 7 I9 (review wave 42, Jakob 2026-11-12): an ask an agent prepared over MCP waits for a tap; nothing is sent at start
    const bIn0 = ((await rec(b)).supportIn ?? []).length
    await a.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); const ben = r.people.find((p) => p.name === 'Ben')
      const mk = (id, note) => ({ id, chips: [], note, until: Date.now() + 86_400_000, to: [ben.peerId], here: [], queued: true, agent: true })
      r.supportAsks = [mk('mcp-e2e-1', 'could use a ride'), mk('mcp-e2e-2', 'a ladder'), ...(r.supportAsks ?? [])]
      localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
    })
    await a.reload(); await a.waitForLoadState('networkidle').catch(() => {}); await a.locator('[data-mode]').first().waitFor({ timeout: 30_000 })
    await a.locator('[data-mode="personal"]').click().catch(() => {}); await a.locator('.tabs [data-go="web"]').click()
    await a.locator('[data-agent-ask="mcp-e2e-1"]').waitFor({ timeout: 15_000 })
    t.ok('7: the card says "An agent prepared a support ask: <text>" with Send and Discard', /An agent prepared a support ask: could use a ride/.test(await a.locator('[data-agent-ask="mcp-e2e-1"]').innerText()) && await a.locator('[data-agent-ask-send="mcp-e2e-1"]').count() === 1 && await a.locator('[data-agent-ask-discard="mcp-e2e-1"]').count() === 1)
    await a.waitForTimeout(2500)
    t.ok('7: nothing was sent at start (Ben got no new ask, A still marks both as waiting)', ((await rec(b)).supportIn ?? []).length === bIn0 && ((await rec(a)).supportAsks ?? []).filter((x) => x.agent && x.queued).length === 2)
    t.ok('7: P06 the card\'s Send and Discard do not overlap', !overlap(await box(a.locator('[data-agent-ask-send="mcp-e2e-1"]')), await box(a.locator('[data-agent-ask-discard="mcp-e2e-1"]'))))
    await shot(a, '360-7-agent-ask')
    await a.locator('[data-agent-ask-send="mcp-e2e-1"]').click()
    t.ok('7: Send: Ben gets it', !!(await until(async () => ((await rec(b)).supportIn ?? []).some((x) => x.note === 'could use a ride'), 25_000)))
    t.ok('7: the sent ask is an ordinary one now (marks gone), the card is gone', await a.locator('[data-agent-ask="mcp-e2e-1"]').count() === 0 && !((await rec(a)).supportAsks ?? []).find((x) => x.id === 'mcp-e2e-1').queued)
    await a.locator('[data-agent-ask-discard="mcp-e2e-2"]').click()
    await a.waitForTimeout(2500)
    t.ok('7: Discard: card and ask gone, Ben got nothing', await a.locator('[data-agent-ask="mcp-e2e-2"]').count() === 0 && !((await rec(a)).supportAsks ?? []).some((x) => x.id === 'mcp-e2e-2') && !((await rec(b)).supportIn ?? []).some((x) => x.note === 'a ladder'))
  } finally {
    await browser.close()
    await app.stop()
  }
  t.ok('no page error', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nCOMMUNITY SUPPORT SESSION: ALL PASS' : `\nCOMMUNITY SUPPORT SESSION: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
