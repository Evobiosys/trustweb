// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 rings-column-dark proof (headless, dev only): PORT=5473 SHOTS=<dir> node rings_column.mjs (a stock dev server). EXE=<chromium headless shell>. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5473}/`
const SHOTS = process.env.SHOTS
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring, extra = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...extra })
const people = [
  ...Array.from({ length: 40 }, (_, i) => P('q' + i, 'Quinn ' + i, 'acquaintance', { angle: 150 + (i % 60) })), // crowd the 6 o'clock side on purpose
  P('k1', 'Karl', 'friend', { angle: 180 }), P('k2', 'Kim', 'close', { angle: 178 }), P('z1', 'Zoe', 'intending', { angle: 90, intending: { value: 5, since: 1 } }),
]
const contrast = (a, b) => {
  const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl) }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) for (const theme of ['light', 'dark']) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([ppl]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [], uiRings: { expandButtons: true } })), [people])
    await page.reload(); await page.locator('.rings-wrap').waitFor()
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    await page.addStyleTag({ content: '.demo-friends, .twf-ok { display: none !important }' })
    const tag = `${w}-${theme}`
    const wrap = page.locator('.rings-wrap')
    await wrap.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
    const geo = () => page.evaluate(() => {
      const wr = document.querySelector('.rings-wrap').getBoundingClientRect()
      const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left - wr.left, t: r.top - wr.top, r: r.right - wr.left, b: r.bottom - wr.top } }
      const ctl = [...document.querySelectorAll('.rings-wrap .ring-toggle, .rings-wrap .ring-more')].map(box)
      const col = { l: Math.min(...ctl.map((c) => c.l)), r: Math.max(...ctl.map((c) => c.r)), t: Math.min(...ctl.map((c) => c.t)), b: Math.max(...ctl.map((c) => c.b)) }
      const dots = [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => ({ ...box(n.querySelector('.ava')) }))
      return { col, dots, more: document.querySelectorAll('.rings-wrap [data-membrane-more]').length }
    })
    let g = await geo()
    const inside = g.dots.filter((d) => { const cx = (d.l + d.r) / 2, cy = (d.t + d.b) / 2; return cx >= g.col.l && cx <= g.col.r && cy >= g.col.t && cy <= g.col.b })
    check(`${tag}: no dot centre inside the column (${g.dots.length} dots)`, inside.length === 0)
    if (SHOTS) await wrap.screenshot({ path: `${SHOTS}/rings-column-dark-${tag}-column.png` })
    if (theme === 'light') {
      const more = page.locator('.rings-wrap [data-membrane-more="acquaintance"]')
      const count = () => page.locator('.rings-wrap .node:not(.you)').count()
      const cut = await count()
      check(`${tag}: acquaintance ⛶ shown`, (await more.count()) === 1)
      await more.click(); await page.waitForTimeout(400)
      const open = await count()
      check(`${tag}: first press expands (${cut} -> ${open})`, open > cut && (await page.locator('[data-membrane-more="acquaintance"][data-expanded="1"][aria-pressed="true"]').count()) === 1)
      g = await geo()
      check(`${tag}: expanded, still no dot centre inside the column`, !g.dots.some((d) => { const cx = (d.l + d.r) / 2, cy = (d.t + d.b) / 2; return cx >= g.col.l && cx <= g.col.r && cy >= g.col.t && cy <= g.col.b }))
      if (SHOTS) await wrap.screenshot({ path: `${SHOTS}/rings-column-dark-${tag}-expanded.png` })
      await page.locator('.rings-wrap [data-membrane-more="acquaintance"]').click(); await page.waitForTimeout(400)
      check(`${tag}: second press contracts (back to ${cut})`, (await count()) === cut && (await page.locator('[data-membrane-more="acquaintance"][aria-pressed="false"]').count()) === 1)
      if (SHOTS) await wrap.screenshot({ path: `${SHOTS}/rings-column-dark-${tag}-contracted.png` })
    } else {
      const ink = await page.evaluate(() => {
        const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number)
        const bg = rgb(getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)' ? 'rgb(28,27,23)' : getComputedStyle(document.body).backgroundColor)
        return [...document.querySelectorAll('.rings-wrap .node:not(.you) .ava.unconnected')].map((a) => ({ fg: rgb(getComputedStyle(a).color), bg }))
      })
      check(`${tag}: dashed initials present`, ink.length > 0)
      check(`${tag}: dashed initial contrast >= 4.5 against the screen`, ink.every((i) => contrast(i.fg, i.bg) >= 4.5))
      if (SHOTS) await wrap.screenshot({ path: `${SHOTS}/rings-column-dark-${tag}-initial.png` })
    }
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
