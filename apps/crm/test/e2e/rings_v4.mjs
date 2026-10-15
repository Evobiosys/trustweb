/**
 * Wave 7 rings-v4 proof (headless, dev only): four rings plus the grey unsorted ring, drag-out hides with Undo, the intending reminder, the dark person page in the sheet.
 *   PORT=5198 node test/e2e/rings_v4.mjs      (start the dev server WITHOUT TW_CRM_TANA_TOKEN: a hide would otherwise queue a write to the real Tana)
 */
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5198}/`
const EMAIL = 'Bxw7k4FWptqp'
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const shot = (page, n) => page.screenshot({ path: path.join(tmpdir(), `rings-v4-${n}.png`) })
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await page.goto(URL)
  await page.locator('.rings-wrap').waitFor()
  const rec = await record(page)
  const ringed = rec.people.filter((p) => ['close', 'friend', 'acquaintance', 'intending'].includes(p.ring))
  const rings = await page.evaluate(() => [...document.querySelectorAll('.rings-wrap circle')].map((c) => c.getAttribute('data-ring')))
  check('four rings and the grey unsorted ring: close, friend, acquaintance, intending, unsorted', rings.join() === 'close,friend,acquaintance,intending,unsorted')
  check('people not placed yet sit on the unsorted ring', rec.people.some((p) => p.ring === 'unsorted' || p.ring === 'none') && (await page.locator('.rings-wrap .node:not(.you)').count()) === rec.people.length)
  check('no "in contact" text in the rings view; the unsorted ring is labelled "Not placed yet"', !/in contact/i.test(await page.locator('.rings-wrap').innerText()) && (await page.locator('[data-ring-label]').textContent()) === 'Not placed yet')
  await shot(page, 'rings')

  const box = await page.locator('.rings-wrap').boundingBox()
  const k = box.width / 352
  const centre = (id) => page.locator(`.rings-wrap [data-pid="${id}"]`).boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  const drag = async (id, to) => {
    const from = await centre(id)
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
    await page.mouse.move(to.x, to.y, { steps: 8 })
    return () => page.mouse.up()
  }

  // drag out: hides, Undo within 30 s brings the person back
  const victim = rec.people.find((p) => p.ring === 'acquaintance' && !p.peerId)
  const up = await drag(victim.id, { x: box.x + 3, y: box.y + 3 })
  check('while dragging beyond the outermost ring the view shows the hide zone', await page.locator('.rings-wrap.hide-zone').count() === 1)
  await up()
  await page.locator('[data-undo-hide]').waitFor({ timeout: 10_000 })
  check('released outside: person leaves the rings and the record, Undo toast shown', (await page.locator(`.rings-wrap [data-pid="${victim.id}"]`).count()) === 0 && !(await record(page)).people.some((p) => p.id === victim.id))
  await shot(page, 'hidden')
  const settings = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /crm/i.test(key)).map(([, v]) => v).join('|').includes('hiddenPeople'))
  check('listed as hidden for Curator Settings (unhide)', settings)
  await page.locator('[data-undo-hide]').click()
  await page.locator(`.rings-wrap [data-pid="${victim.id}"]`).waitFor({ timeout: 10_000 })
  check('Undo puts them back on their ring', (await record(page)).people.some((p) => p.id === victim.id && p.ring === 'acquaintance'))

  // intending reminder for someone with an email
  const withMail = rec.people.find((p) => p.fields?.[EMAIL] && p.ring === 'friend' && !p.peerId) ?? rec.people.find((p) => p.fields?.[EMAIL] && ringed.includes(p) && p.ring !== 'intending')
  const r = await page.evaluate(() => +document.querySelector('.rings-wrap circle[data-ring="intending"]').getAttribute('r'))
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const up2 = await drag(withMail.id, { x: c.x + r * k, y: c.y })
  await up2()
  const note = page.locator('[data-intending-reminder]')
  await note.first().waitFor({ timeout: 10_000 })
  const text = await note.allInnerTexts()
  console.log('  reminder:', JSON.stringify(text))
  check('dropping on intending is not refused: the desire scale shows, with the email reminder', (await page.locator('.desire').count()) === 1 && text.some((t) => /^You already have contact details for .+ \(.*email.*\)$/.test(t)))
  await shot(page, 'reminder')
  await page.locator('.desire-go .btn-ghost').click()

  // dark person page in the sheet
  await page.locator(`.rings-wrap [data-pid="${withMail.id}"]`).dispatchEvent('click')
  await page.locator('.curator-person').waitFor()
  const field = page.locator('.curator-person').locator('[data-field=add-note]')
  await field.waitFor({ timeout: 15_000 })
  const look = await field.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, font: getComputedStyle(e).fontFamily, row: getComputedStyle(e.getRootNode().querySelector('.person-row, .line, .tl-row') ?? e).backgroundColor }))
  console.log('  look:', JSON.stringify(look))
  check('"Add a note" box is dark with the Curator font (not light, not serif)', look.bg === 'rgb(43, 33, 57)' && /Seravek|system-ui/.test(look.font))
  await shot(page, 'person')

  // Curator: unplaced people sit in a collapsed list, the chooser offers the four rings and out of my web
  await page.reload()
  await page.locator('.rings-wrap').waitFor()
  await page.getByRole('button', { name: 'Web Curator' }).click()
  const cur = page.locator('.sheet[data-kind=curator] .curator')
  await cur.getByRole('searchbox').waitFor({ timeout: 15_000 })
  const np = cur.locator('[data-part=not-placed]')
  check('Curator: "Not placed yet (n)" list, collapsed', (await np.count()) === 1 && /^Not placed yet \(\d+\)/i.test(await np.locator('summary').innerText()) && (await np.evaluate((e) => !e.open)))
  check('Curator headings: four rings, no Unsorted', !(await cur.locator('.ring-heading').allInnerTexts()).some((t) => /unsorted|contact\b/i.test(t)))
  await np.locator('summary').evaluate((e) => e.click())
  await np.locator('[data-action=ring-label]').first().evaluate((e) => e.click())
  const chips = await cur.locator('.ring-pop .rchip').allInnerTexts()
  console.log('  chooser:', JSON.stringify(chips))
  check('chooser: close friend, friend, acquaintance, intending to connect, not in my web (no unsorted)', chips.join('|') === 'Close friend|Friend|Acquaintance|Intending to connect|Not in my web|Family')
  await shot(page, 'curator')
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
