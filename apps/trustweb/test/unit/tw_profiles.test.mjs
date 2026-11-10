// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 extensions-profiles: profiles (src/ext/profiles.ts) and what they hide. */
import { TW_PROFILES, profileOf, profileDef, switchProfile, setToggle, moduleOff } from '../../src/ext/profiles.ts'
import { featureOn, feedOn } from '../../src/model.ts'
import { resolveBar } from '../../src/bottom_bar.ts'

const DEFAULTS = { events: true, resources: true, feed: true, matches: true, 'support-ask': true, 'ai-button': true, calendar: true }

describe('profiles', () => {
  it('four profiles, full first; unknown or absent reads as full', () => {
    expect(TW_PROFILES.map((p) => p.id)).toEqual(['full', 'iyg-support', 'reader', 'note-taker'])
    expect(profileOf(undefined)).toBe('full')
    expect(profileOf({ profile: 'nope' })).toBe('full')
    expect(profileOf({ profile: 'reader' })).toBe('reader')
    expect(profileDef('iyg-support').webPrimary).toBe('support')
    expect(profileDef('full').webPrimary).toBeUndefined()
  })

  it('iyg-support turns resources, feed, events and matches off and keeps support-ask and the AI button on', () => {
    const tw = switchProfile(undefined, 'iyg-support', DEFAULTS)
    expect(tw.profile).toBe('iyg-support')
    for (const id of ['resources', 'feed', 'events', 'matches']) expect(moduleOff(tw, id)).toBe(true)
    for (const id of ['support-ask', 'ai-button', 'calendar']) expect(moduleOff(tw, id)).toBe(false)
  })

  it('iyg-support hides Resources, Feed and Events from the bottom bar; Full shows them', () => {
    const s = { feed: { on: true }, features: undefined, twSettings: switchProfile(undefined, 'iyg-support', DEFAULTS) }
    expect(featureOn(s, 'inventory')).toBe(false)
    expect(featureOn(s, 'events')).toBe(false)
    expect(feedOn(s)).toBe(false)
    const flags = { events: featureOn(s, 'events'), feed: featureOn(s, 'feed'), inventory: featureOn(s, 'inventory'), people: true, map: true }
    const ids = resolveBar(undefined, flags).ids
    expect(ids).not.toContain('inventory')
    expect(ids).not.toContain('events')
    expect(ids).not.toContain('feed')
    expect(ids).toContain('web')
    const full = { feed: { on: true }, twSettings: switchProfile(s.twSettings, 'full', DEFAULTS) }
    expect(featureOn(full, 'inventory') && featureOn(full, 'events') && feedOn(full)).toBe(true)
  })

  it('user toggles are kept per profile: leaving and coming back restores them', () => {
    let tw = switchProfile(undefined, 'full', DEFAULTS)
    tw = setToggle(tw, 'calendar', false)
    tw = switchProfile(tw, 'iyg-support', DEFAULTS)
    expect(moduleOff(tw, 'calendar')).toBe(false)
    expect(moduleOff(tw, 'events')).toBe(true)
    tw = setToggle(tw, 'ai-button', false)
    tw = switchProfile(tw, 'full', DEFAULTS)
    expect(moduleOff(tw, 'calendar')).toBe(true)
    expect(moduleOff(tw, 'events')).toBe(false)
    expect(moduleOff(tw, 'ai-button')).toBe(false)
    tw = switchProfile(tw, 'iyg-support', DEFAULTS)
    expect(moduleOff(tw, 'ai-button')).toBe(true)
    expect(moduleOff(tw, 'events')).toBe(true)
  })

  it('switching to the profile already active changes nothing', () => {
    const a = switchProfile(undefined, 'iyg-support', DEFAULTS)
    expect(switchProfile(a, 'iyg-support', DEFAULTS)).toEqual(a)
  })

  it('does not mutate its input', () => {
    const a = Object.freeze({ extensions: Object.freeze({ calendar: false }) })
    expect(() => switchProfile(a, 'reader', DEFAULTS)).not.toThrow()
    expect(() => setToggle(a, 'x', true)).not.toThrow()
  })
})
