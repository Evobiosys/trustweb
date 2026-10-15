/** Wave 7 dot-positions proof (headless, dev only): PORT=5310 node dot_positions.mjs (a stock dev server); MODE=shot SHOT=file.png PORT=5210 spaces the personal preview's rings out and shoots before/after (SHOT_BEFORE=file.png). EXE=<chromium headless shell> if the default is not installed. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5310}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
const hideBanner = (page) => page.addStyleTag({ content: '.demo-friends { position: fixed !important; top: auto !important; bottom: 0 !important; left: 0; right: 0; z-index: 99 }' })
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false })).newPage()
  const wrap = () => page.locator('.rings-wrap')
  if (process.env.MODE === 'shot') {
    await page.goto(URL); await wrap().waitFor(); await hideBanner(page)
    await wrap().scrollIntoViewIfNeeded(); await page.waitForTimeout(800)
    await page.screenshot({ path: process.env.SHOT_BEFORE })
    const b = await wrap().boundingBox()
    await page.mouse.click(b.x + 6, b.y + b.height - 6, { button: 'right' })
    await page.locator('[data-space-out="all"]').click(); await page.waitForTimeout(600)
    await page.screenshot({ path: process.env.SHOT })
    process.exit(0)
  }
  const seed = (people) => page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })), people)
  const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  const spots = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => [n.dataset.pid, n.style.left + ',' + n.style.top])))
  await page.goto(URL)
  await seed([P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'friend'), P('c1', 'Cora Lang', 'friend'), P('s1', 'Uli Mayr', 'unsorted')])
  await page.reload(); await wrap().waitFor(); await hideBanner(page)
  const box = await wrap().boundingBox()
  const k = box.width / 352
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const rad = (r) => page.evaluate((x) => +document.querySelector(`.rings-wrap circle[data-ring="${x}"]`).getAttribute('r'), r)
  const centre = (id) => page.locator(`.rings-wrap [data-pid="${id}"]`).boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  const dragTo = async (id, to) => {
    const from = await centre(id)
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up(); await page.waitForTimeout(300)
  }
  const onRing = async (deg) => ({ x: c.x + (await rad('friend')) * k * Math.sin((deg * Math.PI) / 180), y: c.y - (await rad('friend')) * k * Math.cos((deg * Math.PI) / 180) })
  const angleOf = async (id) => (await record()).people.find((p) => p.id === id).angle

  await dragTo('a1', await onRing(40)); await dragTo('b1', await onRing(100)); await dragTo('c1', await onRing(250))
  check('dropped dots store the angle they were dropped at (+-3 deg)', Math.abs((await angleOf('a1')) - 40) < 3 && Math.abs((await angleOf('b1')) - 100) < 3 && Math.abs((await angleOf('c1')) - 250) < 3)
  const placed = await spots()
  await page.reload(); await wrap().waitFor()
  check('reload: every dot at the same position', JSON.stringify(await spots()) === JSON.stringify(placed))

  const rec = await record()
  rec.people.push(P('d1', 'Dora Fink', 'friend'))
  await seed(rec.people); await page.reload(); await wrap().waitFor(); await hideBanner(page)
  const four = await spots()
  check('a fourth person added: the other three stay where they were', ['a1', 'b1', 'c1'].every((id) => four[id] === placed[id]))

  const gaps = async () => {
    const a = (await record()).people.filter((p) => p.ring === 'friend').map((p) => p.angle ?? -1).sort((x, y) => x - y)
    return a.map((v, i) => (a[(i + 1) % a.length] - v + 360) % 360)
  }
  const free = await onRing(325)
  await page.mouse.click(free.x, free.y, { button: 'right' })
  check('right click on a ring line offers this ring and all rings', (await page.locator('[data-space-out="friend"]').count()) === 1 && (await page.locator('[data-space-out="all"]').count()) === 1)
  await page.locator('[data-space-out="friend"]').click(); await page.waitForTimeout(400)
  const g = await gaps()
  check('Space out this ring: four equal gaps of 90 deg', g.length === 4 && g.every((x) => Math.abs(x - 90) < 0.01))
  check('order kept: a1, b1, c1 still in angle order', (await (async () => { const r = (await record()).people; return r.find((p) => p.id === 'a1').angle < r.find((p) => p.id === 'b1').angle && r.find((p) => p.id === 'b1').angle < r.find((p) => p.id === 'c1').angle })()))
  await page.locator('[data-undo-space]').click(); await page.waitForTimeout(400)
  check('Undo restores the dropped angles (d1 back to none)', Math.abs((await angleOf('a1')) - 40) < 3 && Math.abs((await angleOf('c1')) - 250) < 3 && (await angleOf('d1')) === undefined)
  check('Undo: positions as before', JSON.stringify(await spots()) === JSON.stringify(four))

  await page.mouse.click(c.x, c.y + 66 * (await rad('friend')) / 84 * k, { button: 'right' })
  check('right click on empty space offers only "all rings"', (await page.locator('[data-space-out="all"]').count()) === 1 && (await page.locator('[data-space-out="friend"]').count()) === 0)
  await page.mouse.click(4, box.y + 200)
  check('a press elsewhere closes the menu', (await page.locator('.ctx-menu').count()) === 0)

  // Touch: a 500 ms hold on empty web space is the right click; a move over 6 px is not.
  const touch = (type, x, y) => page.evaluate(([ty, px, py]) => document.querySelector('.rings-wrap').dispatchEvent(new PointerEvent(ty, { bubbles: true, pointerType: 'touch', clientX: px, clientY: py })), [type, x, y])
  const at = { x: c.x, y: c.y + 66 * (await rad('friend')) / 84 * k }
  await touch('pointerdown', at.x, at.y); await page.waitForTimeout(650); await touch('pointerup', at.x, at.y)
  check('touch: a 500 ms hold on empty space opens the menu', (await page.locator('[data-space-out="all"]').count()) === 1)
  await page.mouse.click(4, box.y + 200)
  await touch('pointerdown', at.x, at.y); await touch('pointermove', at.x + 12, at.y); await page.waitForTimeout(650)
  check('touch: a move over 6 px is not a long-press', (await page.locator('.ctx-menu').count()) === 0)
  await touch('pointerup', at.x, at.y)
  await page.locator('.rings-wrap .node.you').click()
  check('tapping my name: name sheet with a line and "My web" > "Space out all rings"', (await page.locator('.sheet-line').count()) === 1 && (await page.locator('.sheet h4.eyebrow').allTextContents()).includes('My web'))
  await page.locator('.sheet [data-space-out="all"]').click(); await page.waitForTimeout(400)
  check('from the sheet: all rings spaced (friend ring four gaps of 90)', (await gaps()).every((x) => Math.abs(x - 90) < 0.01) && (await page.locator('[data-undo-space]').count()) === 1)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
