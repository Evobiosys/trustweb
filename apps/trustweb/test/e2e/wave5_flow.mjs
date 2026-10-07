/**
 * Wave 5 app flows, one part per owner item (2026-10-07). Parts are selected with PARTS=a,b,f (default: all).
 *   a  "Dismiss them" under "Got it": the embedded demo drops its seeded web, a live phone only what "Show demo content" added
 *   b  the demo's Install button carries "for yourself" beneath it (outside the button)
 *   f  the installed app (display-mode: standalone, navigator.standalone) hides "Add a device" and "Show demo content"
 *   d  "General notes" on Record without Advanced, above its fields; it rides on the saved note and the past meeting
 *   c  "none of these" (a plain note) and "what" adding context to an existing thing
 *   m  a record whose wave-5 fields are damaged still boots; the damage is dropped, the rest untouched
 *   g  the demo page removes a device (never the first); a removed middle phone's persona is reused, never doubled
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8984 ../../node_modules/.bin/tsx ../trustweb/test/e2e/wave5_flow.mjs
 */
import { launch, startApp, startPhone, tally } from '../helpers/e2e_harness.mjs'

const t = tally()
const PARTS = (process.env.PARTS || 'a,b,f,g,d,c,m').split(',')
const errors = []
const people = (page) => page.locator('.node:not(.you)')

async function newPage(browser, viewport, init) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] })
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page }
}

/** The embedded demo phone, as the demo page runs it (one iframe per device). */
const demoDevice = (page, n) => page.frameLocator(`iframe[title="Device ${n}"]`)

async function partB(browser, base) {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
  await page.goto(base + 'demo/')
  const btn = page.locator('[data-demo-install]')
  t.ok('b: the Install button is still named exactly "Install"', (await btn.innerText()).trim() === 'Install')
  const sub = page.locator('.demo-install-sub')
  t.ok('b: "for yourself" sits beneath it, outside the button', (await sub.innerText()).trim() === 'for yourself' && await btn.locator('.demo-install-sub').count() === 0)
  const [bb, sb] = await Promise.all([btn.boundingBox(), sub.boundingBox()])
  t.ok('b: it is below the button', sb.y >= bb.y + bb.height - 1, JSON.stringify([bb, sb]))
  const look = await page.evaluate(() => {
    const b = document.querySelector('[data-demo-install]'); const s = document.querySelector('.demo-install-sub')
    const cb = getComputedStyle(b); const cs = getComputedStyle(s)
    return { bSize: parseFloat(cb.fontSize), sSize: parseFloat(cs.fontSize), bWeight: Number(cb.fontWeight), sWeight: Number(cs.fontWeight), bColor: cb.color, sColor: cs.color }
  })
  t.ok('b: smaller font, lighter weight, another colour than the button', look.sSize < look.bSize && look.sWeight < look.bWeight && look.sColor !== look.bColor, JSON.stringify(look))
  t.ok('b: the topbar still holds ONE visible button (the device switch is hidden with one device)', await page.locator('.demo-topbar button:visible').count() === 1)
  t.ok('b: the button points at its sub-line as its description', (await btn.getAttribute('aria-describedby')) === (await sub.getAttribute('id')))
  await ctx.close()
}

