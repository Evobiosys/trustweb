/**
 * Wave 6g: the person-facing name of the third tab is "My Resources" (Jakob, 2026-10-08).
 * Only the words changed: the code identifiers, record keys and the file name
 * trustweb-inventory-import.json stay as they were.
 */
import { S } from '../../src/strings.ts'

describe('My Resources wording', () => {
  it('the bottom tab reads My Resources', () => {
    expect(S.navInventory).toBe('My Resources')
  })

  it('the screen and its sheets carry the same name', () => {
    expect(S.invTitle).toBe('My Resources')
    expect(S.impGroup).toBe('My Resources')
    expect(S.placeWhatSave).toBe('Save to My Resources')
    expect(S.reqTitle).toBe('Requests to My Resources')
  })

  it('no plain string a person reads says "inventory" (only the import file name may)', () => {
    const offenders = Object.entries(S)
      .filter((e) => typeof e[1] === 'string')
      .filter((e) => /inventory/i.test(String(e[1]).replace('trustweb-inventory-import.json', '')))
      .map((e) => e[0])
    expect(offenders).toEqual([])
  })

  it('the text functions do not say "inventory" either', () => {
    const lines = [S.savedWhatToast(1), S.savedWhatToast(3)]
    for (const l of lines) expect(l).not.toMatch(/inventory/i)
  })
})
