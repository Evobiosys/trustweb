/** Wave 8 org-hits proof (headless, dev only): PORT=5224 node org_hits.mjs. EXE=<chromium headless shell> if the default is not installed. SHOT=<png>. */
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? 5224
const URL = `http://127.0.0.1:${PORT}/`
const SRV = '0123456789abcdef'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name) => ({ id, name, context: '', ring: 'none', metAt: 1, lines: [] })
const link = (id, srv) => `${URL}#ev_host=${Buffer.from(JSON.stringify({ kind: 'host', id, name: 'Forum Südtirol', from: '2026-10-12', where: 'Innsbruck', hosts: ['Anna Gruber'] })).toString('base64url')}${srv ? `&srv=${srv}` : ''}`
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  const errors = []
  const hits = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const hideOverlay = () => page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.route('**/org/hit', (r) => { hits.push(r.request().postData()); return r.fulfill({ status: 204 }) })
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [], log: [], events: [] })), [P('a1', 'Anna Huber'), P('b1', 'Ben Gruber')])

  await page.goto('about:blank'); await page.goto(link('e1', SRV)); await page.waitForTimeout(1500)
  await hideOverlay()
  check('opened fired once with event and kind only', hits.length === 1 && hits[0] === JSON.stringify({ event: SRV, kind: 'opened' }))
  check('counts line shown', (await page.locator('[data-org-counts-note]').count()) === 1)
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/org-hits-5224.png' })
  await page.locator('[data-event-join]').click(); await page.waitForTimeout(500)
  check('joined fired once', hits.length === 2 && hits[1] === JSON.stringify({ event: SRV, kind: 'joined' }))
  await page.locator('[data-tag-person="a1"]').click(); await page.waitForTimeout(300)
  check('first tag fires tagged', hits.length === 3 && hits[2] === JSON.stringify({ event: SRV, kind: 'tagged' }))
  await page.locator('[data-tag-person="b1"]').click(); await page.waitForTimeout(300)
  check('second tag fires nothing', hits.length === 3)

  hits.length = 0
  await page.goto('about:blank'); await page.goto(link('e2', null)); await page.waitForTimeout(1500)
  await hideOverlay()
  check('link without srv: no counts line', (await page.locator('[data-org-counts-note]').count()) === 0)
  await page.locator('[data-event-join]').click(); await page.waitForTimeout(500)
  await page.locator('[data-tag-person="a1"]').click(); await page.waitForTimeout(300)
  check('link without srv: nothing sent', hits.length === 0)
  check('no page errors', errors.length === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
