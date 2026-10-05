/**
 * "See it in action" on the multi-phone demo page: hidden until asked for,
 * four phones side by side, a "This happened now" banner, play / pause that
 * advances on its own, milestone ticks you can jump to, and prev / next.
 *
 * Runs against TW_URL (default the local preview http://127.0.0.1:5190/).
 * Run from apps/demo/:
 *   PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/walkthrough.mjs
 */
const BASE = process.env.TW_URL || 'http://127.0.0.1:5190/'
const SHOT = process.env.TW_SHOT

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function main() {
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  const browser = await engine.launch({ headless: true })
  try {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 } })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + 'demo/')
    const toggle = page.getByRole('button', { name: 'See it in action' })
    ok('the walkthrough is hidden behind "See it in action"', await toggle.isVisible() && await page.locator('.wt').count() === 0)
    await toggle.click()
    const title = () => page.locator('.wt-banner h3').innerText()
    ok('it opens with the "This happened now" banner', /This happened now/i.test(await page.locator('.wt-banner').innerText()))
    ok('four phones side by side', await page.locator('.wt-screen').count() === 4)
    ok('a milestone tick per step', await page.locator('.wt-tick').count() === 9)
    const first = await title()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(5800)
    ok('play advances to the next step on its own', (await title()) !== first, await title())
    await page.getByRole('button', { name: 'Pause' }).click()
    const paused = await title()
    await page.waitForTimeout(5800)
    ok('pause holds the step', (await title()) === paused)
    await page.locator('.wt-tick').nth(5).click()
    ok('a tick jumps to its step', (await title()) === 'Each phone checks privately', await title())
    ok('the phones that changed are marked', await page.locator('.wt-screen.changed').count() === 2)
    await page.locator('.wt-tick').nth(4).click()
    ok('at the ask, Lena\'s phone shows that nothing reaches her', /Nothing reaches Lena/.test(await page.locator('.wt-screen').nth(3).innerText()))
    await page.locator('.wt-tick').nth(5).click()
    await page.getByRole('button', { name: 'Next step' }).click()
    ok('next goes forward', (await title()) === 'Maya chooses to share')
    await page.getByRole('button', { name: 'Previous step' }).click()
    ok('previous goes back', (await title()) === 'Each phone checks privately')
    if (SHOT) await page.locator('.action').screenshot({ path: SHOT })
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser.close()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nwalkthrough: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
