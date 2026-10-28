/**
 * Wave 6g: the person-facing name of the tab is "Resources" (Jakob 2026-10-08; "My" dropped 2026-10-28).
 * Only the words changed: the code identifiers, record keys and the file name
 * trustweb-inventory-import.json stay as they were.
 */
import { readFileSync } from 'node:fs'
import { S } from '../../src/strings.ts'

describe('My Resources wording', () => {
  it('the bottom tab reads Resources', () => {
    expect(S.navInventory).toBe('Resources')
  })

  it('the screen and its sheets carry the same name', () => {
    expect(S.invTitle).toBe('Resources')
    expect(S.impGroup).toBe('Resources')
    expect(S.placeWhatSave).toBe('Save to Resources')
    expect(S.reqTitle).toBe('Requests to Resources')
  })

  it('no plain string a person reads says "inventory" (only the import file name may)', () => {
    const offenders = Object.entries(S)
      .filter((e) => typeof e[1] === 'string')
      .filter((e) => /inventory/i.test(String(e[1]).replace('trustweb-inventory-import.json', '')))
      .map((e) => e[0])
    expect(offenders).toEqual([])
  })

  it('no string says "My Resources" any more', () => {
    expect(readFileSync(new URL('../../src/strings.ts', import.meta.url), 'utf8')).not.toMatch(/My Resources/)
  })

  it('the text functions do not say "inventory" either', () => {
    const lines = [S.savedWhatToast(1), S.savedWhatToast(3)]
    for (const l of lines) expect(l).not.toMatch(/inventory/i)
  })
})
