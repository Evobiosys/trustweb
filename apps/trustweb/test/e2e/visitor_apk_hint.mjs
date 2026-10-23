/**
 * Wave 16: the visitor's notification hint. A visitor opens a connect link, sees the invite, joins; Android gets the APK notice,
 * iPhone the coming-soon notice, desktop neither. "Not now" holds across a reload; Settings keeps the Android card regardless.
 * Visitor flow: after join the web is empty under "Add Ada to your web?"; only Add connects; the hint comes before the demo card;
 * "Not now" toasts; the APK link opens [data-apk-downloaded]; the Web header has the gear, no ⋮.
 * Visitor archive: "Not now" on the add sheet archives Ada (toast [data-archived-toast], pulsing Curator icon), the Curator's Archive
 * lists her, Restore brings the add sheet back, whose button reads "Add as intended" on Intending; Add connects.
 * Wants to connect (host side, over a real relay): a visitor's reach-out lands as a row under the host's web, not a dot; Dismiss archives,
 * Restore brings the row back, Add (Acquaintance by default) puts them on the rings; the Curator header (Timeline icon, ⋮), the collapsed
 * "📦 Archive (n)" and the ring pop's "Merge with" / "Fields".
 * TW_SHOTS=<dir> saves 390x844 screenshots (default DEVLOG/wave16/screens/visitor-apk-hint; the archive ones in ../visitor-archive).
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<repo>/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs npx tsx ../trustweb/test/e2e/visitor_apk_hint.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.TW_PORT || 5471)
const SHOTS = process.env.TW_SHOTS || path.resolve(TW_ROOT, '../../DEVLOG/wave16/screens/visitor-apk-hint')
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
const count = (page, sel) => page.locator(sel).count()

async function waitFor(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

/** Ada's long connect link, rewritten to this server's origin. `keep`: her phone stays open (the host side), returned with the link. */
async function inviteLink(browser, base, name = 'Ada', keep = false) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(base)
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const link = await page.getAttribute('.qrwrap', 'data-payload')
  if (!link.includes('?connect=')) throw new Error('no long link: ' + link)
  const url = base + link.slice(link.indexOf('?'))
  if (keep) { await page.locator('nav.tabs button', { hasText: 'Membranes' }).click(); return { ctx, page, link: url } }
  await ctx.close()
  return url
}

/** A visitor on `ua` opens the link and joins as `name`. */
async function visitor(browser, link, ua, name, errors) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(ua ? { userAgent: ua, isMobile: true, hasTouch: true } : {}) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(link)
  await page.getByLabel('Your first name').waitFor({ timeout: 15_000 })
  return { ctx, page, join: async () => { await page.getByLabel('Your first name').fill(name); await page.locator('.start-form .btn-electric').click() } }
}

/** The visitor's add sheet ("Add Ada to your web?"): Add connects, then their card opens; closed here. */
async function settle(page) {
  await page.locator('.sheet.on [data-connect-add]').click({ timeout: 20_000 })
  // a tap elsewhere answers the demo-content card with No, so it is usually gone already
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1_000 }).catch(() => {})
  // joining opens their card; the hint waits until it is closed
  await page.locator('.sheet-veil.on').click({ position: { x: 20, y: 20 }, timeout: 10_000 }).catch(() => {})
}