async function partA(browser, base) {
  // Embedded demo: the seeded web goes, a person added meanwhile stays.
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
    await page.goto(base + 'demo/')
    const phone = demoDevice(page, 1)
    await phone.getByLabel('Your first name').fill('Jakob')
    await phone.getByRole('button', { name: 'Start on this phone' }).click()
    await phone.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    const popup = phone.locator('.demo-friends')
    await popup.waitFor({ timeout: 5_000 })
    t.ok('a: the popup carries "Dismiss them" under "Got it"', (await popup.locator('.notice-actions button').allInnerTexts()).map((x) => x.trim()).join('|') === 'Got it|Dismiss them')
    const sizes = await popup.evaluate((p) => { const g = getComputedStyle(p.querySelector('.btn')); const d = getComputedStyle(p.querySelector('.notice-dismiss')); return { gs: parseFloat(g.fontSize), ds: parseFloat(d.fontSize), gc: g.color, dc: d.color } })
    t.ok('a: "Dismiss them" is smaller and another colour than "Got it"', sizes.ds < sizes.gs && sizes.dc !== sizes.gc, JSON.stringify(sizes))
    const before = await people(phone).count()
    t.ok('a: the seeded friends are there first', before >= 5, String(before))
    await phone.locator('.rings-wrap').click({ position: { x: 176 + 152, y: 176 } })
    await phone.getByPlaceholder('Name').first().fill('Max')
    await phone.getByRole('button', { name: 'Add to my web' }).click()
    await phone.locator('.node', { hasText: 'Max' }).waitFor({ timeout: 5_000 })
    await popup.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {})
    if (await popup.isHidden()) t.ok('a: (the popup went by itself before Dismiss; part skipped)', false)
    else {
      await popup.locator('.notice-dismiss').click()
      await phone.locator('.toast.on').waitFor({ timeout: 3_000 })
      t.ok('a: after "Dismiss them" the seeded friends are gone', await people(phone).count() === 1, String(await people(phone).count()))
      t.ok('a: the person added meanwhile stays', await phone.locator('.node', { hasText: 'Max' }).count() === 1)
      t.ok('a: the popup is closed', await popup.isHidden())
    }
    await ctx.close()
  }
  // Live phone: "Show demo content", then "Dismiss them" takes only those; a real person stays.
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
    await startPhone(page, base, 'Real Person')
    await page.locator('.rings-wrap').click({ position: { x: 176 + 152, y: 176 } })
    await page.getByPlaceholder('Name').first().fill('Max')
    await page.getByRole('button', { name: 'Add to my web' }).click()
    await page.locator('.node', { hasText: 'Max' }).waitFor({ timeout: 5_000 })
    const toggle = page.locator('.demo-toggle')
    await toggle.waitFor({ timeout: 5_000 })
    await toggle.click()
    const popup = page.locator('.demo-friends')
    await popup.waitFor({ timeout: 5_000 })
    t.ok('a: live phone, the demo friends came in next to Max', await people(page).count() > 1)
    await popup.locator('.notice-dismiss').click()
    await page.locator('.toast.on').waitFor({ timeout: 3_000 })
    t.ok('a: live phone, only Max is left after "Dismiss them"', await people(page).count() === 1 && await page.locator('.node', { hasText: 'Max' }).count() === 1)
    t.ok('a: live phone, the toggle offers "Show demo content" again', (await toggle.innerText()).trim() === 'Show demo content')
    await ctx.close()
  }
}

async function partF(browser, base) {
  const standaloneMedia = () => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { ...real(q), matches: true, media: q } : real(q))
  }
  const iosStandalone = () => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }) }
  const cases = [['a browser tab', undefined, false], ['display-mode: standalone', standaloneMedia, true], ['navigator.standalone (iOS)', iosStandalone, true]]
  for (const [label, init, installed] of cases) {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 900 }, init)
    await startPhone(page, base, 'Installed Person')
    await page.waitForTimeout(300)
    const addVisible = await page.locator('.add-device').count() > 0 && await page.locator('.add-device').isVisible()
    const toggleVisible = await page.locator('.demo-toggle').isVisible()
    t.ok(`f: ${label}: "Add a device" is ${installed ? 'hidden' : 'shown'}`, addVisible === !installed)
    t.ok(`f: ${label}: "Show demo content" (dock) is ${installed ? 'hidden' : 'shown'}`, toggleVisible === !installed)
    t.ok(`f: ${label}: "See it in action" stays`, await page.locator('.see-action').isVisible())
    await page.locator('nav.tabs button', { hasText: 'Web' }).click()
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByText('Settings', { exact: true }).first().click().catch(() => {})
    await page.locator('.sheet.on').waitFor({ timeout: 5_000 })
    const settingsHasDemo = await page.locator('.sheet.on').getByText('Show demo content').count() > 0
    t.ok(`f: ${label}: Settings ${installed ? 'offers no' : 'offers'} "Show demo content"`, settingsHasDemo === !installed)
    await ctx.close()
  }
}

