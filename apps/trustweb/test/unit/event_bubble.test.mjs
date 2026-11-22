// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 event-bubble: event mode narrows the Web to the event's people; the chip "Everyone" lifts it; the setting turns it off. */
import { bubbleOn, setEveryone } from '../../src/event_bubble.ts'
import { eventModeShow, setEventFilter } from '../../src/event_filter_mode.ts'
import { SETTINGS_REGISTRY, readSetting, writeSetting } from '../../src/settings_registry.ts'

describe('event bubble', () => {
  it('on only while event mode is on, the setting allows it and Everyone is not chosen', () => {
    expect(bubbleOn({ uiRings: {} })).toBe(false)
    expect(bubbleOn({ uiRings: { eventMode: 'e1' } })).toBe(true)
    expect(bubbleOn({ uiRings: { eventMode: 'e1' }, eventBubbleOff: true })).toBe(false)
    expect(bubbleOn({ uiRings: { eventMode: 'e1', eventEveryone: true } })).toBe(false)
  })
  it('Everyone lifts and restores; nothing to lift outside event mode', () => {
    const s = { uiRings: { eventMode: 'e1' } }
    expect(setEveryone(s, true)).toBe(true)
    expect(setEveryone(s, true)).toBe(false)
    expect(bubbleOn(s)).toBe(false)
    expect(setEveryone(s, false)).toBe(true)
    expect(s.uiRings.eventEveryone).toBeUndefined()
    expect(bubbleOn(s)).toBe(true)
    expect(setEveryone({ uiRings: {} }, true)).toBe(false)
  })
  it('the Web show list carries the event chip only while the bubble is on', () => {
    expect(eventModeShow({ uiRings: { eventMode: 'e1' } })).toEqual(['event:e1'])
    expect(eventModeShow({ uiRings: { eventMode: 'e1', eventEveryone: true } })).toEqual([])
    expect(eventModeShow({ uiRings: { eventMode: 'e1' }, eventBubbleOff: true })).toEqual([])
  })
  it('event mode ending (or another event) resets Everyone', () => {
    const s = { uiRings: { eventMode: 'e1', eventEveryone: true } }
    setEventFilter(s, 'e2')
    expect(bubbleOn(s)).toBe(true)
    setEveryone(s, true)
    setEventFilter(s, null)
    expect(s.uiRings.eventEveryone).toBeUndefined()
    setEventFilter(s, 'e2')
    expect(bubbleOn(s)).toBe(true)
  })
  it('setting events.autoBubble: default on, off stored as eventBubbleOff', () => {
    expect(SETTINGS_REGISTRY.some((d) => d.id === 'events.autoBubble')).toBe(true)
    const r = {}
    expect(readSetting(r, 'events.autoBubble')).toBe(true)
    writeSetting(r, 'events.autoBubble', false)
    expect(r.eventBubbleOff).toBe(true)
    writeSetting(r, 'events.autoBubble', true)
    expect(r.eventBubbleOff).toBeUndefined()
  })
})
