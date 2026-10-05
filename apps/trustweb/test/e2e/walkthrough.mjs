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
    ok('one device by default', await page.locator('iframe').count() === 1)
    ok('no names above the phones, no "own phone" link', await page.locator('.phones .col h2').count() === 0 && await page.getByText('Use TrustWeb on your own phone').count() === 0)
    const restart = page.getByRole('button', { name: 'Start the demo over' })
    const rb = await restart.boundingBox()
    ok('"Start over" sits bottom left with a restart symbol', rb !== null && rb.x < 100 && rb.y > 800 && await restart.locator('svg').count() === 1)
    ok('the walkthrough and the live-phone steps are hidden behind "See it in action"',
      await toggle.isVisible() && await page.locator('.wt').count() === 0 && !(await page.getByText('Try it on the live phones below').isVisible()))
    await toggle.click()
    const title = () => page.locator('.wt-banner h3').innerText()
    ok('it opens with the "This happened now" banner', /This happened now/i.test(await page.locator('.wt-banner').innerText()))
    ok('it says it is scripted, not live', /scripted, not live/.test(await page.locator('.wt').innerText()))
    ok('the live-phone steps show with it', await page.getByText('Try it on the live phones below').isVisible())
    ok('2-person mode first: two titled devices', await page.locator('.wt-screen').count() === 2 && /Jonas's device/.test(await page.locator('.wt-devices').innerText()))
    ok('a milestone tick per step', await page.locator('.wt-tick').count() === 9)
    ok('the speed is written and editable (default 3 s)', (await page.getByLabel('Seconds per step').inputValue()) === '3')
    await page.getByLabel('Seconds per step').selectOption('2')
    const first = await title()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(2600)
    ok('play advances on its own at the chosen speed (2 s)', (await title()) !== first, await title())
    await page.getByRole('button', { name: 'Pause' }).click()
    const paused = await title()
    await page.waitForTimeout(3000)
    ok('pause holds the step', (await title()) === paused)
    await page.locator('.wt-tick').nth(5).click()
    ok('a tick jumps to its step', (await title()) === 'Maya\'s phone finds a match and asks her', await title())
    ok('the phone that changed is marked', await page.locator('.wt-screen.changed').count() === 1)
    await page.getByRole('button', { name: 'Next step' }).click()
    ok('next goes forward', (await title()) === 'Maya shares')
    await page.getByRole('button', { name: 'Previous step' }).click()
    ok('previous goes back', (await title()) === 'Maya\'s phone finds a match and asks her')
    await page.getByRole('tab', { name: '3 people' }).click()
    ok('3-person mode: Sam, Jonas, Maya', /Sam's device[\s\S]*Jonas's device[\s\S]*Maya's device/.test(await page.locator('.wt-devices').innerText()))
    await page.getByRole('tab', { name: '4 people' }).click()
    await page.locator('.wt-tick').nth(2).click()
    ok('4-person mode: nothing reaches Aisha, who has no app', /No TrustWeb app[\s\S]*Nothing reaches Aisha/.test(await page.locator('.wt-screen').nth(3).innerText()))
    ok('the strip lights the path Lena, Jonas, Maya', await page.locator('.wt-strip .nd.on').count() === 3 && await page.locator('.wt-strip .ln.on').count() === 2)
    ok('two-hop honesty note shows', /do one hop today/.test(await page.locator('.wt-note').innerText()))
    // "Add a device" adds Jonas, then Sam, then Lena (four at most)
    for (let k = 0; k < 3; k++) await page.getByRole('button', { name: /Add a device/ }).click()
    ok('add a device, three times: four devices', await page.locator('.phones .col').count() === 4)
    ok('then the add button says it is full', await page.getByRole('button', { name: /4 devices, the most for now/ }).isDisabled())
    if (SHOT) await page.locator('.action-slot').screenshot({ path: SHOT })
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser.close()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nwalkthrough: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
