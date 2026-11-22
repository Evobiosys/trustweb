// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 settings-suggest, two phones (Ana, Ben) on one in-memory notes relay (Playwright route, the real server's rules in miniature):
 * Ana suggests her Feed settings to Ben -> Ben sees the diff, nothing applied -> Accept applies it. Ben follows Ana's Notifications with
 * auto-apply -> Ana allows -> Ben's notifications follow at once. Stock data only (two fresh phones, the other one added by DID).
 *   cd apps/demo && TW_VITE=$PWD/../crm/node_modules/vite/bin/vite.js PLAYWRIGHT_PACKAGE=<playwright-core> TW_CHROMIUM_EXE=<chrome-headless-shell> TW_PORT=5476 TW_SHOTS=<dir> \
 *     ../../node_modules/.bin/tsx ../trustweb/test/e2e/settings_suggest.mjs
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []
const sha = (s) => createHash('sha256').update(s).digest('hex')

/** services/trustweb-backup/notes_relay.mjs in miniature (same as co_notes_link.mjs). */
function relayServer() {
  const box = []
  const claims = new Map()
  let n = 0
  const auth = (role, did, token) => { const k = `${role}\0${did}`; if (!claims.has(k)) { claims.set(k, sha(token)); return true } return claims.get(k) === sha(token) }
  const handler = async (route) => {
    const req = route.request()
    const u = new URL(req.url())
    const token = req.headers()['x-relay-token'] ?? ''
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}')
      if (!auth('send', body.from, token)) return json(404, {})
      const id = `id${n++}`
      box.push({ id, ...body })
      return json(201, { id })
    }
    const to = u.searchParams.get('for')
    const mine = box.filter((x) => x.to === to)
    if (!mine.length || !auth('read', to, token)) return json(404, {})
    if (req.method() === 'DELETE') { const i = box.findIndex((x) => x.id === u.searchParams.get('id')); if (i >= 0) box.splice(i, 1); return route.fulfill({ status: 204 }) }
    const id = u.searchParams.get('id')
    if (id) { const m = mine.find((x) => x.id === id); return m ? json(200, m) : json(404, {}) }
    return json(200, { items: mine.map(({ id: i, from, size, expires }) => ({ id: i, from, size, expires })) })
  }
  return { handler, box }
}

const KEY = () => Object.keys(localStorage).find((k) => /^trustweb\.v1\./.test(k) && (() => { try { return Array.isArray(JSON.parse(localStorage.getItem(k)).people) } catch { return false } })())
const recordOf = (page) => page.evaluate((key) => { const k = (0, eval)(`(${key})`)(); return JSON.parse(localStorage.getItem(k)) }, KEY.toString())
const editRecord = (page, change) => page.evaluate(([key, fn]) => {
  const k = (0, eval)(`(${key})`)()
  const r = JSON.parse(localStorage.getItem(k))
  ;(0, eval)(`(${fn})`)(r)
  localStorage.setItem(k, JSON.stringify(r))
}, [KEY.toString(), change.toString()])

async function openSettings(page) {
  // The once-only "Keep a copy" offer (keep_copy.ts) shows on the first start with people: Not now.
  if (await page.locator('[data-keep-copy-offer]').count()) { await page.locator('[data-keep-copy-offer] ~ .btn-ghost').click(); await page.waitForTimeout(300) }
  await page.locator('[data-settings-gear]').first().click()
  await page.locator('.sheet.on[data-kind=settings]').waitFor()
  await page.waitForTimeout(300)
}
/** Reload: the module reads the relay ~3 s after start; then Settings opens. */
async function refresh(page) {
  await page.reload(); await page.waitForTimeout(800)
  await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }).catch(() => {})
  await page.locator('[data-settings-gear]').first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(4_500)
  await openSettings(page)
}
const section = (page) => page.locator('[data-settings-share]')
async function openSection(page) { if (!(await section(page).evaluate((d) => d.open))) await section(page).locator('> summary').click(); await page.waitForTimeout(200) }

