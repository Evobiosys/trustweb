/** Wave 8 rings-zoom (whole Web screen body) proof (headless, dev only): PORT=5316 W=1280 H=900 [SHOT=/path.png] node rings_zoom.mjs. EXE=<chromium headless shell> if the default is not installed. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5316}/`
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 900)
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage()
  const wrap = page.locator('.rings-wrap')
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })), [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'acquaintance')])
  await page.reload(); await wrap.waitFor()
  await page.addStyleTag({ content: '.demo-friends { position: fixed !important; top: auto !important; bottom: 0 !important; left: 0; right: 0; z-index: 99 } .twf, .twf-ok { display: none !important }' })
  const state = () => page.evaluate(() => ({ t: document.querySelector('.rings-zoom').style.transform, z: document.querySelector('.rings-wrap').dataset.ringsZoom, vv: window.visualViewport.scale }))
  const phoneBox = () => page.locator('.phone').boundingBox()
  const box = await wrap.boundingBox()
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // dispatches a wheel at the centre (or `at`) of the element `sel` ('body' = a corner of the phone); true when the page default was prevented
  const wheel = (sel, deltaY, ctrlKey, at) => page.evaluate(([q, d, ctrl, pt]) => {
    const t = document.querySelector(q === 'body' ? '.phone' : q)
    const r = t.getBoundingClientRect()
    const x = pt?.x ?? (q === 'body' ? 4 : r.left + r.width / 2), y = pt?.y ?? (q === 'body' ? 4 : r.top + r.height / 2)
    return !(q === 'body' ? document.body : t).dispatchEvent(new WheelEvent('wheel', { deltaY: d, ctrlKey: ctrl, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  }, [sel, deltaY, ctrlKey, at])
  // the tap target at k = 1: Anna's dot opens her card
  const tapOpens = async (pid) => { await page.locator(`.rings-wrap [data-pid="${pid}"]`).click(); await page.waitForTimeout(400); const t = await page.locator('.sheet').first().innerText().catch(() => ''); await page.locator('[data-sheet-home]').click(); await page.waitForTimeout(500); return t }
  const dot = await page.locator('.rings-wrap [data-pid="b1"]').boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  const first = await tapOpens('b1')
  const firstA = await tapOpens('a1')
  check('taps at k = 1 open two different cards', first.length > 0 && first !== firstA)
  const before = await phoneBox()
  check('plain wheel over the rings is not prevented, no zoom', !(await wheel('.rings-wrap', -300, false)) && (await state()).z === '1')
  check('ctrl+wheel outside the rings is not prevented, no zoom', !(await wheel('body', -300, true)) && (await state()).z === '1')
  check('ctrl+wheel over the app header is not prevented, no zoom', !(await wheel('.hdr', -300, true)) && (await state()).z === '1')
  check('ctrl+wheel over the tab bar is not prevented, no zoom', !(await wheel('.tabs', -300, true)) && (await state()).z === '1')
  const sc = await page.locator('.scroll').boundingBox()
  check('ctrl+wheel on empty Web body space (beside the rings) is prevented and zooms', (await wheel('.scroll', -70, true, { x: sc.x + 6, y: sc.y + 6 })) && +(await state()).z > 1)
  await page.mouse.dblclick(sc.x + 6, sc.y + 6); await page.waitForTimeout(500)
  check('dblclick on empty body space returns home', (await state()).z === '1')
  check('ctrl+wheel over the rings is prevented', await wheel('.rings-wrap', -70, true, dot))
  let s = await state()
  check('rings zoomed (scale > 1), ringsZoom > 1', /scale\((?:[2-9]|1\.\d)/.test(s.t) && +s.z > 1)
  check('visualViewport.scale 1', s.vv === 1)
  const after = await phoneBox()
  check('phone box unchanged', JSON.stringify(before) === JSON.stringify(after))
  s = await state()
  check('zoom around ~2', +s.z > 1.9 && +s.z < 2.1)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  const second = await tapOpens('b1')
  check('tap on the same dot at k > 1 opens the same person', second === first)
  await page.mouse.move(c.x + 60, c.y + 60); await page.mouse.down(); await page.mouse.move(c.x + 90, c.y + 90, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300)
  check('drag pans without opening the add sheet', (await state()).t.includes('translate') && (await page.locator('[data-add-person]').count()) === 0)
  await page.mouse.dblclick(c.x + 100, c.y + 100); await page.waitForTimeout(200)
  s = await state()
  check('dblclick returns home', s.t === '' && s.z === '1')
  await page.waitForTimeout(600)
  check('no add sheet after dblclick', (await page.locator('[data-add-person]').count()) === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
