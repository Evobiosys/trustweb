/**
 * Wave 6e (E2, slice S2): the names block in Meet > Advanced > "Your username", against a MOCK of the services API (fake_connect_server.mjs,
 * contract 10.9: READ, claim primary / alias, release, reserved, locked, names granted by the operator). The real service is wired by the
 * orchestrator after the merge. Headless phones, the app on an https origin (TLS front), the connect service stubbed in the browser.
 *   1  the names the operator granted (japossert, jakob as an alias) show when Meet opens, with a lock mark, no field and no Release;
 *      the record keeps them; a refused attempt never says "ask Jakob"
 *   2  a phone claims a main name and one more name, releases the second, then the main one; /who works for both while held
 *   3  the plain words: reserved, taken (and a name cleared by the phone is released again)
 *   4  an older answer without `locked`: the phone learns the lock from the 409 name_locked (copy, lock mark, Release gone)
 *   5  a name typed in the field survives an answer from the server
 * Ports: Vite 8972, TLS front 8973.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8972 ../../node_modules/.bin/tsx ../trustweb/test/e2e/names_flow.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'
import { openAdvanced } from '../helpers/share_box.mjs'

const PORT = Number(process.env.TW_PORT || 8972)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')
const status = (page) => page.locator('[data-username-status]').innerText()

async function newPhone(browser, server) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await server.install(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return { ctx, page }
}

async function startPhone(page, name) {
  await page.goto(ORIGIN + '/')
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

/** A phone with an account and a code the (stubbed) server holds; Meet stays open. */
async function phoneWithCode(browser, server, name) {
  const p = await newPhone(browser, server)
  await startPhone(p.page, name)
  await p.page.locator('.hdr [aria-label^="Show my code"]').click()
  const code = await until(async () => {
    const rec = (await record(p.page)).connectCode
    return rec && (await payload(p.page)) === `${ORIGIN}/c/${rec.code}` ? rec.code : null
  }, 15_000)
  return { ...p, code }
}

const nameBlock = (page) => page.locator('.advanced-panel [data-names]')