const app = await startApp(Number(process.env.TW_PORT || 5476))
const browser = await launch(['--use-mock-keychain', '--password-store=basic'])
try {
  for (const [label, opts] of [
    ['360', { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true }],
    ['1280', { viewport: { width: 1280, height: 900 } }],
  ]) {
    const relay = relayServer()
    const phone = async (name) => {
      const ctx = await browser.newContext(opts)
      await ctx.route('**/notes/relay**', relay.handler)
      const page = await ctx.newPage()
      page.on('pageerror', (e) => { errors.push(`${label}/${name}: ${e.message}`); console.log('  [pageerror]', e.message) })
      await page.goto(app.base)
      await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200)
      await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }).catch(() => {})
      await page.getByLabel('Your first name').fill(name)
      await page.getByRole('button', { name: 'Start on this phone' }).click()
      await page.locator('[data-settings-gear]').first().waitFor({ timeout: 15_000 })
      await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
      return { ctx, page }
    }
    const A = await phone('Ana')
    const B = await phone('Ben')
    const didA = (await recordOf(A.page)).identity?.did
    const didB = (await recordOf(B.page)).identity?.did
    t.ok(`${label}: both phones hold a key`, Boolean(didA && didB))
    const person = (id, name, did) => ({ id, name, did, context: '', ring: 'close', metAt: 1, lines: [] })
    await editRecord(A.page, `(r) => { r.people.push(${JSON.stringify(person('pben', 'Ben', didB))}); r.feed = { ...(r.feed || {}), on: true }; r.notifyKinds = { connect: true, ask: false, chat: true, reminder: true, event: true } }`)
    await editRecord(B.page, `(r) => { r.people.push(${JSON.stringify(person('pana', 'Ana', didA))}) }`)
    await A.page.reload(); await B.page.reload(); await A.page.waitForTimeout(1200)

    // 1 Ana: Settings > Share settings > Suggest these settings to… > Feed > Ben > Suggest.
    await openSettings(A.page)
    t.ok(`${label}: Share settings sits on the short page, outside Advanced`, (await section(A.page).count()) === 1 && (await A.page.locator('[data-settings-advanced-all] [data-settings-share]').count()) === 0)
    await openSection(A.page)
    await A.page.locator('[data-ss-suggest-open]').click(); await A.page.waitForTimeout(250)
    t.ok(`${label}: Suggest is disabled until a group and a person are picked`, await A.page.locator('[data-ss-send]').isDisabled())
    t.ok(`${label}: four groups offered`, (await A.page.locator('[data-ss-group]').count()) === 4)
    await A.page.locator('[data-ss-group=feed]').click(); await A.page.waitForTimeout(150)
    await A.page.locator('[data-ss-person=pben]').click(); await A.page.waitForTimeout(150)
    if (SHOTS) await A.page.screenshot({ path: path.join(SHOTS, `settings-suggest-${label}-pick.png`) })
    await A.page.locator('[data-ss-send]').click()
    for (let i = 0; i < 20 && !relay.box.length; i++) await A.page.waitForTimeout(250)
    t.ok(`${label}: the suggestion went onto the relay, sealed for Ben`, relay.box.length === 1 && relay.box[0].to === didB && !relay.box[0].blob.includes('feed'))
    const outboxLeft = async () => ((await recordOf(A.page)).settingsShare?.outbox ?? []).length
    for (let i = 0; i < 20 && (await outboxLeft()); i++) await A.page.waitForTimeout(250)
    t.ok(`${label}: Ana's outbox is empty again`, (await outboxLeft()) === 0)

    // 2 Ben: the suggestion with its diff; nothing applied before Accept.
    await refresh(B.page)
    const item = B.page.locator('[data-ss-item][data-ss-kind=suggest]')
    t.ok(`${label}: Ben sees the suggestion, section open, with the Feed diff`, (await item.count()) === 1 && (await section(B.page).evaluate((d) => d.open)) && (await item.locator('[data-ss-diff="feed.on"]').count()) === 1)
    t.ok(`${label}: nothing applied before Accept`, (await recordOf(B.page)).feed?.on !== true)
    t.ok(`${label}: the relay forgot it once read`, relay.box.length === 0)
    t.ok(`${label}: no document scroll sideways`, await B.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await item.scrollIntoViewIfNeeded()
    if (SHOTS) await B.page.screenshot({ path: path.join(SHOTS, `settings-suggest-${label}-incoming.png`) })
    await item.locator('[data-ss-accept]').click(); await B.page.waitForTimeout(400)
    t.ok(`${label}: Accept applies the Feed settings`, (await recordOf(B.page)).feed?.on === true)
    t.ok(`${label}: the item is gone`, (await B.page.locator('[data-ss-item]').count()) === 0)

    // 3 Ben follows Ana's Notifications with auto-apply; Ana allows; Ben's notifications follow.
    await openSection(B.page)
    await B.page.locator('[data-ss-follow-open]').click(); await B.page.waitForTimeout(250)
    await B.page.locator('[data-ss-group=notifications]').click(); await B.page.waitForTimeout(150)
    t.ok(`${label}: reach choice: my connections / friends of friends`, (await B.page.locator('[data-ss-reach]').count()) === 2)
    await B.page.locator('[data-ss-person=pana]').click(); await B.page.waitForTimeout(150)
    t.ok(`${label}: auto-apply starts off, struck through`, (await B.page.locator('[data-ss-auto-new]').getAttribute('aria-pressed')) === 'false' && (await B.page.locator('[data-ss-auto-new]').evaluate((e) => e.classList.contains('tw-off'))))
    await B.page.locator('[data-ss-auto-new]').click(); await B.page.waitForTimeout(150)
    if (SHOTS) await B.page.screenshot({ path: path.join(SHOTS, `settings-suggest-${label}-follow.png`) })
    await B.page.locator('[data-ss-follow]').click(); await B.page.waitForTimeout(600)
    await openSection(B.page)
    t.ok(`${label}: Ben's follow shows, waiting, auto-apply on`, (await B.page.locator('[data-ss-following=notifications]').innerText()).includes('waiting') && (await B.page.locator('[data-ss-auto=notifications]').getAttribute('aria-pressed')) === 'true')
    for (let i = 0; i < 20 && !relay.box.length; i++) await B.page.waitForTimeout(250)
    await refresh(A.page)
    const req = A.page.locator('[data-ss-item][data-ss-kind=follow]')
    t.ok(`${label}: Ana gets the follow request to allow`, (await req.count()) === 1 && (await req.innerText()).includes('Ben wants to follow your Notifications settings'))
    await req.scrollIntoViewIfNeeded()
    if (SHOTS) await A.page.screenshot({ path: path.join(SHOTS, `settings-suggest-${label}-allow.png`) })
    await req.locator('[data-ss-accept]').click()
    for (let i = 0; i < 20 && !relay.box.length; i++) await A.page.waitForTimeout(250)
    await openSection(A.page)
    t.ok(`${label}: Ana sees Ben as a follower`, (await A.page.locator('[data-ss-followers=notifications]').count()) === 1)
    await refresh(B.page)
    const recB = await recordOf(B.page)
    t.ok(`${label}: auto-apply: Ben's notifications now follow Ana's (ask off)`, recB.notifyKinds?.ask === false)
    await B.page.locator('[data-ss-following=notifications]').scrollIntoViewIfNeeded()
    if (SHOTS) await B.page.screenshot({ path: path.join(SHOTS, `settings-suggest-${label}-following.png`) })
    t.ok(`${label}: no longer waiting`, !(await B.page.locator('[data-ss-following=notifications]').innerText()).includes('waiting'))
    t.ok(`${label}: nothing left in Ben's inbox`, (await B.page.locator('[data-ss-item]').count()) === 0)
    await A.ctx.close(); await B.ctx.close()
  }
} finally { await browser.close(); await app.stop() }
t.ok('no page errors', errors.length === 0, errors.join('; '))
process.exit(t.failures ? 1 : 0)