async function partG(browser, base) {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
  await page.goto(base + 'demo/')
  const titles = () => page.locator('iframe').evaluateAll((fs) => fs.map((f) => f.title))
  const devicesKey = () => page.evaluate(() => localStorage.getItem('trustweb.demo.devices.generic'))
  const first = demoDevice(page, 1)
  await first.getByLabel('Your first name').fill('Maya')
  await first.getByRole('button', { name: 'Start on this phone' }).click()
  await first.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.locator('.dock .add').click()
  await page.locator('.dock .add').click()
  t.ok('g: three devices after two "Add a device"', JSON.stringify(await titles()) === JSON.stringify(['Device 1', 'Device 2', 'Device 3']), JSON.stringify(await titles()))
  t.ok('g: the first device has no remove, the others have one', await page.locator('.col').nth(0).locator('.remove-device').count() === 0 && await page.locator('.remove-device').count() === 2)
  t.ok('g: the page remembers the open devices as a list', (await devicesKey()) === 'holder,seeker,third', String(await devicesKey()))
  await page.locator('.col[data-persona="seeker"] .remove-device').click()
  t.ok('g: removing the middle phone leaves Device 1 and Device 3', JSON.stringify(await titles()) === JSON.stringify(['Device 1', 'Device 3']), JSON.stringify(await titles()))
  t.ok('g: its stored record is gone, the first device keeps its own', await page.evaluate(() => localStorage.getItem('trustweb.v1.generic.seeker') === null && localStorage.getItem('trustweb.v1.generic.holder') !== null))
  t.ok('g: the remembered list follows', (await devicesKey()) === 'holder,third', String(await devicesKey()))
  t.ok('g: Device 3 is in front, so the switch offers Device 1', /Switch to device 1/.test(await page.locator('.switch').innerText()))
  await page.locator('.switch').click()
  t.ok('g: from Device 1 the switch offers Device 3, numbered by the phone\'s own title, not by its position', /Switch to device 3/.test(await page.locator('.switch').innerText()), await page.locator('.switch').innerText())
  await page.locator('.dock .add').click()
  const after = await titles()
  t.ok('g: "Add a device" reuses the freed persona and never opens one twice', JSON.stringify(after) === JSON.stringify(['Device 1', 'Device 3', 'Device 2']) && new Set(after).size === after.length, JSON.stringify(after))
  await page.reload()
  await page.locator('iframe').first().waitFor()
  t.ok('g: after a reload the same three devices come back', JSON.stringify((await titles()).sort()) === JSON.stringify(['Device 1', 'Device 2', 'Device 3']), JSON.stringify(await titles()))
  // all but the first can go; the first stays whatever is pressed
  await page.locator('.col[data-persona="seeker"] .remove-device').click()
  await page.locator('.col[data-persona="third"] .remove-device').click()
  t.ok('g: with every added phone removed one device is left, and the page says "demo" again', JSON.stringify(await titles()) === JSON.stringify(['Device 1']) && /TrustWeb demo/.test(await page.title()), JSON.stringify(await titles()) + ' / ' + await page.title())
  t.ok('g: no remove is offered on the last one', await page.locator('.remove-device').count() === 0)
  await ctx.close()
}

const stateOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

/** Record from Web opens "just me" (from Inventory it would open a meeting: record_origin.ts). */
async function toRecord(page) {
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.rec-circle').waitFor()
}

async function partD(browser, base) {
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 })
  await startPhone(page, base, 'Notes Tester')
  await toRecord(page)
  const notes = page.locator('[data-general-notes]')
  t.ok('d: "General notes" is on Record with Advanced closed', await notes.isVisible() && await page.locator('.adv.open').count() === 0)
  t.ok('d: it is titled "General notes"', (await page.locator('.general-notes-sec h4').innerText()).trim().toLowerCase() === 'general notes')
  const order = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.scroll.memo > *')]
    const idx = (sel) => all.findIndex((n) => n.matches(sel) || n.querySelector(sel))
    return { general: idx('[data-general-notes]'), advanced: idx('.adv'), prompts: idx('.rec-prompts') }
  })
  t.ok('d: it sits above the Advanced fields', order.general >= 0 && order.general < order.advanced, JSON.stringify(order))
  t.ok('d: send and discard are off with nothing typed', await page.locator('[data-record-send]').isDisabled() && await page.locator('[data-record-discard]').isDisabled())
  await notes.click()
  await page.keyboard.type('Met at the station. ')
  await page.keyboard.type('She runs a repair cafe.')
  t.ok('d: typing keeps the caret (no redraw): the field is still focused and holds all of it', await page.evaluate(() => document.activeElement?.matches('[data-general-notes]')) && (await notes.inputValue()) === 'Met at the station. She runs a repair cafe.')
  t.ok('d: send and discard come on as soon as something is typed', await page.locator('[data-record-send]').isEnabled() && await page.locator('[data-record-discard]').isEnabled())
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await toRecord(page)
  t.ok('d: the typed notes are still there after leaving Record and coming back', (await page.locator('[data-general-notes]').inputValue()) === 'Met at the station. She runs a repair cafe.')
  await page.locator('[data-record-send]').click()
  await page.getByPlaceholder('Name').fill('Anna Repair')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByText('Looks right').waitFor({ timeout: 10_000 })
  const lines = await page.locator('.line-card textarea').evaluateAll((els) => els.map((e) => e.value))
  t.ok('d: the notes-only memo reaches Review as one note line with the typed text', lines.length === 1 && lines[0] === 'Met at the station. She runs a repair cafe.', JSON.stringify(lines))
  await page.getByRole('button', { name: 'Looks right' }).click()
  await page.getByRole('button', { name: 'Save to my web' }).click()
  await page.locator('.toast.on').waitFor({ timeout: 5_000 })
  const s = await stateOf(page)
  const person = s.people.find((p) => p.name === 'Anna Repair')
  t.ok('d: the saved note is on the person, typed (no recording)', person?.lines.length === 1 && person.lines[0].text === 'Met at the station. She runs a repair cafe.' && person.lines[0].source?.kind === 'typed', JSON.stringify(person))
  t.ok('d: a notes-only memo is stored as a past meeting that carries the General notes', s.meetings?.length === 1 && s.meetings[0].generalNotes === 'Met at the station. She runs a repair cafe.' && s.meetings[0].meeting === false, JSON.stringify(s.meetings))
  await toRecord(page)
  await page.locator('.past-link').click()
  const row = page.locator('.pm-row').first()
  t.ok('d: the Past meetings list shows the General notes beside the meeting', /Anna Repair/.test(await row.innerText()) && /Met at the station/.test(await row.locator('[data-pm-snip]').innerText()))
  await row.click()
  t.ok('d: its detail has a General notes section', /Met at the station\. She runs a repair cafe\./.test(await page.locator('[data-pm-general]').innerText()))
  await ctx.close()
}

