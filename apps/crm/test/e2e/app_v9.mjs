/**
 * Wave 7 app-v9 proof (headless, dev only): the Web rings, the Curator panel, the approve overlay.
 *   PORT=5192 STOCK=5292 node test/e2e/app_v9.mjs      (screenshots in $TMPDIR/app-v9-*.png)
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5192}/`
const STOCK = `http://127.0.0.1:${process.env.STOCK ?? 5292}/`
const MANUEL = 'tana-iHgGDVKE6vGG'
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const shot = (page, n) => page.screenshot({ path: path.join(tmpdir(), `app-v9-${n}.png`) })
const open = async (url, size, wait = true) => {
  const ctx = await browser.newContext({ viewport: size })
  const page = await ctx.newPage()
  await page.goto(url)
  if (wait) await page.locator('.rings-wrap').waitFor()
  return { ctx, page }
}
const nodes = (page) => page.evaluate(() => {
  const rec = JSON.parse(localStorage.getItem('trustweb.v1.me'))
  const ring = Object.fromEntries(rec.people.map((p) => [p.id, p.ring]))
  const circles = Object.fromEntries([...document.querySelectorAll('.rings-wrap circle')].map((c) => [c.getAttribute('data-ring'), +c.getAttribute('r')]))
  const list = [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((b) => ({ id: b.dataset.pid, ring: ring[b.dataset.pid], d: Math.hypot(parseFloat(b.style.left) - 176, parseFloat(b.style.top) - 176), letter: b.querySelector('.ava').textContent, bg: getComputedStyle(b.querySelector('.ava')).backgroundColor, fs: getComputedStyle(b.querySelector('.ava')).fontSize }))
  return { list, circles, labels: [...new Set(Object.values(ring))] }
})
try {
  const { ctx, page } = await open(URL, { width: 390, height: 844 })
  const w = await nodes(page)
  check('no contact tier: rings are the four circles, record rings have none', Object.keys(w.circles).join() === 'close,friend,acquaintance,intending' && !w.labels.includes('contact'))
  check('every drawn person is from the seeded Tana record (tana- ids), none from demo peers', w.list.length > 20 && w.list.every((n) => n.id.startsWith('tana-')))
  const m = w.list.find((n) => n.id === MANUEL)
  check('Manuel Spornberger on the close ring', m && Math.abs(m.d - w.circles.close) < 2)
  check('nobody sits inside their own ring (a full ring overflows outward)', w.list.every((n) => n.d >= (w.circles[n.ring] ?? 0) - 1.5))
  const light = w.list.filter((n) => n.ring === 'close' || n.ring === 'friend')
  console.log('  inner', JSON.stringify(light.filter((n) => !(n.letter.length === 1 && parseFloat(n.fs) >= 7)).slice(0, 3)))
  check('initials avatars on the inner rings', light.every((n) => n.letter.length === 1 && parseFloat(n.fs) >= 7))
  check('one green for everyone', new Set(w.list.map((n) => n.bg)).size === 1 && w.list[0].bg === 'rgb(46, 125, 50)')
  await shot(page, 'web-390')
  // arcs: two tags on Manuel
  await page.evaluate((id) => {
    const rec = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    const p = rec.people.find((x) => x.id === id)
    p.fields = { ...p.fields, LNlpliq4GdNI: 'true', ConGRasNilsz: 'true' }
    localStorage.setItem('trustweb.v1.me', JSON.stringify(rec))
    localStorage.setItem('trustweb.v1.colourtags', JSON.stringify([{ id: 'LNlpliq4GdNI', colour: '#7b1fa2' }, { id: 'ConGRasNilsz', colour: '#e65100' }]))
  }, MANUEL)
  await page.reload()
  await page.locator('.rings-wrap').waitFor()
  const arcs = await page.evaluate((id) => document.querySelector(`.rings-wrap [data-pid="${id}"]`).style.getPropertyValue('--arcs'), MANUEL)
  check('Manuel shows family (purple) and personal connection (orange) as separate arcs', arcs.includes('#7b1fa2') && arcs.includes('#e65100') && !/linear/.test(arcs))
  check('an untagged person has no arc', (await page.locator('.rings-wrap .node.tagged').count()) < 20)
  await page.locator('.rings-wrap [data-pid="' + MANUEL + '"] .ava').scrollIntoViewIfNeeded()
  await page.locator('.rings-wrap [data-pid="' + MANUEL + '"]').screenshot({ path: path.join(tmpdir(), 'app-v9-arcs.png') })
  // Curator panel
  const tabsHidden = async () => page.evaluate(() => { const c = document.querySelector('.curator'); const t = c?.shadowRoot?.querySelector('.tabbar'); return !t || !t.getClientRects().length || !c.getClientRects().length })
  check('Curator tabs not rendered while the panel is closed', await tabsHidden())
  await page.getByRole('button', { name: 'Contacts', exact: true }).click()
  const cur = page.locator('.sheet[data-kind=curator] .curator')
  await cur.getByRole('searchbox').waitFor({ timeout: 15_000 })
  const inside = await page.evaluate(() => {
    const t = document.querySelector('.curator').shadowRoot.querySelector('.tabbar').getBoundingClientRect()
    const s = document.querySelector('.sheet[data-kind=curator]').getBoundingClientRect()
    return t.bottom <= s.bottom + 1 && t.top >= s.top && t.left >= s.left - 1 && t.right <= s.right + 1
  })
  check('Curator tabs sit inside the open panel', inside)
  await cur.locator('.gear[data-tab=settings]').click()
  await cur.locator('[data-field=light-theme]').waitFor()
  const g = await cur.locator('[data-field=light-theme]').boundingBox()
  const sh = await page.locator('.sheet[data-kind=curator]').boundingBox()
  check('sun/moon toggle top right of Settings', g.y < sh.y + 170 && g.x + g.width > sh.x + sh.width - 90)
  const theme = () => page.evaluate(() => document.querySelector('.curator').dataset.theme)
  const before = await theme()
  await cur.locator('[data-field=light-theme]').click()
  check('toggle flips dark/light', before !== (await theme()) && ['dark', 'light'].includes(await theme()))
  await cur.locator('[data-field=light-theme]').click()
  check('dark is the default', (await theme()) === before && before === 'dark')
  check('Settings lists Colour tags with the family preset on', (await cur.locator('[data-colour-tag=LNlpliq4GdNI]').isChecked()) && (await cur.locator('[data-colour-of=LNlpliq4GdNI]').inputValue()) === '#7b1fa2')
  await shot(page, 'settings-390')
  await page.locator('[data-sheet-home]').click()
  await page.getByRole('button', { name: 'Resources' }).click()
  await page.getByPlaceholder(/Motorbike/).fill('Spare room in Vienna for visitors')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.inv', { hasText: 'Spare room in Vienna' }).locator('.inv-text').click()
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).inventory.find((i) => i.text.startsWith('Spare room')))
  check('item default unchanged: no selected tags (I9)', (await stored()).tagAudience === undefined)
  await page.locator('.sheet.on [data-item-tag=LNlpliq4GdNI]').waitFor()
  await page.locator('.sheet.on [data-item-tag=LNlpliq4GdNI]').click()
  check('selected tags: the family chip stores its tag id next to the rings', JSON.stringify((await stored()).tagAudience) === '["LNlpliq4GdNI"]' && (await stored()).audience === 'fof')
  await shot(page, 'item-tags')
  await page.locator('.sheet.on [data-item-tag=LNlpliq4GdNI]').click()
  check('toggling it off clears the selection', (await stored()).tagAudience === undefined)
  await ctx.close()

  for (const [w2, h2] of [[1920, 1080], [1280, 720]]) {
    const c = await open(URL, { width: w2, height: h2 })
    const box = await c.page.locator('.twf-ok').boundingBox()
    check(`approve overlay fully visible at ${w2}x${h2}`, box && box.x >= 0 && box.y >= 0 && box.x + box.width <= w2 && box.y + box.height <= h2)
    console.log('  overlay', JSON.stringify(box))
    check(`no Curator tabs below the frame at ${w2}x${h2}`, await c.page.evaluate(() => { const t = document.querySelector('.curator')?.shadowRoot?.querySelector('.tabbar'); return !t || !t.getClientRects().length }))
    await shot(c.page, `web-${w2}`)
    await c.ctx.close()
  }

  const s = await open(STOCK, { width: 390, height: 844 }, false)
  await s.page.waitForTimeout(2500)
  const sw = await nodes(s.page).catch(() => ({ list: [] }))
  console.log('  stock nodes', sw.list.length)
  check('stock preview (5292) shows none of the personal record', sw.list.every((n) => !n.id.startsWith('tana-')))
  await s.ctx.close()
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
