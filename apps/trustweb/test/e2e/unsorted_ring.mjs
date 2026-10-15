/** Wave 7 unsorted-ring proof (headless, dev only): PORT=5308 node test/e2e/unsorted_ring.mjs (a stock dev server); MODE=shot SHOT=file.png PORT=5208 takes a screenshot of the personal preview. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5308}/`
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  if (process.env.MODE === 'shot') {
    await page.goto(URL); await page.locator('.rings-wrap').waitFor()
    await page.locator('.rings-wrap').scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    await page.screenshot({ path: process.env.SHOT })
    const rings = await page.evaluate(() => [...document.querySelectorAll('.rings-wrap circle')].map((c) => c.getAttribute('data-ring')))
    console.log('rings:', rings.join(), 'grey dots:', await page.locator('.rings-wrap .node:not(.you) .ava').evaluateAll((l) => l.filter((e) => getComputedStyle(e).backgroundColor === 'rgb(158, 158, 158)').length))
    process.exit(0)
  }
  const seed = (people) => page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })), people)
  const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  const ringsOf = () => page.evaluate(() => [...document.querySelectorAll('.rings-wrap circle')].map((c) => c.getAttribute('data-ring')).join())
  await page.goto(URL)
  await seed([P('a1', 'Anna Huber', 'close'), P('b1', 'Ben Gruber', 'friend')])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  check('nobody unsorted: four rings, no unsorted label (stock look unchanged)', (await ringsOf()) === 'close,friend,acquaintance,intending' && (await page.locator('[data-ring-label]').count()) === 0)

  await seed([P('a1', 'Anna Huber', 'close'), P('b1', 'Ben Gruber', 'friend'), P('u1', 'Uli Mayr', 'unsorted')])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  check('one unsorted person: fifth ring "Not placed yet" drawn with its label', (await ringsOf()) === 'close,friend,acquaintance,intending,unsorted' && (await page.locator('[data-ring-label]').textContent()) === 'Not placed yet')
  const bg = (id) => page.locator(`.rings-wrap [data-pid="${id}"] .ava`).evaluate((e) => getComputedStyle(e).backgroundColor)
  check('unsorted dot is grey, placed dots are not', (await bg('u1')) === 'rgb(158, 158, 158)' && (await bg('a1')) !== 'rgb(158, 158, 158)')

  const box = await page.locator('.rings-wrap').boundingBox()
  const k = box.width / 352
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const rad = (r) => page.evaluate((x) => +document.querySelector(`.rings-wrap circle[data-ring="${x}"]`).getAttribute('r'), r)
  const centre = (id) => page.locator(`.rings-wrap [data-pid="${id}"]`).boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  const dragTo = async (id, to) => {
    const from = await centre(id)
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
  }
  const ringOf = async (id) => (await record()).people.find((p) => p.id === id).ring

  await dragTo('b1', { x: c.x, y: c.y - (await rad('unsorted')) * k })
  await page.locator('[data-undo-unplace]').waitFor({ timeout: 10_000 })
  check('a placed dot dragged out to the unsorted ring is unplaced (ring = unsorted), Undo toast shown', (await ringOf('b1')) === 'unsorted')
  await page.locator('[data-undo-unplace]').click()
  await page.waitForTimeout(300)
  check('Undo restores the friend ring', (await ringOf('b1')) === 'friend')

  await dragTo('u1', { x: c.x, y: c.y - (await rad('close')) * k })
  await page.waitForTimeout(300)
  check('an unsorted dot dragged into a ring is placed as before', (await ringOf('u1')) === 'close')
  check('with nobody unsorted the fifth ring is gone again', (await ringsOf()) === 'close,friend,acquaintance,intending')

  await seed([P('a1', 'Anna Huber', 'close'), P('n1', 'Nora Leitner', 'none'), P('u1', 'Uli Mayr', 'unsorted')])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  check('ring "none" is drawn on the unsorted ring too', (await page.locator('.rings-wrap .node:not(.you)').count()) === 3 && (await bg('n1')) === 'rgb(158, 158, 158)')
  await dragTo('u1', { x: box.x + 3, y: box.y + 3 })
  await page.locator('[data-undo-hide]').waitFor({ timeout: 10_000 })
  check('dragging past the outer ring still hides', !(await record()).people.some((p) => p.id === 'u1'))

  // Round 2: only a confirmed ring places a dot; a suggested one is grey on the unsorted ring until a drop confirms it.
  await seed([P('f1', 'Franz Bauer', 'friend'), { ...P('s1', 'Sophie Wagner', 'acquaintance'), ringSuggested: true }, P('z1', 'Zita Pichler', undefined)])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  await page.addStyleTag({ content: '.demo-friends { position: fixed !important; top: auto !important; bottom: 0 !important; left: 0; right: 0; z-index: 99 }' })
  check('confirmed friend coloured, suggested acquaintance and ring-less person grey', (await bg('f1')) !== 'rgb(158, 158, 158)' && (await bg('s1')) === 'rgb(158, 158, 158)' && (await bg('z1')) === 'rgb(158, 158, 158)')
  await dragTo('s1', { x: c.x, y: c.y - (await rad('acquaintance')) * k })
  await page.locator('[data-undo-confirm]').waitFor({ timeout: 10_000 })
  const s1 = (await record()).people.find((p) => p.id === 's1')
  check('dropping a suggested dot on a ring confirms it (ringSuggested removed), dot turns coloured', s1.ring === 'acquaintance' && !('ringSuggested' in s1) && (await bg('s1')) !== 'rgb(158, 158, 158)')
  await page.locator('[data-undo-confirm]').click()
  await page.waitForTimeout(300)
  const s2 = (await record()).people.find((p) => p.id === 's1')
  check('Undo restores the suggestion: grey again', s2.ringSuggested === true && (await bg('s1')) === 'rgb(158, 158, 158)')
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