async function partC(browser, base) {
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 })
  await startPhone(page, base, 'Context Tester')
  // a thing to add context to
  await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await page.getByPlaceholder(/Motorbike/).fill('Loudspeakers')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.inv-text', { hasText: 'Loudspeakers' }).waitFor({ timeout: 5_000 })
  const before = await stateOf(page)
  // 1. none of these -> a plain note, no link
  await toRecord(page)
  await page.locator('[data-general-notes]').fill('Idea: a map of repair cafes')
  await page.locator('[data-record-send]').click()
  await page.locator('[data-about-none]').waitFor()
  t.ok('c: the sheet offers "X none of these"', /none of these/.test(await page.locator('[data-about-none]').innerText()))
  await page.locator('[data-about-none]').click()
  await page.getByText('Looks right').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Looks right' }).click()
  await page.locator('.toast.on').waitFor({ timeout: 5_000 })
  const s1 = await stateOf(page)
  t.ok('c: a plain note adds no person and no thing', s1.people.length === before.people.length && s1.inventory.length === before.inventory.length, JSON.stringify([s1.people.length, s1.inventory.length]))
  const plain = s1.meetings?.find((m) => m.plain === true)
  t.ok('c: it is kept as a past meeting only, marked plain, with its note and no link', plain && plain.lines.some((l) => /map of repair cafes/.test(l.text)) && plain.personId === undefined && plain.kind !== 'none', JSON.stringify(plain))
  await toRecord(page)
  await page.locator('.past-link').click()
  t.ok('c: the Past meetings list says "Plain note"', /Plain note/.test(await page.locator('.pm-row').first().innerText()))
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  // 2. what -> an existing thing: the note becomes its context
  await page.locator('.about-kind.what').click()
  t.ok('c: under "what" the sheet says an existing thing takes the note as context', /add this as context/i.test(await page.locator('.about-ctx-hint').innerText()))
  await page.locator('.sheet.on .chip', { hasText: 'Loudspeakers' }).click()
  await page.locator('[data-general-notes]').fill('Lent two of them to Anna in June')
  await page.locator('[data-record-send]').click()
  await page.locator('[data-save-context], .btn:has-text("Looks right")').first().waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Looks right' }).click()
  await page.locator('[data-save-context]').click()
  await page.locator('.toast.on').waitFor({ timeout: 5_000 })
  const s2 = await stateOf(page)
  const thing = s2.inventory.find((i) => i.text === 'Loudspeakers')
  t.ok('c: no new line in the inventory', s2.inventory.length === before.inventory.length, String(s2.inventory.length))
  t.ok('c: the note is context on the existing thing, with when and the meeting it came from', thing?.context?.length === 1 && thing.context[0].text === 'Lent two of them to Anna in June' && typeof thing.context[0].at === 'number' && typeof thing.context[0].meetingId === 'string', JSON.stringify(thing))
  t.ok('c: the thing itself is untouched (text, audience)', thing.text === 'Loudspeakers' && thing.audience === before.inventory.find((i) => i.text === 'Loudspeakers').audience)
  await page.locator('.inv-text', { hasText: 'Loudspeakers' }).click()
  t.ok('c: the item sheet shows the context', /Lent two of them to Anna in June/.test(await page.locator('[data-item-context]').innerText()))
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  // 3. the same note again is not added twice
  await toRecord(page)
  await page.locator('.about-kind.what').click()
  await page.locator('.sheet.on .chip', { hasText: 'Loudspeakers' }).click()
  await page.locator('[data-general-notes]').fill('  lent TWO of them to anna in june ')
  await page.locator('[data-record-send]').click()
  await page.getByRole('button', { name: 'Looks right' }).click()
  await page.locator('[data-save-context]').click()
  await page.locator('.toast.on').waitFor({ timeout: 5_000 })
  t.ok('c: the same note again says nothing new and is not added twice', /Nothing new/.test(await page.locator('.toast').innerText()) && (await stateOf(page)).inventory.find((i) => i.text === 'Loudspeakers').context.length === 1)
  // 4. a name that is not a thing still makes new lines, as before
  await toRecord(page)
  await page.locator('.about-kind.what').click()
  await page.locator('.sheet.on input.field').fill('Tent for four')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.locator('[data-general-notes]').fill('Waterproof, from June')
  await page.locator('[data-record-send]').click()
  await page.getByRole('button', { name: 'Looks right' }).click()
  await page.getByRole('button', { name: 'Save to my inventory' }).click()
  await page.locator('.toast.on').waitFor({ timeout: 5_000 })
  const s3 = await stateOf(page)
  t.ok('c: a new thing still becomes a new inventory line', s3.inventory.some((i) => i.text === 'Tent for four: Waterproof, from June'), JSON.stringify(s3.inventory.map((i) => i.text)))
  await ctx.close()
}

