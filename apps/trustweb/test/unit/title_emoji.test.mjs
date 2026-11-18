// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** answers-44d item 3: the algorithmic title emoji (never an LLM): keyword table, first match by position, stable neutral fallback, the Appearance switch. */
import { titleEmoji, emojiTitle, emojiOn, NEUTRAL } from '../../src/title_emoji.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'

describe('titleEmoji', () => {
  it('seasons, also inside German compounds', () => {
    expect(titleEmoji('Winter OG')).toBe('❄️')
    expect(titleEmoji('Sommerfest')).toBe('☀️')
    expect(titleEmoji('Schneewanderung')).toBe('❄️')
    expect(titleEmoji('Herbstmarkt')).toBe('🍂')
    expect(titleEmoji('Spring gathering')).toBe('🌱')
  })
  it('event kinds and resources', () => {
    expect(titleEmoji('Repair café')).toBe('🔧')
    expect(titleEmoji('Yoga morning')).toBe('🧘')
    expect(titleEmoji('Community dinner')).toBe('🍲')
    expect(titleEmoji('Hackathon')).toBe('💻')
    expect(titleEmoji('Cargo bike')).toBe('🚲')
    expect(titleEmoji('Slides.pdf')).toBe('📄')
    expect(titleEmoji('Gartenfest')).toBe('🌿')
  })
  it('the first match by position in the title wins', () => {
    expect(titleEmoji('Winter dance party')).toBe('❄️')
    expect(titleEmoji('Dance in winter')).toBe('💃')
  })
  it('no match: a neutral emoji, the same for the same title, case and spaces aside', () => {
    const a = titleEmoji('Quorx Plinth')
    expect(NEUTRAL).toContain(a)
    expect(titleEmoji('quorx plinth ')).toBe(a)
    expect(new Set(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'].map(titleEmoji)).size).toBeGreaterThan(1)
    expect(titleEmoji('')).toBe('')
  })
  it('emojiTitle prepends only when on', () => {
    expect(emojiTitle('Winter OG', true)).toBe('❄️ Winter OG')
    expect(emojiTitle('Winter OG', false)).toBe('Winter OG')
  })
  it('Settings > Appearance: ui.titleEmoji, on by default, stored only when off', () => {
    const r = {}
    expect(emojiOn(r)).toBe(true)
    expect(readSetting(r, 'ui.titleEmoji')).toBe(true)
    writeSetting(r, 'ui.titleEmoji', false)
    expect(r.titleEmojiOff).toBe(true)
    expect(emojiOn(r)).toBe(false)
    writeSetting(r, 'ui.titleEmoji', true)
    expect('titleEmojiOff' in r).toBe(false)
  })
})
