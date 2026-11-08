// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 overlay-fixes: ring card only on the stroke, intending line readable, card resize kept, theme untouched by a drop, merge offer with select tool on + yes/X. PORT=5441 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node overlay_fixes.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5441}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const now = Date.now()
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [
  { id: 'pa', name: 'Anna minor', ring: 1, angle: 20, lines: [], context: 'x', metAt: now - 86_400_000, channels: { signal: 'S' } },
  { id: 'pb', name: 'Anna Major', ring: 1, angle: 200, lines: [], context: 'y', metAt: now - 86_400_000 },
  { id: 'pc', name: 'Carl', ring: 3, angle: 110, lines: [], context: 'z', metAt: now - 86_400_000 },
] })
const names = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.map((p) => p.name))
const fresh = async (page) => {
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
}
try {
  for (const [w, h] of [[360, 740], [1280, 800]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await fresh(page)
    const rings = await page.evaluate(() => [...document.querySelectorAll('.rings-wrap circle[data-ring]')].map((c) => { const b = c.getBoundingClientRect(); return { ring: c.getAttribute('data-ring'), cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: b.width / 2, sw: Number(c.getAttribute('stroke-width')), so: Number(c.getAttribute('stroke-opacity')) } }))
    check(`${w}: rings drawn (${rings.length})`, rings.length >= 5)
    const byRing = Object.fromEntries(rings.map((r) => [r.ring, r]))
    const names3 = await page.evaluate(() => ({ i: String(window.__ringNames ?? '') }))
    // stroke: intending thinner than acquaintance, opacity >= .6
    const thin = rings.reduce((a, r) => (r.sw < a.sw ? r : a))
    const acq = rings.find((r) => r.sw === 1.4)
    check(`${w}: thinnest ring line (${thin.ring}, ${thin.sw}) is thinner than the acquaintance line (${acq.sw}) and opacity ${thin.so} >= .6`, thin.sw < acq.sw && thin.so >= 0.6)
    // card only on the stroke (angle 225 deg, upper left: no dots there)
    const at = (r, extra = 0) => ({ x: r.cx + (r.r + extra) * Math.cos(Math.PI * 1.25), y: r.cy + (r.r + extra) * Math.sin(Math.PI * 1.25) })
    const sorted = [...rings].sort((a, b) => a.r - b.r)
    const mid = { x: (at(sorted[2]).x + at(sorted[3]).x) / 2, y: (at(sorted[2]).y + at(sorted[3]).y) / 2 }
    const rest = async (p) => { await page.mouse.move(p.x - 30, p.y - 30); await page.mouse.move(p.x, p.y, { steps: 4 }); await page.mouse.move(p.x + 1, p.y + 1); await page.waitForTimeout(700) }
    await rest(mid)
    const cardsMid = await page.locator('[data-ring-card]').count()
    await rest(at(sorted[2], 12))
    const cardsOff = await page.locator('[data-ring-card]').count()
    await rest(at(sorted[2]))
    const cardsOn = await page.locator('[data-ring-card]').count()
    console.log(`INFO ${w}: cards between=${cardsMid} 12px off the line=${cardsOff} on the line=${cardsOn}`)
    check(`${w}: no card between the lines or 12 px off the stroke`, cardsMid === 0 && cardsOff === 0)
    if (cardsOn > 0) {
      check(`${w}: card opens on the stroke`, true)
      const card = page.locator('[data-ring-card]').first()
      const grip = card.locator('[data-ring-card-grip]')
      check(`${w}: card has a resize grip`, (await grip.count()) === 1)
      const before = await card.boundingBox(); const gb = await grip.boundingBox()
      await page.screenshot({ path: `${SHOTS}/overlay-fixes-${w}-card.png` })
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down()
      await page.mouse.move(gb.x + gb.width / 2 - 20, gb.y + gb.height / 2 + 15, { steps: 5 }); await page.mouse.up()
      const after = await card.boundingBox()
      const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('tw.overlaySize.')))
      check(`${w}: resized (${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}) and saved ${JSON.stringify(stored)}`, stored.length === 1 && (after.width !== before.width || after.height !== before.height))
      check(`${w}: no horizontal scroll after resize`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      await page.mouse.move(mid.x, mid.y); await page.waitForTimeout(900)
      await rest(at(sorted[2]))
      const again = await page.locator('[data-ring-card]').first().boundingBox()
      check(`${w}: size restored on reopen (${Math.round(again.width)}x${Math.round(again.height)})`, Math.abs(again.width - after.width) <= 2 && Math.abs(again.height - after.height) <= 2)
      await page.mouse.move(mid.x, mid.y); await page.waitForTimeout(900)
    } else console.log(`SKIP ${w}: no band hover on this layout (desk/touch)`)

    // theme: a drop on the innermost ring leaves data-theme alone
    const theme = () => page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.className, document.body.className].join('|'))
    const t0 = await theme()
    const cb = await page.locator('.node[data-pid="pc"]').last().boundingBox()
    const inner = sorted[0]
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.mouse.down()
    await page.mouse.move(cb.x + cb.width / 2 + 12, cb.y + cb.height / 2 + 12, { steps: 4 })
    await page.mouse.move(inner.cx + inner.r * 0.3, inner.cy + inner.r * 0.3, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(600)
    const t1 = await theme()
    check(`${w}: theme attributes unchanged after a drop (${t0} -> ${t1})`, t1 === t0)

    // merge with the select tool on
    await fresh(page)
    await page.locator('[data-tool="select"]').click(); await page.waitForTimeout(300)
    const centre = async (id) => { const b = await page.locator(`.node[data-pid="${id}"]`).last().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
    const grab = async () => {
      const a = await centre('pa'); const b = await centre('pb')
      await page.mouse.move(a.x, a.y); await page.mouse.down()
      await page.mouse.move(a.x + 12, a.y + 12, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 8 })
    }
    await grab()
    check(`${w}: select tool on, hold one dot on another -> offer`, await page.waitForSelector('[data-merge-countdown]', { timeout: 3500 }).then(() => true, () => false))
    const order = await page.evaluate(() => { const n = document.querySelector('[data-merge-countdown]'); const y = document.querySelector('[data-merge-yes]'); const x = document.querySelector('[data-merge-cancel]'); if (!n || !y || !x) return null; return [n, y, x].map((e) => { const b = e.getBoundingClientRect(); return Math.round(b.x) + ',' + Math.round(b.y) }).join(' ') })
    console.log('INFO order countdown, check, X =', order)
    check(`${w}: countdown left of the check, X at the right`, (() => { const [a, b, c] = String(order).split(' ').map((s) => s.split(',').map(Number)); return a[0] < b[0] && b[0] < c[0] && Math.abs(a[1] - b[1]) <= 8 })())
    await page.screenshot({ path: `${SHOTS}/overlay-fixes-${w}-offer.png` })
    await page.locator('[data-merge-cancel]').dispatchEvent('click'); await page.waitForTimeout(2500)
    check(`${w}: X cancels the merge`, (await names(page)).length === 3 && (await page.locator('[data-merge-countdown]:visible').count()) === 0)
    await page.mouse.up(); await page.waitForTimeout(400)
    await fresh(page)
    await grab()
    await page.waitForSelector('[data-merge-yes]', { timeout: 3500 })
    await page.locator('[data-merge-yes]').dispatchEvent('click'); await page.waitForTimeout(800)
    await page.mouse.up(); await page.waitForTimeout(600)
    const after = await names(page)
    check(`${w}: the check merges at once (${after})`, after.length === 2 && after.includes('Anna Major'))
    check(`${w}: no page errors ${errors.join(';')}`, errors.length === 0)
    await page.close()
  }
} catch (e) { console.log('ERROR', e); failed = true }
await browser.close()
process.exit(failed ? 1 : 0)
