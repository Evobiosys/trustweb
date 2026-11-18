// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c chat-notices proof (headless, stock data): PORT=5453 SHOTS=<dir> EXE=<chromium> node chat_notices.mjs. Chat at 1280 and 360, the one notice layer with Tools open. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5453}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + extra}`); if (!cond) failed = true }
const T0 = 1_800_000_000_000
const msgs = Array.from({ length: 20 }, (_, i) => ({ key: 'k' + i, dir: i % 3 ? 'in' : 'out', text: `Message ${i} ` + 'word '.repeat((i % 7) * 6), at: T0 + i * 60_000, sentAt: T0 + i * 60_000, state: i % 3 ? 'received' : 'delivered' }))
const record = () => ({
  v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], chats: { x1: { messages: msgs, unread: 0 } },
  // two cards of one person (same peerId), as a device sync leaves them
  people: [{ id: 'p1', name: 'Ana', ring: 1, lines: [], context: '', peerId: 'x1' }, { id: 'p1b', name: 'Ana', ring: 1, lines: [], context: '', peerId: 'x1' }, { id: 'p2', name: 'Ben', ring: 1, lines: [], context: '' }],
  wantsToConnect: [{ peerId: 'w1', name: 'Cecilia', at: Date.now() }],
  unmatchedAsks: [{ id: 'u1', at: Date.now(), peerId: 'x1', from: 'Ana', text: 'Does anyone know a very long question that wraps over several lines in the card?', reason: 'nothing' }],
})
const open = async (w, h) => {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), record())
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
  return { page, errors }
}
const box = (page, sel) => page.locator(sel).first().boundingBox()
const inside = (b, f) => !!b && b.x >= f.x - 0.5 && b.y >= f.y - 0.5 && b.x + b.width <= f.x + f.width + 0.5 && b.y + b.height <= f.y + f.height + 0.5

try {
  for (const [w, h, ratio] of [[1280, 900, 0.72], [360, 780, 0.86]]) {
    const { page, errors } = await open(w, h)
    await page.locator('nav.tabs button', { hasText: 'Chat' }).click(); await page.waitForTimeout(400)
    check(`${w}: one chat row for the person with two cards`, (await page.locator('[data-chat-row]').count()) === 1)
    await page.locator('[data-chat-row]').first().click(); await page.waitForTimeout(700)
    const m = await page.evaluate(() => {
      const t = document.querySelector('.chat-thread').getBoundingClientRect()
      const bubbles = [...document.querySelectorAll('.chat-msg')]
      const c = document.querySelector('.chat-composer').getBoundingClientRect()
      const last = bubbles[bubbles.length - 1].getBoundingClientRect()
      const own = document.querySelector('.chat-out').getBoundingClientRect(); const their = document.querySelector('.chat-in').getBoundingClientRect()
      return { n: bubbles.length, max: Math.max(...bubbles.map((b) => b.getBoundingClientRect().width / t.width)), cBottom: c.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        lastVisible: last.bottom <= t.bottom + 1, ownRight: own.right > t.left + t.width / 2, theirLeft: their.left < t.left + t.width / 2 }
    })
    check(`${w}: 20 messages shown, widest bubble <= ${ratio * 100} % (+2 px thread padding)`, m.n === 20 && m.max <= ratio + 0.01, JSON.stringify(m))
    check(`${w}: no horizontal scroll`, m.sw <= m.cw, JSON.stringify(m))
    check(`${w}: composer inside the viewport`, m.cBottom <= m.vh, JSON.stringify(m))
    check(`${w}: own right, others left, newest in view`, m.ownRight && m.theirLeft && m.lastVisible, JSON.stringify(m))
    check(`${w}: Signal hint hidden below 400 characters`, (await page.locator('[data-chat=long-hint]').textContent()) === '')
    await page.locator('.chat-composer textarea').fill('x'.repeat(400))
    check(`${w}: Signal hint shows at 400`, (await page.locator('[data-chat=long-hint]').textContent()) !== '')
    await page.screenshot({ path: `${SHOTS}/chat-notices-chat-${w}.png` })
    check(`${w}: no page errors`, errors.length === 0, errors.join('|'))
    await page.context().close()
  }
  for (const [w, h] of [[1280, 900], [360, 780]]) {
    const { page, errors } = await open(w, h)
    await page.locator('summary, button, .linkbtn', { hasText: /^\s*Tools\s*$/ }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
    const wants = await box(page, '#notice-layer [data-wants-to-connect]')
    check(`${w}: "Wants to connect" is in the layer and inside the frame`, inside(wants, await box(page, '.phone')), JSON.stringify(wants))
    // a toast: archive nothing; a connect toast comes from the app's own toast() through the harness-free route: the Dismiss on a want
    await page.locator('[data-want-dismiss]').first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
    const f = await box(page, '.phone')
    const layer = await box(page, '#notice-layer')
    const tabs = await box(page, 'nav.tabs')
    check(`${w}: the notice layer sits inside the phone frame`, inside(layer, f), JSON.stringify({ layer, f }))
    check(`${w}: the notice layer leaves the bottom bar free (P06)`, !layer || !tabs || layer.y + layer.height <= tabs.y + 1, JSON.stringify({ layer, tabs }))
    const kinds = await page.evaluate(() => [...document.querySelectorAll('#notice-layer>[data-notice-kind]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getAttribute('data-notice-kind')))
    check(`${w}: the ask-result card is a child of the layer, not of the zoomed rings`, (await page.locator('.rings-zoom [data-card-stack]').count()) === 0 && kinds.includes('cards'), JSON.stringify(kinds))
    for (const sel of ['[data-card-stack]', '.toast.on']) {
      const b = await box(page, sel)
      if (b) check(`${w}: ${sel} inside the frame`, inside(b, f), JSON.stringify({ b, f }))
    }
    await page.screenshot({ path: `${SHOTS}/chat-notices-layer-${w}.png` })
    check(`${w}: no page errors (layer)`, errors.length === 0, errors.join('|'))
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