const openSettings = async (page) => {
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
  await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.sheet.on h3', { hasText: 'Settings' }).waitFor({ timeout: 5_000 })
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  // A real relay (as acceptance.mjs), so the host phone hears a visitor's reach-out (wants to connect).
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const viteProc = spawn(process.execPath, [path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  let browser = null
  try {
    await waitFor(base)
    const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
    browser = await (pw.chromium ? pw : pw.default).chromium.launch({ headless: true })
    const errors = []

    // 1. the loading screen: the static page before the bundle runs
    const lctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const lp = await lctx.newPage()
    await lp.route('**/src/main.ts*', (r) => r.abort())
    await lp.goto(base)
    await lp.locator('#app [data-loading]').waitFor({ timeout: 10_000 })
    const lt = await lp.locator('[data-loading]').innerText()
    ok('loading screen: logo, TrustWeb, Loading…', /◎/.test(lt) && /TrustWeb/.test(lt) && /Loading…/.test(lt), lt)
    await shot(lp, '01-loading.png')
    await lctx.close()

    const link = await inviteLink(browser, base)

    // 2. Android visitor
    const a = await visitor(browser, link, ANDROID, 'Vera', errors)
    ok('the loading screen is gone once the app drew', await count(a.page, '[data-loading]') === 0)
    ok('the invite shows', /Ada/.test(await a.page.locator('.invite').innerText()))
    await shot(a.page, '02-invite.png')
    await a.page.route('https://trustweb.one/apk', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename="trustweb.apk"' }, body: 'apk' }))
    await a.join()
    await a.page.locator('.sheet.on [data-connect-add-title]').waitFor({ timeout: 15_000 })
    ok('after join: the sheet "Add Ada to your web?"', (await a.page.locator('.sheet.on [data-connect-add-title]').innerText()) === 'Add Ada to your web?')
    ok('the web has no person until Add', await count(a.page, '.node[data-pid]') === 0)
    await a.page.locator('[data-apk-hint]').waitFor({ timeout: 5_000 })
    const note = a.page.locator('.demo-friends')
    ok('the APK hint is up at once, before the demo card', !/No thanks/.test(await note.innerText()))
    await a.page.waitForTimeout(800)
    await shot(a.page, '06-add-sheet.png')
    await settle(a.page)
    await a.page.locator('.node[data-pid]').first().waitFor({ timeout: 15_000 })
    ok('after Add: Ada is in the web', await count(a.page, '.node[data-pid]') === 1)
    ok('the visitor sees no yellow-dot legend', await count(a.page, '[data-legend-reach-out]') === 0)
    ok('Web header: the gear, no ⋮', await count(a.page, '.hdr [aria-label="Settings"]') === 1 && await count(a.page, '.hdr-btn.more') === 0)
    ok('Android: the APK notice with the download link', await note.locator('a[href="https://trustweb.one/apk"]').count() === 1 && /Get reliable notifications/.test(await note.innerText()))
    ok('Android: no iPhone notice', await count(a.page, '[data-ios-soon]') === 0)
    await shot(a.page, '03-banner-android.png')
    await note.getByRole('button', { name: 'Not now' }).click()
    ok('"Not now" toasts', /You can still find this at the top of Settings\./.test(await a.page.locator('.toast.on').innerText()))
    ok('then the demo card', /No thanks/.test(await note.innerText()))
    await note.getByRole('button', { name: 'No thanks' }).click()
    ok('"Not now" hides it', await note.isHidden())
    await a.page.reload()
    await a.page.locator('nav.tabs').waitFor({ timeout: 15_000 })
    await a.page.waitForTimeout(11_000)
    ok('a reload keeps it hidden', await count(a.page, '[data-apk-hint]') === 0 || await note.isHidden())
    await a.page.addStyleTag({ content: '.sheet{transition:none!important}' }) // headless: the slide-in stalls, the picture needs the sheet in place
    await openSettings(a.page)
    ok('Settings: the Android card shows even after dismissing, at the top', await count(a.page, '.sheet.on [data-apk-settings-hint]') === 1
      && await a.page.locator('.sheet.on h3').first().evaluate((h) => h.nextElementSibling.hasAttribute('data-apk-settings-hint')))
    ok('Settings card: link and "Shown until the app is installed."', await count(a.page, '[data-apk-settings-hint] a[href="https://trustweb.one/apk"]') === 1
      && /Shown until the app is installed/.test(await a.page.locator('[data-apk-settings-hint]').innerText()))
    await a.page.waitForTimeout(800)
    await shot(a.page, '05-settings-android.png')
    await a.page.locator('[data-apk-settings-hint] a[href="https://trustweb.one/apk"]').click()
    await a.page.locator('.sheet.on [data-apk-downloaded]').waitFor({ timeout: 5_000 })
    ok('Download opens [data-apk-downloaded] with the GitHub link', /Check your Downloads folder on your phone/.test(await a.page.locator('[data-apk-downloaded]').innerText())
      && await count(a.page, '[data-apk-downloaded] a[href="https://github.com/Evobiosys/trustweb"][target="_blank"]') === 1)
    await a.page.waitForTimeout(400)
    await shot(a.page, '07-downloaded.png')
    await a.ctx.close()

    // 3. iPhone visitor
    const i = await visitor(browser, link, IPHONE, 'Ines', errors)
    await i.join()
    await settle(i.page)
    await i.page.locator('[data-ios-soon]').waitFor({ timeout: 20_000 })
    ok('iPhone: the coming-soon notice, no APK link', /coming soon/.test(await i.page.locator('.demo-friends').innerText()) && await count(i.page, '.demo-friends a') === 0 && await count(i.page, '[data-apk-hint]') === 0)
    await shot(i.page, '04-banner-ios.png')
    await i.page.locator('.demo-friends').getByRole('button', { name: 'Got it' }).click()
    ok('"Got it" hides it, then the demo card', await count(i.page, '[data-ios-soon]') === 0 && /No thanks/.test(await i.page.locator('.demo-friends').innerText()))
    await openSettings(i.page)
    ok('iPhone: no Settings card', await count(i.page, '[data-apk-settings-hint]') === 0)
    await i.ctx.close()

    // 4. desktop visitor
    const d = await visitor(browser, link, null, 'Dora', errors)
    await d.join()
    await d.page.locator('nav.tabs').waitFor({ timeout: 15_000 })
    await d.page.waitForTimeout(11_000)
    ok('desktop: neither notice', await count(d.page, '[data-apk-hint], [data-ios-soon]') === 0)
    await openSettings(d.page)
    ok('desktop: no Settings card', await count(d.page, '[data-apk-settings-hint]') === 0)
    await d.ctx.close()

    // 5. a visitor declines: Archive, then Restore from the Curator
    const ARCH = path.join(SHOTS, '../visitor-archive')
    mkdirSync(ARCH, { recursive: true })
    const n = await visitor(browser, link, null, 'Nora', errors)
    await n.page.addStyleTag({ content: '.sheet,.toast{transition:none!important}' })   // headless: transitions stall mid-way
    await n.join()
    const addBtn = n.page.locator('.sheet.on [data-connect-add]')
    await addBtn.waitFor({ timeout: 15_000 })
    ok('add sheet on Intending: "Add as intended"', (await addBtn.innerText()) === 'Add as intended')
    await n.page.locator('.sheet.on [data-ring="friend"]').click()
    ok('picking Friend: "Add to my web"', (await addBtn.innerText()) === 'Add to my web')
    await n.page.locator('.sheet.on [data-ring="intending"]').click()
    ok('back on Intending: "Add as intended"', (await addBtn.innerText()) === 'Add as intended')
    await n.page.waitForTimeout(300)
    await n.page.screenshot({ path: path.join(ARCH, '03-add-as-intended.png') })
    await n.page.locator('.sheet.on [data-connect-later]').click()
    await n.page.locator('.toast.on[data-archived-toast]').waitFor({ timeout: 10_000 })
    ok('"Not now": toast "Archived. Find them in Contacts."', (await n.page.locator('.toast.on').innerText()) === 'Archived. Find them in Contacts.')
    ok('the Curator icon pulses', await count(n.page, '.hdr .search-btn.pulse') === 1)
    ok('the inviter is not in the web, no invite card', await count(n.page, '.node[data-pid]') === 0 && await count(n.page, '[data-invite-card]') === 0)
    await n.page.waitForTimeout(400)   // the toast's fade-in, the pulse ring at its widest
    await n.page.screenshot({ path: path.join(ARCH, '01-not-now-toast.png') })
    await n.page.waitForTimeout(4_500)
    ok('the pulse stops after ~4 s', await count(n.page, '.search-btn.pulse') === 0)
    await n.page.locator('.hdr .search-btn').click()
    await n.page.locator('.sheet.on .curator .gear').click({ timeout: 15_000 })
    await n.page.locator('.sheet.on .curator [data-part="archive"]').waitFor({ timeout: 10_000 })
    ok('the Archive is collapsed at first', !(await n.page.locator('.sheet.on .curator [data-part="archive"]').evaluate((d) => d.open)))
    await n.page.locator('.sheet.on .curator [data-part="archive"] > summary').click()
    const row = n.page.locator('.sheet.on .curator [data-part="hidden"]')
    await row.first().waitFor({ timeout: 10_000 })
    ok('the Curator\'s Archive lists Ada', /Archive \(1\)/.test(await n.page.locator('.sheet.on .curator [data-archive]').textContent()) && /Ada/.test(await row.first().innerText()))
    await row.first().scrollIntoViewIfNeeded()
    await n.page.waitForTimeout(300)
    await n.page.screenshot({ path: path.join(ARCH, '02-curator-archive.png') })
    await row.first().locator('[data-action="unhide"]').click()
    await n.page.locator('.sheet.on [data-connect-add-title]').waitFor({ timeout: 10_000 })
    ok('Restore brings the add sheet back', (await n.page.locator('.sheet.on [data-connect-add-title]').innerText()) === 'Add Ada to your web?')
    await n.page.locator('.sheet.on [data-connect-add]').click()
    await n.page.locator('.node[data-pid]').first().waitFor({ timeout: 15_000 })
    ok('Add connects: Ada in the web', await count(n.page, '.node[data-pid]') === 1)
    const card = n.page.locator('.sheet.on .archive-row')
    await card.waitFor({ timeout: 10_000 })
    ok('her card: Archive above a quiet Delete', (await card.innerText()).replace(/\s+/g, ' ').trim() === 'Archive Delete')
    await card.locator('[data-delete-person]').click()
    ok('Delete asks in place', /Delete for good\?/.test(await card.innerText()))
    await card.locator('[data-delete-no]').click()
    await card.locator('[data-archive-person]').click()
    await n.page.locator('.toast.on[data-archived-toast]').waitFor({ timeout: 10_000 })
    ok('card Archive: out of the web, the archived toast, the pulse', await count(n.page, '.node[data-pid]') === 0 && await count(n.page, '.hdr .search-btn.pulse') === 1)
    await n.ctx.close()

    // 6. the host: a reach-out waits under the web ("Wants to connect"), Dismiss archives, Restore brings the row back, Add makes the person
    const WTC = path.join(SHOTS, '../wants-to-connect')
    mkdirSync(WTC, { recursive: true })
    const h = await inviteLink(browser, base, 'Hana', true)
    h.page.on('pageerror', (e) => errors.push(e.message))
    await h.page.addStyleTag({ content: '.sheet,.toast{transition:none!important}' })
    const v = await visitor(browser, h.link, null, 'Vic', errors)
    await v.join()
    await settle(v.page)
    const wants = h.page.locator('[data-wants-to-connect]')
    await wants.waitFor({ timeout: 30_000 })
    ok('host: Vic waits under the web, not on the rings', /Wants to connect/.test(await wants.innerText()) && /Vic/.test(await wants.innerText()) && await count(h.page, '.node[data-pid]') === 0)
    ok('host: no yellow dot, no reach-out legend, no "reached out to you"', await count(h.page, '[data-legend-reach-out], [data-reached-out]') === 0)
    await h.page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
    await wants.scrollIntoViewIfNeeded()
    await h.page.waitForTimeout(300)
    await shot(h.page, '../wants-to-connect/01-wants-to-connect.png')
    await wants.locator('[data-want-dismiss]').click()
    await h.page.locator('.toast.on[data-archived-toast]').waitFor({ timeout: 10_000 })
    ok('Dismiss: the row goes, the archived toast, the pulse', await count(h.page, '[data-wants-to-connect]') === 0 && await count(h.page, '.hdr .search-btn.pulse') === 1)
    await h.page.locator('.hdr .search-btn').click()
    const cur = h.page.locator('.sheet.on .curator')
    await cur.locator('.gear').waitFor({ timeout: 15_000 })
    ok('Curator header: Timeline icon and ⋮ (Settings), bottom bar People only', await cur.locator('.top-btns [data-tab="timeline"]').count() === 1
      && await cur.locator('.gear').getAttribute('aria-label') === 'Settings' && (await cur.locator('.tabbar .tab').allInnerTexts()).join() === 'People')
    await h.page.waitForTimeout(300)
    await shot(h.page, '../wants-to-connect/02-curator-header.png')
    await cur.locator('.gear').click()
    const arch = cur.locator('[data-part="archive"]')
    await arch.waitFor({ timeout: 10_000 })
    ok('Settings: "📦 Archive (1)", collapsed', (await arch.locator('[data-archive]').textContent()).trim() === '📦 Archive (1)' && !(await arch.evaluate((d) => d.open)))
    await arch.scrollIntoViewIfNeeded()
    await h.page.waitForTimeout(300)
    await shot(h.page, '../wants-to-connect/04-archive-collapsed.png')
    await arch.locator('summary').click()
    await arch.locator('[data-part="hidden"]', { hasText: 'Vic' }).locator('[data-action="unhide"]').click()
    await h.page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
    await wants.waitFor({ timeout: 10_000 })
    ok('Restore: the row is back', /Vic/.test(await wants.innerText()) && await count(h.page, '.node[data-pid]') === 0)
    await wants.locator('[data-want-add]').click()
    await h.page.locator('.sheet.on [data-ring="acquaintance"].on').waitFor({ timeout: 5_000 })
    await h.page.locator('.sheet.on [data-connect-add]').click()
    await h.page.locator('.node[data-pid]').first().waitFor({ timeout: 10_000 })
    ok('Add (Acquaintance by default): Vic on the rings, the row gone', await count(h.page, '.node[data-pid]') === 1 && await count(h.page, '[data-wants-to-connect]') === 0)
    // the Curator person page: under the ring chips "Merge with" and "Fields", both collapsed
    await h.page.locator('.hdr .search-btn').click()
    await cur.locator('.tabbar [data-tab="people"]').click({ timeout: 15_000 })
    await cur.locator('.pr-open', { hasText: 'Vic' }).click({ timeout: 15_000 })
    await cur.locator('[data-action="ring-label"]').click()
    const mw = cur.locator('[data-part="merge-with"]')
    const fl = cur.locator('[data-part="fields"]')
    ok('ring pop: "Merge with" then "Fields", both collapsed, no Show advanced', await mw.count() === 1 && await fl.count() === 1
      && !(await mw.evaluate((d) => d.open)) && !(await fl.evaluate((d) => d.open)) && /Merge with/.test(await mw.locator('summary').innerText()) && /Fields/.test(await fl.locator('summary').innerText()))
    await mw.locator('summary').click()
    await fl.locator('summary').click()
    ok('Merge with: the search box at once; Fields: Delete and the flags', await mw.locator('[data-field="merge-search"]').count() === 1 && await fl.locator('[data-action="ring-delete"]').count() === 1 && await fl.locator('[data-part="ring-advanced"]').count() === 1)
    await mw.scrollIntoViewIfNeeded()
    await h.page.waitForTimeout(300)
    await shot(h.page, '../wants-to-connect/03-person-sections.png')
    await v.ctx.close()
    await h.ctx.close()

    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser?.close()
    viteProc.kill()
    await relay.close().catch(() => {})
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nvisitor-apk-hint: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
