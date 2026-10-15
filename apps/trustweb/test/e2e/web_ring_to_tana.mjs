/** Wave 9 web-ring-to-tana proof (headless, dev only): PORT=5244 [SHOT=/path.png] node web_ring_to_tana.mjs. A real (non-demo) record with Tana on in the CRM prefs: a dot dragged to another ring queues the ring edit. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5244}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  page.on('console', (m) => { if (m.type() === 'warning') console.log('console.warn', m.text()) })
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ppl) => {
    localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] }))
    localStorage.setItem('trustweb-crm.v1.prefs', JSON.stringify({ pkms: ['tana'], autoSync: false }))
  }, [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'acquaintance'), P('u1', 'Clara Mayr', 'unsorted')])
  await page.reload(); await page.locator('.rings-wrap').waitFor()
  await page.addStyleTag({ content: '.demo-friends, .twf, .twf-ok { display: none !important }' })
  const box = await page.locator('.rings-wrap').boundingBox()
  const k = box.width / 352
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const rad = (r) => page.evaluate((x) => +document.querySelector(`.rings-wrap circle[data-ring="${x}"]`).getAttribute('r'), r)
  const centre = (id) => page.locator(`.rings-wrap [data-pid="${id}"]`).boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb-crm.v1.prefs')).queue ?? [])
  const ringOf = (id) => page.evaluate((i) => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.find((p) => p.id === i).ring, id)
  const dragTo = async (id, ring) => {
    const from = await centre(id), to = { x: c.x, y: c.y - (await rad(ring)) * k }
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up(); await page.waitForTimeout(1200)
  }
  check('queue empty before any drag', (await queue()).length === 0)
  await dragTo('a1', 'close')
  check('a1 dragged to close: record ring close', (await ringOf('a1')) === 'close')
  check('a1 queued as {personId, key tw-ring, approved}', (await queue()).some((q) => q.personId === 'a1' && q.key === 'tw-ring' && q.approved === true))
  await page.locator('[data-undo-unplace], [data-undo-confirm]').first().click({ timeout: 1500 }).catch(() => {})
  await dragTo('b1', 'unsorted')
  check('b1 dragged to unsorted: record ring unsorted, queued', (await ringOf('b1')) === 'unsorted' && (await queue()).some((q) => q.personId === 'b1' && q.key === 'tw-ring' && q.approved === true))
  check('exactly one queue entry per person (no double queue)', (await queue()).length === 2)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
