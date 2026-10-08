/**
 * "Is this safe?" (src/reassurance.ts, strings.ts S.safe*, wave 6e): the canonical sentences (the website uses the same), no em dashes,
 * the first-time-only link, and the GitHub sentence ABSENT in a build made without VITE_TW_CODE_PUBLIC=1 (the dist scan is
 * test/scan_bundle_for_code_line.mjs; this checks the source side).
 */
import { SafetyPlace, markFirstTimeShown, offerFirstTime, safetyLines } from '../../src/reassurance.ts'
import { S } from '../../src/strings.ts'

const CANON = [
  'TrustWeb is a web app. It runs in your browser or from your home screen, and you can remove it any time in Settings.',
  'Your contacts and notes stay on this phone. Nothing about them leaves the phone without your yes.',
  'Showing your own code to others registers a short address for it on our server (your name and the contact links you chose to share). Nothing else is sent unless you share it.',
  'The person who shared this code with you shared only their contact links, for example Signal or WhatsApp. You can also use those links outside this app.',
  'If you do not want TrustWeb, just leave it, or remove it in Settings. The Signal or WhatsApp link still works on its own.',
]

describe('the sheet', () => {
  it('the title and the five canonical sentences, in order', () => {
    expect(S.safeTitle).toBe('Is this safe?')
    expect(safetyLines()).toEqual(CANON)
  })
  it('no em dash and no en dash in any of them', () => {
    for (const line of [S.safeTitle, ...safetyLines(), S.safeCodePublic]) expect(/[–—]/.test(line), line).toBe(false)
  })
  it('the open-source sentence is ABSENT by default (no VITE_TW_CODE_PUBLIC): not a line, not in the table, whatever is asked', () => {
    expect(S.safeCodePublic).toBe('')
    expect(safetyLines(true)).toEqual(CANON)
    expect(safetyLines(false)).toEqual(CANON)
    expect(safetyLines().join(' ')).not.toMatch(/GitHub|open source/i)
  })
  it('the three places are named', () => expect(Object.values(SafetyPlace)).toEqual(['add-sheet', 'person-card', 'settings']))
})

describe('first time only', () => {
  it('offered until it was shown once, then never again', () => {
    const s = {}
    expect(offerFirstTime(s)).toBe(true)
    expect(markFirstTimeShown(s, 1234)).toBe(true)
    expect(s.safetyLinkShownAt).toBe(1234)
    expect(offerFirstTime(s)).toBe(false)
    expect(markFirstTimeShown(s, 9999)).toBe(false)
    expect(s.safetyLinkShownAt).toBe(1234)
  })
})