async function main() {
  const app = await startApp(PORT)
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch(front.browserArgs)
    console.log(`names_flow: app ${app.base}, https front ${front.origin} -> :${HTTPS_PORT}`)
    const server = fakeConnectServer(ORIGIN)

    // 1 names granted by the operator
    const ada = await phoneWithCode(browser, server, 'Ada')
    t.ok('setup: Ada has a code on the (stubbed) server', !!ada.code)
    server.grant(ada.code, 'japossert')
    server.grant(ada.code, 'jakob', { alias: true })
    await ada.page.reload()
    await ada.page.locator('.hdr [aria-label^="Show my code"]').click()
    await openAdvanced(ada.page)
    const seen = await until(async () => /japossert/.test(await nameBlock(ada.page).innerText()) ? true : null, 15_000)
    t.ok('1: Meet asked the server (READ) and shows the granted main name japossert', !!seen && server.posts.some((p) => p.path === '/name' && p.body.name === undefined && p.body.release === undefined))
    const text = await nameBlock(ada.page).innerText()
    t.ok('1: and the granted alias jakob', /jakob/.test(text))
    t.ok('1: both carry the lock mark', (await nameBlock(ada.page).locator('[data-locked]').count()) === 2 && /Reserved for you/.test(text), text)
    t.ok('1: a locked name has no field and no Release button', (await nameBlock(ada.page).locator('[data-act="release-name"]:visible, [data-act="release-alias"]:visible, [data-act="release-extra"]:visible').count()) === 0
      && (await nameBlock(ada.page).locator('input:visible').count()) === 0)
    const rec = (await record(ada.page)).connectCode
    t.ok('1: the record keeps the names and which are locked', rec.name === 'japossert' && JSON.stringify(rec.aliases) === JSON.stringify(['jakob']) && JSON.stringify(rec.lockedNames) === JSON.stringify(['japossert', 'jakob']), JSON.stringify(rec))
    t.ok('1: no copy anywhere says "ask Jakob"', !/ask jakob/i.test(await ada.page.locator('body').innerText()))
    await shot(ada.page, 'e2-names-01-granted.png')
    // the code itself keeps working after a registration update (a new name of the phone) and does not lose the names
    t.ok('1: the QR is still the code', (await payload(ada.page)) === `${ORIGIN}/c/${ada.code}`)

    // 2 a phone claims, adds, releases
    const cy = await phoneWithCode(browser, server, 'Cy Coder')
    await openAdvanced(cy.page)
    await cy.page.locator('[data-names]').waitFor({ timeout: 15_000 })
    await cy.page.locator('[data-username]').fill('@Cyril')
    await cy.page.locator('[data-act="claim-name"]').click()
    t.ok('2: Cy claims the main name (typed with a capital and an @): "@cyril is yours"', !!(await until(async () => /@cyril is yours/.test(await status(cy.page)) ? true : null)) && server.names.get('cyril') === cy.code)
    await cy.page.locator('[data-alias]').fill('cy.two')
    await cy.page.locator('[data-act="claim-alias"]').click()
    t.ok('2: and one more name (an alias)', !!(await until(async () => server.names.get('cy.two') === cy.code && /@cy\.two is yours/.test(await status(cy.page)) ? true : null)), await status(cy.page))
    await until(async () => (await record(cy.page)).connectCode.aliases ? true : null)
    const rec2 = (await record(cy.page)).connectCode
    t.ok('2: the record keeps main and alias', rec2.name === 'cyril' && JSON.stringify(rec2.aliases) === JSON.stringify(['cy.two']), JSON.stringify(rec2))
    t.ok('2: the alias slot now shows the held name with Release only (a name is added, never silently replaced)', (await cy.page.locator('[data-alias]:visible').count()) === 0 && (await cy.page.locator('[data-act="release-alias"]:visible').count()) === 1)
    await shot(cy.page, 'e2-names-02-two-names.png')
    await cy.page.locator('[data-act="release-alias"]').click()
    t.ok('2: Release frees the alias', !!(await until(async () => !server.names.has('cy.two') && (await record(cy.page)).connectCode.aliases === undefined ? true : null)))
    await cy.page.locator('[data-act="release-name"]').click()
    t.ok('2: Release frees the main name', !!(await until(async () => !server.names.has('cyril') && (await record(cy.page)).connectCode.name === undefined ? true : null)))

    // 3 plain words
    server.reserved.add('admin')
    await cy.page.locator('[data-username]').fill('admin')
    await cy.page.locator('[data-act="claim-name"]').click()
    t.ok('3: a reserved name says "This name is reserved."', !!(await until(async () => /^This name is reserved\.$/.test(await status(cy.page)) ? true : null)))
    await cy.page.locator('[data-username]').fill('Ja.Kob')
    await cy.page.locator('[data-act="claim-name"]').click()
    t.ok('3: a name granted to somebody else (squashed form of jakob) is "reserved" too, never "taken"', !!(await until(async () => /This name is reserved\./.test(await status(cy.page)) ? true : null)))
    await cy.page.locator('[data-username]').fill('cyril')
    await cy.page.locator('[data-act="claim-name"]').click()
    await until(async () => server.names.has('cyril') ? true : null)
    const dee = await phoneWithCode(browser, server, 'Dee')
    await openAdvanced(dee.page)
    await dee.page.locator('[data-names]').waitFor({ timeout: 15_000 })
    await dee.page.locator('[data-username]').fill('cyril')
    await dee.page.locator('[data-act="claim-name"]').click()
    t.ok('3: a name another code holds says "That name is taken."', !!(await until(async () => /^That name is taken\.$/.test(await status(dee.page)) ? true : null)))
    await dee.page.locator('[data-username]').fill('ab')
    await dee.page.locator('[data-act="claim-name"]').click()
    t.ok('3: a name with a bad shape never reaches the server (the words say what is expected)', /3 to 30 letters/.test(await status(dee.page)) && !server.posts.some((p) => p.body.name === 'ab'))
    await shot(dee.page, 'e2-names-03-taken.png')

    // 4 an older answer without `locked`: the lock is learned from the refusal
    server.answerLocked = false
    const eve = await phoneWithCode(browser, server, 'Eve')
    server.grant(eve.code, 'evelyn')
    await eve.page.getByRole('button', { name: 'Back' }).click()
    await eve.page.locator('.hdr [aria-label^="Show my code"]').click()
    await openAdvanced(eve.page)
    await until(async () => /evelyn/.test(await nameBlock(eve.page).innerText()) ? true : null, 15_000)
    t.ok('4: without a lock flag in the answer the name shows with a Release button', (await eve.page.locator('[data-act="release-name"]:visible').count()) === 1 && (await nameBlock(eve.page).locator('[data-locked]').count()) === 0)
    await eve.page.locator('[data-act="release-name"]').click()
    t.ok('4: releasing it says it is reserved for her and stays', !!(await until(async () => /This name is reserved for you and stays; ask to change it\./.test(await status(eve.page)) ? true : null)))
    t.ok('4: the name is still hers, now marked locked, and Release is gone', server.names.get('evelyn') === eve.code && (await nameBlock(eve.page).locator('[data-locked]').count()) === 1 && (await eve.page.locator('[data-act="release-name"]:visible').count()) === 0)
    t.ok('4: the record remembers the lock', JSON.stringify((await record(eve.page)).connectCode.lockedNames) === JSON.stringify(['evelyn']))
    server.answerLocked = true

    // 5 typed text survives an answer
    await dee.page.locator('[data-username]').fill('dee-the-one')
    await dee.page.locator('[data-alias]').fill('dee.2')
    await dee.page.locator('[data-act="claim-alias"]').click()
    // an alias claimed with no main name becomes the main name (contract 10.9)
    t.ok('5: an alias claimed with no main name becomes the main name', !!(await until(async () => (await record(dee.page)).connectCode.name === 'dee.2' ? true : null)))
    t.ok('5: the main field still holds what was typed there (an answer never clears a field in use)', (await dee.page.locator('[data-username]').inputValue()) === 'dee-the-one')
  } finally {
    await browser?.close()
    await front?.stop?.()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures ? `\nNAMES FLOW: ${t.failures} FAILED` : '\nNAMES FLOW: ALL PASS')
  process.exit(t.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
