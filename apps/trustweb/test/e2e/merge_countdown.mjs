// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 merge-countdown: hold dot a over dot b -> 3,2,1 -> merged, b's name survives; moving away at 2 -> no merge. PORT=5461 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node merge_countdown.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const now = Date.now()
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [
  { id: 'pa', name: 'Anna minor', ring: 1, angle: 20, lines: [], context: 'x', metAt: now - 86_400_000, channels: { signal: 'S' } },
  { id: 'pb', name: 'Anna Major', ring: 1, angle: 200, lines: [], context: 'y', metAt: now - 86_400_000 },
] })
const names = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.map((p) => p.name))
try {
  for (const [w, h] of [[360, 740], [1280, 800]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const centre = async (id) => { const b = await page.locator(`.node[data-pid="${id}"]`).last().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
    let home
    const grab = async () => {
      const a = await centre('pa'); const b = await centre('pb'); home = a
      await page.mouse.move(a.x, a.y); await page.mouse.down()
      await page.mouse.move(a.x + 12, a.y + 12, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 8 })
      return b
    }
    // cancel: leave b at 2
    const b = await grab()
    await page.waitForSelector('[data-merge-countdown="3"]', { timeout: 3000 })
    await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/merge-countdown-${w}-3.png` })
    await page.waitForSelector('[data-merge-countdown="2"]', { timeout: 3000 })
    await page.mouse.move(home.x, home.y, { steps: 6 })
    await page.waitForTimeout(1500)
    check(`${w}: move away at 2 -> no merge`, (await names(page)).length === 2 && (await page.locator('[data-merge-countdown]:visible').count()) === 0)
    await page.mouse.up(); await page.waitForTimeout(400)
    // Escape cancels
    await grab()
    await page.waitForSelector('[data-merge-countdown="3"]', { timeout: 3000 })
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200)
    check(`${w}: Escape -> no merge`, (await names(page)).length === 2)
    await page.mouse.up(); await page.waitForTimeout(400)
    // stay: merge (fresh seed: the cancelled drops may have stacked the dots)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    await grab()
    await page.waitForSelector('[data-merge-countdown="3"]', { timeout: 3000 })
    await page.waitForSelector('[data-merge-countdown="1"]', { timeout: 4000 })
    await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/merge-countdown-${w}-1.png` })
    await page.waitForTimeout(2200)
    await page.mouse.up(); await page.waitForTimeout(800)
    const after = await names(page)
    check(`${w}: staying merges, survivor is b`, after.length === 1 && after[0] === 'Anna Major')
    await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/merge-countdown-${w}-after.png` })
    check(`${w}: no page errors`, errors.length === 0)
    await page.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
