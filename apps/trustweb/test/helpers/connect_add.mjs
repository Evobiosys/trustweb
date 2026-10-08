/**
 * Wave 6b: a personal account that opens someone's connect link (a scan) now lands on the add sheet (connect_add_view.ts) and then on
 * the person's card, instead of being added silently. Suites that connect two real phones call this right after the join to take that
 * step the way a person does, and carry on from the Web screen.
 */

/** Waits for the add sheet, optionally picks a ring, presses "Add to my web", and closes the card that opens. Returns the card's text. */
export async function acceptAdd(page, { ring, keepCard = false } = {}) {
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })
  if (ring) await page.locator(`.sheet.on [data-ring="${ring}"]`).click()
  await page.locator('.sheet.on [data-connect-add]').click()
  const card = page.locator('.sheet.on')
  await card.waitFor({ timeout: 10_000 })
  const text = await card.innerText()
  if (!keepCard) await page.locator('.sheet.on .sheet-home').click()
  return text
}