async function partM(browser, base) {
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 })
  await startPhone(page, base, 'Damaged Fields')
  await page.evaluate(() => {
    const k = 'trustweb.v1.me'
    const s = JSON.parse(localStorage.getItem(k))
    s.inventory = [{ id: 'i1', text: 'Loudspeakers', audience: 'fof', included: true, createdAt: 1, context: 'oops' }, { id: 'i2', text: 'Ladder', audience: 'fof', included: true, createdAt: 1, context: [{ text: 'ok', at: 5 }, 7, { text: 'ok ', at: 6 }] }]
    s.meetings = [{ id: 'm1', about: 'x', kind: 'who', where: '', startedAt: 1, endedAt: 2, durationMs: 1, meeting: false, lines: [], transcript: [], generalNotes: { not: 'a string' }, plain: 'yes' }]
    localStorage.setItem(k, JSON.stringify(s))
  })
  await page.reload()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const s = await stateOf(page)
  t.ok('m: the app boots with damaged wave-5 fields', s.me.displayName === 'Damaged Fields')
  t.ok('m: a context that is no list is dropped, a list is cleaned and deduplicated', !('context' in s.inventory[0]) && JSON.stringify(s.inventory[1].context) === JSON.stringify([{ text: 'ok', at: 5 }]), JSON.stringify(s.inventory))
  t.ok('m: damaged General notes and plain are dropped, the meeting itself stays', s.meetings.length === 1 && !('generalNotes' in s.meetings[0]) && !('plain' in s.meetings[0]))
  await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await page.locator('.inv-text', { hasText: 'Ladder' }).click()
  t.ok('m: the item sheet shows the clean context only', (await page.locator('[data-item-context]').innerText()).includes('ok'))
  await ctx.close()
}

async function main() {
  const app = await startApp(Number(process.env.TW_PORT || 8984))
  const browser = await launch()
  try {
    if (PARTS.includes('b')) await partB(browser, app.base)
    if (PARTS.includes('a')) await partA(browser, app.base)
    if (PARTS.includes('f')) await partF(browser, app.base)
    if (PARTS.includes('g')) await partG(browser, app.base)
    if (PARTS.includes('d')) await partD(browser, app.base)
    if (PARTS.includes('c')) await partC(browser, app.base)
    if (PARTS.includes('m')) await partM(browser, app.base)
  } finally {
    await browser.close()
    await app.stop()
  }
  t.ok('no page errors', errors.length === 0, errors.join(' | '))
  console.log(t.failures ? `\n${t.failures} FAILED` : '\nALL PASS')
  process.exit(t.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
