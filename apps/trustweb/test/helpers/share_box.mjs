/**
 * Wave 6e: the Meet page's share row, Advanced panel and the ONE contact box (Signal, WhatsApp, Matrix), the way a person uses them.
 * Shared by the e2e suites that save a link or choose a mode. Modes: 'trustweb-signal' | 'trustweb-whatsapp' | 'trustweb-matrix' |
 * 'only-trustweb' | 'only-signal' | 'only-whatsapp'.
 */

/** Opens the Advanced panel (the arrow) when it is closed. */
export async function openAdvanced(page) {
  if (await page.locator('.advanced-panel').isHidden()) await page.locator('[data-act="advanced"]').click()
  await page.locator('.advanced-panel').waitFor({ state: 'visible', timeout: 10_000 })
}

/** Saves a link in the contact box of the Meet page (Advanced): 'signal' | 'whatsapp' | 'matrix'. Returns with the box redrawn. */
export async function saveChannel(page, channel, value) {
  await openAdvanced(page)
  const add = page.locator(`.advanced-panel [data-cb-add="${channel}"]`)
  if (await add.count()) await add.click()
  else await page.locator(`.advanced-panel [data-cb-edit="${channel}"]`).click()
  await page.locator(`.advanced-panel [data-cb-input="${channel}"]`).fill(value)
  await page.locator(`.advanced-panel [data-cb-save="${channel}"]`).click()
  await page.locator(`.advanced-panel [data-cb-value="${channel}"]`).waitFor({ timeout: 10_000 })
}

/** The same in Settings (the box there is the same module). */
export async function saveChannelInSettings(page, channel, value) {
  const add = page.locator(`.sheet.on [data-cb-add="${channel}"]`)
  if (await add.count()) await add.click()
  else await page.locator(`.sheet.on [data-cb-edit="${channel}"]`).click()
  await page.locator(`.sheet.on [data-cb-input="${channel}"]`).fill(value)
  await page.locator(`.sheet.on [data-cb-save="${channel}"]`).click()
  await page.locator(`.sheet.on [data-cb-value="${channel}"]`).waitFor({ timeout: 10_000 })
}

/** Chooses a mode in the Advanced list. */
export async function chooseMode(page, mode) {
  await openAdvanced(page)
  await page.locator(`.advanced-panel [data-mode="${mode}"]`).click()
}

/** The mode in force: the pressed button of the row, or the checked radio of the list (the row may not hold it). */
export async function currentMode(page) {
  return page.evaluate(() => {
    const on = document.querySelector('.advanced-panel [data-mode][aria-checked="true"]')
    return on ? on.getAttribute('data-mode') : null
  })
}

/** The modes on the two buttons of the Meet row, in order. */
export function rowModes(page) {
  return page.locator('[data-share-row] [data-mode]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-mode')))
}

export async function pin(page, mode) {
  await openAdvanced(page)
  await page.locator(`.advanced-panel [data-pin="${mode}"]`).click()
}
