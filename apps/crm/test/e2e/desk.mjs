/**
 * Headless run of the Desk view (the Dex-style second face of the Curator): standalone sample data, starts its own Vite dev server on
 * CRM_PORT (default 5197), switches faces through the chevron, sets a keep-in-touch cadence, checks the command box, favorites, the
 * responsive layouts, and that nothing leaves 127.0.0.1. Screenshots to test/e2e/shots/ (CRM_SHOTS elsewhere).
 *
 *   node test/e2e/desk.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.CRM_PORT || 5197)
const SHOTS = process.env.CRM_SHOTS || path.join(HERE, 'shots')
const URL = `http://127.0.0.1:${PORT}/`
const PREFS = 'trustweb-crm.v1.prefs'

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`dev server not reachable at ${url}`)
}

mkdirSync(SHOTS, { recursive: true })
const server = spawn(path.join(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CRM_PORT: String(PORT) },
})
server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`))

let browser
try {
  await waitForServer(URL)
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const errors = []
  const outside = []
  const watch = (page) => {
    page.addInitScript(() => addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: '.twf,.twa{display:none!important}' }))))   // the dev overlay (dev_feature.ts) sits where the burger does
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('request', (r) => { const u = r.url(); if (!/^(data|blob|about):/.test(u) && new globalThis.URL(u).hostname !== '127.0.0.1') outside.push(u) })
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' })
  const page = await ctx.newPage()
  watch(page)
  const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) })

  // classic face first: light theme, then the chevron
  await page.goto(URL)
  await page.waitForSelector('.shell')
  await page.click('[data-tab="settings"]')
  await page.click('[data-field="light-theme"]')
  await page.click('[data-tab="people"]')
  ok('classic face has the chevron in its header', await page.locator('.top-btns [data-action="view-menu"]').count() === 1)
  await page.click('[data-action="view-menu"]')
  const items = await page.locator('[role="menu"] [role^="menuitem"]').allInnerTexts()
  ok('menu lists Dex, Classic (TrustWeb only inside TrustWeb)', items.map((t) => t.trim()).join('|') === 'Dex|Classic', items.join('|'))
  ok('Classic is the checked entry', (await page.locator('[data-view="classic"]').getAttribute('aria-checked')) === 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  ok('Escape closes the menu', await page.locator('[role="menu"]').count() === 0)
  await page.click('[data-action="view-menu"]')
  await page.click('[data-view="desk"]')
  await page.waitForSelector('[data-screen="desk-home"]')

  const greeting = await page.locator('[data-part="desk-greeting"]').innerText()
  ok('greeting shows "Good …, <name>"', /^Good (morning|afternoon|evening), Sample$/.test(greeting), greeting)
  const cols = await page.evaluate(() => {
    const b = (s) => document.querySelector(s).getBoundingClientRect()
    return { side: b('.desk-side'), centre: b('.desk-centre'), right: b('.desk-right') }
  })
  ok('sidebar | centre | right sit side by side', cols.side.right <= cols.centre.left + 1 && cols.centre.right <= cols.right.left + 1 && cols.right.top === cols.centre.top, JSON.stringify(cols))
  ok('Home shows resurface, keep-in-touch is omitted while empty', await page.locator('[data-section="resurface"]').count() === 1 && await page.locator('[data-section="keep-in-touch"]').count() === 0)
  ok('reminders section lists the overdue follow-up', await page.locator('[data-section="reminders"] .desk-row').count() === 1)
  ok('bell counts the due reminder', (await page.locator('[data-part="desk-bell-count"]').innerText()) === '1')
  ok('Getting started shows its card', await page.locator('[data-part="desk-start"]').count() === 1)
  await shot(page, 'desk_home')

  await page.keyboard.press('/')
  ok('"/" focuses the search box', (await page.evaluate(() => document.querySelector('.desk').contains(document.activeElement) && document.activeElement.dataset.field)) === 'desk-search')
  await page.keyboard.press('Escape')
  await page.locator('[data-field="desk-search"]').fill('benedikt')
  ok('search lists Benedikt', await page.locator('[data-part="desk-hits"] .desk-link', { hasText: 'Benedikt Auer' }).count() === 1)
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-screen="person"]')

  // person page: cadence + star
  await page.locator('[data-field="keep-in-touch"]').selectOption('7')
  await page.click('[data-action="favorite"]')
  ok('star pins Benedikt in the sidebar', await page.locator('[data-part="desk-favorites"]', { hasText: 'Benedikt Auer' }).count() === 1)
  await page.click('[data-desk-page="keepInTouch"]')
  ok('a fresh cadence counts from today: Benedikt is upcoming, not due', await page.locator('[data-section="upcoming"] .desk-row', { hasText: 'Benedikt Auer' }).count() === 1)
  // backdate the cadence's anchor (as if set a month ago), the one way to make it due without waiting
  await page.evaluate(() => {
    const k = 'trustweb-crm.v1.me'
    const crm = JSON.parse(localStorage.getItem(k))
    crm.keepInTouch['p-benedikt'].since = Date.now() - 30 * 86_400_000
    localStorage.setItem(k, JSON.stringify(crm))
  })
  await page.reload()
  await page.click('[data-desk-page="home"]')
  await page.waitForSelector('[data-section="keep-in-touch"]')
  const kit = page.locator('[data-kit="p-benedikt"]')
  ok('keep-in-touch row shows Benedikt with "Every week"', (await kit.innerText()).includes('Every week'))
  await kit.hover()
  const talks = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb-crm.v1.me')).interactions.filter((i) => i.personId === 'p-benedikt').length)
  const before = await talks()
  await kit.locator('[data-action="mark-contacted"]').click()
  ok('Mark as contacted removes the row', await page.locator('[data-kit="p-benedikt"]').count() === 0)
  ok('Mark as contacted adds exactly one interaction', (await talks()) === before + 1, `${before} -> ${await talks()}`)

  // command box
  await page.locator('[data-field="desk-command"]').fill('remind Aisha about the onboarding screens')
  ok('command box offers remind first', (await page.locator('[data-part="desk-options"] button').first().getAttribute('data-option')) === 'remind')
  await page.keyboard.press('Enter')
  ok('Enter sets the reminder', (await page.locator('[data-part="desk-said"]').innerText()).includes('Aisha Berger'))
  ok('the new reminder is tomorrow, not due yet', (await page.locator('[data-part="desk-bell-count"]').innerText()) === '1')

  // pages
  await page.click('[data-desk-page="keepInTouch"]')
  ok('Keep in Touch page lists people without a cadence', await page.locator('[data-section="none"] .desk-row').count() >= 5)
  await page.click('[data-desk-page="map"]')
  ok('Map page groups by place, no tiles', await page.locator('[data-place]').count() >= 2)
  await page.click('[data-desk-page="reminders"]')
  await page.waitForSelector('[data-screen="followups"]')
  await page.click('[data-desk-page="timeline"]')
  await page.waitForSelector('[data-screen="timeline"]')
  await page.click('[data-desk-page="contacts"]')
  await page.waitForSelector('[data-screen="people"]')
  await page.click('[data-desk-page="help"]')
  ok('Help shows the privacy line', (await page.locator('[data-screen="desk-help"]').innerText()).includes('Everything stays on this phone'))
  await page.click('[data-desk-page="settings"]')
  ok('Settings has the View half pill on Dex', (await page.locator('[data-view-pill]').innerText()).trim() === 'Dex')

  // dark follows the Curator's theme
  await page.click('[data-field="light-theme"]')
  await page.click('[data-desk-page="home"]')
  await page.waitForSelector('[data-screen="desk-home"]')
  await shot(page, 'desk_home_dark')
  await page.click('[data-desk-page="settings"]')
  await page.click('[data-field="light-theme"]')
  await page.click('[data-desk-page="home"]')

  // two columns
  await page.setViewportSize({ width: 1000, height: 800 })
  const two = await page.evaluate(() => {
    const b = (s) => document.querySelector(s).getBoundingClientRect()
    return { side: b('.desk-side'), centre: b('.desk-centre'), right: b('.desk-right') }
  })
  ok('at 1000px: sidebar + centre, right column under the centre', two.side.right <= two.centre.left + 1 && two.right.top >= two.centre.bottom - 1, JSON.stringify(two))
  await shot(page, 'desk_1000')
  await page.setViewportSize({ width: 1440, height: 900 })

  // reload keeps the face; switch back
  await page.reload()
  await page.waitForSelector('[data-screen="desk-home"]')
  ok('reload keeps prefs.view = desk', (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).view, PREFS)) === 'desk')
  await page.click('[data-action="view-menu"]')
  ok('Desk is the checked entry', (await page.locator('[data-view="desk"]').getAttribute('aria-checked')) === 'true')
  await page.click('[data-view="classic"]')
  await page.waitForSelector('.shell')
  ok('Classic brings the classic face back', await page.locator('[data-screen="desk"]').count() === 0)
  await page.reload()
  await page.waitForSelector('.shell')
  ok('and a reload keeps it', (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).view, PREFS)) === 'classic')

  // phone with the drawer open
  const phone = await browser.newContext({ viewport: { width: 390, height: 812 }, deviceScaleFactor: 2, colorScheme: 'light' })
  await phone.addInitScript((k) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ view: 'desk', light: true })) }, PREFS)
  const pp = await phone.newPage()
  watch(pp)
  await pp.goto(URL)
  await pp.waitForSelector('[data-screen="desk-home"]')
  ok('phone: the sidebar is a drawer, closed at first', (await pp.locator('.desk-side').boundingBox()).x + (await pp.locator('.desk-side').boundingBox()).width <= 0)
  await pp.click('[data-action="desk-burger"]')
  await pp.waitForTimeout(300)
  ok('phone: the burger opens the drawer', (await pp.locator('.desk-side').boundingBox()).x >= 0)
  await shot(pp, 'desk_phone')
  await pp.click('[data-desk-page="keepInTouch"]')
  await pp.waitForTimeout(300)
  ok('phone: choosing a page closes the drawer', (await pp.locator('.desk-side').boundingBox()).x < 0)
  await phone.close()

  // every Home section at once: events, resurface, birthdays, keep-in-touch, reminders (seeded record, the screenshot to hold against the Dex one)
  const full = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  await full.addInitScript((k) => {
    if (localStorage.getItem('seeded')) return
    localStorage.setItem('seeded', '1')
    const DAY = 86_400_000
    const now = Date.now()
    const day = (n) => { const d = new Date(now + n * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const line = (id, text, at) => ({ id, text, tag: 'note', audience: 'friends', status: 'current', notedAt: at, checkedAt: at })
    const person = (id, name, context, n) => ({ id, name, context, ring: 'friend', metAt: now - 200 * DAY, lines: [line(`${id}-l`, context, now - n * DAY)] })
    const people = [
      person('p-emily', 'Emily Hernandez', 'Asked for an introduction to Jack', 40), person('p-ben', 'Benjamin Thompson', 'Discussed potential partnership in Q1', 45),
      person('p-chris', 'Christopher Anderson', 'Sent pricing details, waiting on feedback', 50), person('p-tay', 'Christopher Taylor', 'Artificial Intelligence Engineer', 60),
      person('p-alex', 'Alexander Hernandez', 'Managing Partner', 60), person('p-sam', 'Samuel Garcia', 'Marketing Director', 60),
      { ...person('p-dead', 'Dora Verstorben', 'Wrote the seed-library charter', 80), fields: { __XNQ42Dtiwx: true } },
    ]
    localStorage.setItem('trustweb.v1.me', JSON.stringify({
      v: 1, me: { id: 'me', displayName: 'Joseph Moreau' }, people, peers: [], inventory: [], log: [], notificationsOn: false,
      events: [
        { id: 'e1', name: 'Team Sync with Product', from: `${day(0)}T09:00`, to: `${day(0)}T09:45`, where: '', createdAt: 0, attended: true },
        { id: 'e2', name: 'Lunch with Priya Shah', from: `${day(0)}T13:30`, to: `${day(0)}T14:30`, where: '', createdAt: 0, attended: true },
        { id: 'e3', name: 'Networking event: Startup Meetup', from: `${day(1)}T18:30`, to: `${day(1)}T20:30`, where: '', createdAt: 0, attended: true },
      ],
    }))
    const md = day(3).slice(5)
    localStorage.setItem('trustweb-crm.v1.me', JSON.stringify({
      v: 1, interactions: [], stages: {}, contactPoints: {},
      followUps: [{ id: 'f1', personId: 'p-emily', text: 'Follow up with key investors on funding round', dueAt: now + 3_600_000, createdAt: now }, { id: 'f2', personId: 'p-ben', text: 'Prep talking points for board meeting', dueAt: now - DAY, createdAt: now - 3 * DAY }],
      contacts: [{ id: 'local:1', name: 'Christopher Rodriguez', title: 'Web Developer', birthday: `--${md}`, phones: [], emails: [], labels: [], sources: [] }, { id: 'local:2', name: 'Emma Miller', title: 'SQL Developer', birthday: `1990-${md}`, phones: [], emails: [], labels: [], sources: [] }],
      keepInTouch: { 'p-tay': { everyDays: 7, since: now - 20 * DAY }, 'p-alex': { everyDays: 7, since: now - 20 * DAY }, 'p-sam': { everyDays: 7, since: now - 20 * DAY } },
    }))
    localStorage.setItem(k, JSON.stringify({ view: 'desk', light: true }))
  }, PREFS)
  const fp = await full.newPage()
  watch(fp)
  await fp.goto(URL)
  await fp.waitForSelector('[data-screen="desk-home"]')
  const sections = await fp.locator('.desk-section').evaluateAll((els) => els.map((e) => e.dataset.section))
  ok('full: all five sections in the Dex order', sections.join(',') === 'events,resurface,birthdays,keep-in-touch,reminders', sections.join(','))
  ok('full: a deceased person is never resurfaced (people list filter)', !(await fp.locator('[data-section="resurface"]').innerText()).includes('Dora'))
  ok('full: events show their time ranges', (await fp.locator('[data-section="events"]').innerText()).includes('09:00–09:45'))
  ok('full: three keep-in-touch rows with "Every week"', await fp.locator('[data-section="keep-in-touch"] .desk-pill', { hasText: 'Every week' }).count() === 3)
  ok('full: two birthdays', await fp.locator('[data-section="birthdays"] .desk-row').count() === 2)
  ok('full: the bell counts 2 reminders + 3 keep-in-touch', (await fp.locator('[data-part="desk-bell-count"]').innerText()) === '5')
  await shot(fp, 'desk_home_full')
  await full.close()

  // nothing stored, nothing to show: no empty headers
  const empty = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  await empty.addInitScript((k) => {
    localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me', displayName: '' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false }))
    localStorage.setItem(k, JSON.stringify({ view: 'desk', light: true }))
  }, PREFS)
  const ep = await empty.newPage()
  watch(ep)
  await ep.goto(URL)
  await ep.waitForSelector('[data-screen="desk-home"]')
  ok('empty: greeting without a name', /^Good (morning|afternoon|evening)$/.test(await ep.locator('[data-part="desk-greeting"]').innerText()))
  ok('empty: no section header without rows', await ep.locator('.desk-section').count() === 0)
  ok('empty: favorites hint', (await ep.locator('[data-part="desk-favorites"]').innerText()).includes('Favorite a person to pin it here.'))
  await shot(ep, 'desk_empty')
  await empty.close()

  ok('nothing left 127.0.0.1', outside.length === 0, outside.join(' | '))
  ok('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
} catch (e) {
  failures++
  console.log(`  FAIL  run aborted  ->  ${e?.stack || e}`)
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
console.log(`screenshots: ${SHOTS}`)
process.exit(failures ? 1 : 0)
