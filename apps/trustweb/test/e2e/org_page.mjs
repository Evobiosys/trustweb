/** Wave 8 organizer page proof (headless): node org_stub.mjs & TW_BACKUP_PROXY=http://127.0.0.1:8961 TW_PORT=5222 scripts/tw_dev.sh --no-open; PORT=5222 SHOTS=<dir> node org_page.mjs */
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? 5222
const URL = `http://127.0.0.1:${PORT}/organizer.html`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(URL)
  await page.getByText('Create account').waitFor()
  await page.locator('input').first().fill('Forum Tirol')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByText('Keep this: it is the only key to your events.').waitFor()
  check('account created, key shown once, free-plan words', (await page.locator('.org').innerText()).includes('Free plan: 3 events, 25 invitees per event. Hosting and support: connect@japossert.com'))
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.org.v1')))
  check('account kept in trustweb.org.v1', !!stored.org && !!stored.secret && stored.name === 'Forum Tirol')

  const form = page.locator('section').nth(2)
  await form.locator('input').nth(0).fill('Herbsttreffen')
  await form.locator('input').nth(1).fill('2026-10-24T18:00')
  await form.locator('input').nth(3).fill('Innsbruck, Treibhaus')
  await form.locator('textarea').nth(1).fill('anna@example.at\nben@example.at\nclara@example.at')
  check('live counter', (await form.innerText()).includes('3 of 25'))
  await page.getByRole('button', { name: 'Create event' }).click()
  const card = page.locator('.card').first()
  await card.waitFor()
  const link = await card.locator('input').inputValue()
  check('link has #ev_host= and &srv=<16 hex>', link.includes('#ev_host=') && /&srv=[0-9a-f]{16}$/.test(link))
  check('counts 0', (await card.innerText()).includes('opened 0 · joined 0 · tagged 0'))
  const href = await card.getByText('Send to all').getAttribute('href')
  check('mailto bcc has the 3 addresses', ['anna%40example.at', 'ben%40example.at', 'clara%40example.at'].every((a) => href.includes(a)) && href.includes('?bcc='))

  const srv = link.split('&srv=')[1]
  await fetch('http://127.0.0.1:8961/org/hit', { method: 'POST', body: JSON.stringify({ event: srv, kind: 'opened' }) })
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.getByText('opened 1 · joined 0 · tagged 0').waitFor({ timeout: 3000 }).then(() => check('refresh after a hit: opened 1', true), () => check('refresh after a hit: opened 1', false))

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
  const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8')
  check('CSV text', csv === 'name,from,where,invitees,opened,joined,tagged\r\nHerbsttreffen,2026-10-24T18:00,"Innsbruck, Treibhaus",3,1,0,0\r\n')

  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/org-page-${PORT}.png`, fullPage: true })

  // Logo: a 1x1 PNG on the event, shown on the card and served by the public route (name + logo, no key).
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  await card.getByRole('button', { name: 'Edit' }).click()
  await form.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') })
  await form.locator('img.logo:not([hidden])').waitFor({ timeout: 3000 }).then(() => check('logo preview in the form', true), () => check('logo preview in the form', false))
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.locator('.card img.logo').first().waitFor({ timeout: 3000 }).then(() => check('logo on the event card', true), () => check('logo on the event card', false))
  const pubBody = await (await fetch(`http://127.0.0.1:8961/org/event/${srv}/public`)).json()
  check('public route: name and logo', pubBody.name === 'Herbsttreffen' && pubBody.logo === `data:image/png;base64,${PNG}`)
  await page.locator('.card').first().getByRole('button', { name: 'Edit' }).click()
  await form.locator('input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })
  await form.locator('.err').getByText('That logo does not fit').waitFor({ timeout: 3000 }).then(() => check('svg logo refused in words, old logo kept', true), () => check('svg logo refused in words, old logo kept', false))
  check('old logo still in the preview', (await form.locator('img.logo').getAttribute('src')) === `data:image/png;base64,${PNG}`)
  await page.getByRole('button', { name: 'Cancel edit' }).click()

  // Show my key, then sign in from a forgotten browser with the stored key line.
  const keyLine = JSON.stringify({ org: stored.org, secret: stored.secret })
  await page.reload(); await page.locator('.card').first().waitFor()
  check('key hidden after the first visit', !(await page.locator('.key').count()))
  await page.getByRole('button', { name: 'Show my key' }).click()
  check('"Show my key" reveals the key line', (await page.locator('.key').innerText()).trim() === keyLine)
  check('privacy line beside the key', (await page.locator('.org').innerText()).includes('Keep it private: whoever has it owns your events.'))
  await page.getByRole('button', { name: 'Forget this browser' }).click()
  await page.getByText('Sign in with my key').waitFor()
  check('forgotten: no card, nothing stored', !(await page.locator('.card').count()) && (await page.evaluate(() => localStorage.getItem('trustweb.org.v1'))) === null)
  const signIn = page.getByPlaceholder('paste the key you copied')
  await signIn.fill('not a key')
  await page.getByRole('button', { name: 'Sign in' }).click()
  check('bad key refused in words', (await page.locator('section').nth(1).innerText()).includes('That is not an organizer key. Paste the whole line that starts with {"org":'))
  await signIn.fill(`  ${keyLine}\n`)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.locator('.card').first().waitFor({ timeout: 3000 }).then(() => check('signed in: the card is back', true), () => check('signed in: the card is back', false))
  check('signed in: account name shown', (await page.locator('section').nth(1).innerText()).includes('Forum Tirol'))
  const back = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.org.v1')))
  check('signed in: key kept with the server name', back.org === stored.org && back.secret === stored.secret && back.name === 'Forum Tirol')

  await form.locator('input').nth(0).fill('Zu viele')
  await form.locator('textarea').nth(1).fill(Array.from({ length: 26 }, (_, i) => `p${i}@example.at`).join('\n'))
  await page.getByRole('button', { name: 'Create event' }).click()
  check('26 invitees: limit in words', (await form.locator('.err').innerText()).includes('25 invitees per event'))

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 812 } })).newPage()
  await phone.addInitScript((a) => localStorage.setItem('trustweb.org.v1', JSON.stringify(a)), stored)
  await phone.goto(URL); await phone.locator('.card').first().waitFor()
  check('phone: no sideways scroll', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  if (process.env.SHOTS) await phone.screenshot({ path: `${process.env.SHOTS}/org-page-${PORT}-phone.png`, fullPage: true })
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
