// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 hover-sources: the plain words of the card ("Y and Z: friends (we think, 0.7)" / "Why: ..."). */
import { headline, whyLine, sourceText } from '../../src/relations_text.ts'

const rel = (over = {}) => ({ a: 'a', b: 'b', kind: 'friends', confidence: 0.7, sources: [], ...over })

describe('headline', () => {
  it('"we think" with the number while unsure', () => {
    expect(headline(rel(), 'Yara', 'Zed')).toBe('Yara and Zed: friends (we think, 0.7)')
  })
  it('"you said so" at 1', () => {
    expect(headline(rel({ kind: 'close-friends', confidence: 1 }), 'Yara', 'Zed')).toBe('Yara and Zed: close friends (you said so)')
  })
  it('an unknown kind reads "connected"', () => {
    expect(headline(rel({ kind: 'unknown' }), 'Y', 'Z')).toBe('Y and Z: connected (we think, 0.7)')
  })
})

describe('sourceText', () => {
  it('a shared tag, a shared import, an event, a group', () => {
    expect(sourceText({ type: 'shared-tag', detail: 'IYG 2026' })).toBe('shared tag IYG 2026')
    expect(sourceText({ type: 'shared-import', detail: 'google', date: '2026-11-09' })).toBe('same import: google (2026-11-09)')
    expect(sourceText({ type: 'co-presence-event', detail: 'Camp', date: '2026-08-01' })).toBe('both at Camp (2026-08-01)')
    expect(sourceText({ type: 'messenger-group', detail: 'Garden' })).toBe('both in the group Garden')
  })
  it('my own statement, with its date; the Knows list; the ring guess', () => {
    expect(sourceText({ type: 'stated-by-me', detail: 'friends', date: '2026-11-10' })).toBe('you said so (2026-11-10)')
    expect(sourceText({ type: 'stated-by-me', detail: 'knows' })).toBe('you listed them as knowing each other')
    expect(sourceText({ type: 'inferred', detail: 'friend' })).toBe('both are in your friends ring or closer')
    expect(sourceText({ type: 'inferred', detail: 'family' })).toBe('both are family')
  })
  it('a crowd source says so', () => {
    expect(sourceText({ type: 'shared-tag', detail: 'Big', crowd: true })).toBe('shared tag Big (a big group, counts little)')
  })
})

describe('whyLine', () => {
  it('"Why: " and the sources joined with semicolons', () => {
    expect(whyLine(rel({ sources: [{ type: 'shared-tag', detail: 'IYG 2026' }, { type: 'stated-by-me', detail: 'friends', date: '2026-11-10' }] })))
      .toBe('Why: shared tag IYG 2026; you said so (2026-11-10)')
  })
})
