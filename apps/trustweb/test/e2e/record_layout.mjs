/**
 * Record layout (wave 5, item e): the X / send bar sits under the scrolling area, so nothing scrolls beneath it
 * (no fade over a faded "OPPORTUNITY" label), the last line (the Past meetings link) stays clear of it, and
 * opening Advanced never moves the phone itself (the closed sheet overflows it; overflow:clip stops the shift).
 * Checked at 360x640 and 390x844, Advanced closed and open, scrolled to the end. SHOTS=<dir> also saves screenshots.
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8984 ../../node_modules/.bin/tsx ../trustweb/test/e2e/record_layout.mjs
 */
import { launch, startApp, startPhone, tally } from '../helpers/e2e_harness.mjs'

const t = tally()
const SIZES = [[360, 640], [390, 844]]

async function seedMeetings(page) {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('trustweb.v1.'))
    const s = JSON.parse(localStorage.getItem(key))
    s.meetings = Array.from({ length: 7 }, (_, i) => ({ id: 'm' + i, about: 'Person ' + i, kind: 'who', where: '', startedAt: Date.now() - i * 1e6, endedAt: Date.now() - i * 1e6 + 6e4, durationMs: 6e4, meeting: false, lines: [], transcript: [] }))
    localStorage.setItem(key, JSON.stringify(s))
  })
  await page.reload()
  await page.locator('nav.tabs').waitFor()
}

async function geometry(page) {
  return page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? { top: b.top, bottom: b.bottom } : null }
    const scroller = document.querySelector('.screen .scroll')
    return { link: r('.past-link'), controls: r('.memo-controls'), tabs: r('nav.tabs'), scrollerBottom: scroller.getBoundingClientRect().bottom, phoneScroll: document.querySelector('.phone').scrollTop }
  })
}

async function main() {
  const app = await startApp(Number(process.env.TW_PORT || 8984))
  const browser = await launch()
  try {
    for (const [w, h] of SIZES) {
      for (const advanced of [false, true]) {
        const label = `${w}x${h}, Advanced ${advanced ? 'open' : 'closed'}`
        const ctx = await browser.newContext({ viewport: { width: w, height: h } })
        const page = await ctx.newPage()
        page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
        await startPhone(page, app.base)
        await seedMeetings(page)
        await page.locator('nav.tabs .tab-record').click()
        if (advanced) await page.locator('.adv-toggle').click()
        await page.evaluate(() => { const s = document.querySelector('.screen .scroll'); s.scrollTop = s.scrollHeight })
        await page.waitForTimeout(250)
        const g = await geometry(page)
        t.ok(`${label}: the phone itself never scrolls`, g.phoneScroll === 0, String(g.phoneScroll))
        t.ok(`${label}: the scrolling area ends where the bar begins`, Math.abs(g.scrollerBottom - g.controls.top) < 1, JSON.stringify(g))
        t.ok(`${label}: the Past meetings link is clear of the X / send bar`, g.link.bottom <= g.controls.top, JSON.stringify(g))
        t.ok(`${label}: the bar sits above the tab bar`, g.controls.bottom <= g.tabs.top + 1, JSON.stringify(g))
        if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/after_${w}x${h}_adv-${advanced ? 'open' : 'closed'}.png` })
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
    await app.stop()
  }
  console.log(t.failures ? `\n${t.failures} FAILED` : '\nALL PASS')
  process.exit(t.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
