// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c answers-44c item 1 (Jakob 20:22): the chat switch sits top right in the eye's slot again, nothing of it after the title. */
import { readFileSync } from 'node:fs'
import { HEADER_RIGHT, headerAfterTitle, headerRight } from '../../src/header_controls.ts'

const SCREENS = ['web', 'chat', 'people', 'events', 'inventory', 'feed', 'timeline', 'ask', 'notes', 'groups', 'ext']

describe('answers-44c header: chat switch top right', () => {
  it('HEADER_RIGHT holds the switch in the eye slot (first, beside views)', () => {
    expect([...HEADER_RIGHT]).toEqual(['views', 'switch', 'search', 'qr', 'settings', 'ai'])
  })
  it('chat: switch first on the right, where the eye is on the other screens', () => {
    expect(headerRight('chat', false)).toEqual(['switch', 'search', 'qr', 'settings'])
    expect(headerRight('web', false)).toEqual(['views', 'search', 'qr', 'settings'])
  })
  it('per screen: the eye slot holds the eye or the switch, never both; switch only on chat', () => {
    for (const s of SCREENS) {
      const r = headerRight(s, true)
      expect(r.includes('views') && r.includes('switch'), s).toBe(false)
      expect(r.includes('switch'), s).toBe(s === 'chat')
      expect(r.slice(-3), s).toEqual(['qr', 'settings', 'ai'])
    }
  })
  it('the left cluster gets only the pins after the title', () => {
    for (const s of SCREENS) expect(headerAfterTitle(s).includes('switch'), s).toBe(false)
    expect(headerAfterTitle('chat')).toEqual(['pins'])
  })
  it('main.ts moves the chat communities toggle into the switch slot', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    expect(src).toContain("'.hdr-left [data-chat-communities]'")
  })
})
