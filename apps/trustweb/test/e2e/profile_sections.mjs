// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * E3 profile-sections proof (headless, dev only) at 390x844: My profile shows six sections, each with a "Who sees this" line; the Work
 * section is set to Only me + also one event on the scope editor page; the "as seen by" preview shows the work lines to that event (and
 * to the person tagged with it) and hides them from a Friend without it; the event page's name reveal 'hidden' leaves `by` out of the
 * copied link. Invented names, example.org only.
 * PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node profile_sections.mjs
 */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring, events = []) => ({ id, name, context: '', ring, metAt: 1, lines: [], events })
const dated = (text) => ({ text, at: Date.parse('2026-10-30T10:00:00Z'), by: 'me' })
const EV = { id: 'e1', name: 'Forum Probe', from: '2026-10-12', where: 'Hall example.org', createdAt: 1, attended: true }
const record = JSON.stringify({
  v: 1, me: { id: 'me1', displayName: 'Mo Probe' }, peers: [], log: [], inventory: [],
  people: [person('cy', 'Cy Probe', 'friend', ['e1']), person('di', 'Di Probe', 'friend')],
  events: [EV],
  profile: { norms: [], intro: dated('Tinkers with test rigs'), website: dated('probe.example.org'), working: dated('A probe for test rigs') },
})
/** The event in a copied link (#ev=<base64url JSON>[&srv=...]). */
const payloadOf = (link) => JSON.parse(Buffer.from(link.split('#ev=')[1].split('&')[0], 'base64url').toString())
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)

  // My profile lives under the contact box: Settings > You (the groups are folded, so open every <details> in the sheet).
  await page.locator('.hdr [aria-label="Settings"]').first().click(); await page.waitForTimeout(500)
  await page.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
  await page.locator('.sheet.on [data-open-profile]').first().click(); await page.waitForTimeout(500)
  const sheet = page.locator('.sheet.on')
  const sections = await sheet.locator('[data-prof-section]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-prof-section')))
  check('six sections in order', JSON.stringify(sections) === JSON.stringify(['picture', 'about', 'contact', 'address', 'work', 'availability']))
  check('each section has a Who-sees line and an Edit button', (await sheet.locator('[data-prof-scope]').count()) === 6 && (await sheet.locator('[data-prof-scope-edit]').count()) === 6)
  check('new one-line fields: interests and availability', (await sheet.locator('[data-prof-input="interests"]').count()) === 1 && (await sheet.locator('[data-prof-input="availability"]').count()) === 1)
  check('no per-field audience seg any more', (await sheet.locator('.prof-audience, [data-audience]').count()) === 0)
  check('Work defaults to everyone', /Everyone/.test(await sheet.locator('[data-prof-scope="work"]').innerText()))
  check('the preview block sits at the top', (await sheet.locator('[data-prof-preview] [data-prof-viewer]').count()) === 1)

  // Work: Only me + also the event, on the scope editor page.
  await sheet.locator('[data-prof-scope-edit="work"]').click(); await page.waitForTimeout(500)
  const editor = page.locator('[data-page="profile-scope"]')
  check('Edit opens the scope editor as a page', (await editor.count()) === 1)
  check('the profile editor offers Only me', (await editor.locator('[data-share-zone="self"]').count()) === 1)
  await editor.locator('[data-share-zone="self"]').click(); await page.waitForTimeout(200)
  check('Only me: nobody would see it', (await editor.locator('[data-share-zone="self"].on').count()) === 1 && (await editor.locator('[data-share-preview]').getAttribute('data-share-preview')) === '0')
  await editor.locator('[data-share-input="include"]').fill('Forum'); await page.waitForTimeout(200)
  check('the typeahead offers the event', (await editor.locator('[data-share-suggest="event:e1"]').count()) === 1)
  await editor.locator('[data-share-suggest="event:e1"]').click(); await page.waitForTimeout(200)
  check('also the event: Cy (tagged with it) would see it (1)', (await editor.locator('[data-share-preview]').getAttribute('data-share-preview')) === '1')
  await editor.locator('[data-share-preview] summary').click()
  const names = await editor.locator('[data-share-names]').innerText()
  check('names under the (i): Cy, not Di', /Cy Probe/.test(names) && !/Di Probe/.test(names))
  await page.screenshot({ path: `${SHOTS}/profile-scope.png` })
  await editor.locator('[data-scope-done]').click(); await page.waitForTimeout(600)
  check('Done closes the page', (await page.locator('[data-page="profile-scope"]').count()) === 0)
  const work = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).profile?.sections?.work)
  check('the work scope is saved: self + event:e1', work?.zone === 'self' && work.include?.length === 1 && work.include[0] === 'event:e1' && work.exclude?.length === 0)
  const summary = await page.locator('.sheet.on [data-prof-scope="work"]').innerText()
  check('the Who-sees line says Only me, also the event', /Only me/.test(summary) && /Forum Probe/.test(summary))

  // "As seen by": the receiving phone's own block.
  const viewer = page.locator('.sheet.on [data-prof-viewer]')
  const body = page.locator('.sheet.on [data-prof-preview-body]')
  const workLines = async () => (await body.locator('[data-their-working]').count()) + (await body.locator('[data-their-website]').count())
  await viewer.selectOption('event:e1'); await page.waitForTimeout(300)
  check('as seen by the event: the work lines show', (await workLines()) === 2)
  await viewer.selectOption('person:cy'); await page.waitForTimeout(300)
  check('as seen by Cy (tagged with the event): the work lines show', (await workLines()) === 2)
  await viewer.selectOption('zone:friend'); await page.waitForTimeout(300)
  check('as seen by someone on Friends: no work lines', (await workLines()) === 0 && (await body.locator('[data-their-profile], [data-prof-preview-nothing]').count()) === 1)
  await viewer.selectOption('person:di'); await page.waitForTimeout(300)
  check('as seen by Di (a Friend without the event): no work lines', (await workLines()) === 0)
  await page.screenshot({ path: `${SHOTS}/profile-sections.png` })

  // Event page: the name reveal.
  await page.locator('[data-sheet-home]').first().click().catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(400)
  await page.locator('.events-btn').first().click(); await page.waitForTimeout(400)
  await page.locator('[data-cal-all]').click(); await page.waitForTimeout(300)
  await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(400)
  check('the name reveal defaults to Full name', (await page.locator('[data-event-name-reveal="full"][aria-pressed="true"]').count()) === 1)
  await page.locator('[data-event-share]').click(); await page.waitForTimeout(300)
  const pv = page.locator('[data-event-link-preview]')
  await pv.focus()
  check('full: the link names me', payloadOf(await pv.inputValue()).by?.name === 'Mo Probe')
  await page.locator('[data-event-name-reveal="first"]').click(); await page.waitForTimeout(300)
  await page.locator('[data-event-link-preview]').focus()
  const first = payloadOf(await page.locator('[data-event-link-preview]').inputValue())
  check('first: the re-copied link carries the first name only', first.by?.name === 'Mo' && first.by?.did === undefined)
  await page.locator('[data-event-name-reveal="hidden"]').click(); await page.waitForTimeout(300)
  check('hidden is pressed', (await page.locator('[data-event-name-reveal="hidden"][aria-pressed="true"]').count()) === 1)
  await page.locator('[data-event-link-preview]').focus()
  const hidden = payloadOf(await page.locator('[data-event-link-preview]').inputValue())
  check('hidden: the re-copied link has no by', hidden.by === undefined && hidden.id === 'e1')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).events?.find((e) => e.id === 'e1'))
  check('the choice is saved on the event', saved?.nameReveal === 'hidden')
  await page.screenshot({ path: `${SHOTS}/event-name-reveal.png` })
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors.join('\n'))
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
