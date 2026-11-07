// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Bottom bar (wave 31): configurable order, hidden views, one primary; pure. */
import { DEFAULT_ORDER, PHONE_MAX, addBar, defaultPrimary, overflowChoices, barChoices, barLayout, moveBar, resolveBar, setPrimary, toggleBar } from '../../src/bottom_bar.ts'

const all = { events: true, feed: true, inventory: true, people: true, map: true }

describe('bottom_bar', () => {
  it('defaults to Web, Chat, Record, Events, Resources (no Ask, no Feed)', () => {
    expect(DEFAULT_ORDER).toEqual(['web', 'chat', 'record', 'events', 'inventory'])
    expect(resolveBar(undefined, all).ids).toEqual(DEFAULT_ORDER)
    expect(resolveBar(undefined, all).primary).toBe('record')
  })
  it('Ask is optional: offered in the sheet, off by default, joins at the end', () => {
    expect(barChoices(undefined, all).find((x) => x.id === 'ask').on).toBe(false)
    expect(resolveBar(toggleBar(undefined, 'ask', all), all).ids.at(-1)).toBe('ask')
  })
  it('leaves out views whose feature is off', () => {
    expect(resolveBar(undefined, { ...all, feed: false, events: false }).ids).toEqual(['web', 'chat', 'record', 'inventory'])
  })
  it('hidden views drop out, Record cannot be hidden, unknown ids are skipped', () => {
    const r = resolveBar({ order: ['web', 'zzz', 'web', 'chat'], hidden: ['chat', 'record'] }, all)
    expect(r.ids).toContain('record')
    expect(r.ids).not.toContain('chat')
    expect(r.ids.filter((i) => i === 'web')).toHaveLength(1)
    expect(r.ids).not.toContain('zzz')
  })
  it('a saved order keeps its places; new default views are not forced back in', () => {
    expect(resolveBar({ order: ['chat', 'record', 'web'] }, all).ids).toEqual(['chat', 'record', 'web'])
  })
  it('primary is Record unless a shown view is chosen', () => {
    expect(resolveBar(undefined, all).primary).toBe('record')
    expect(resolveBar({ primary: 'web' }, all).primary).toBe('web')
    expect(resolveBar({ primary: 'map' }, all).primary).toBe('record')
    expect(resolveBar({ primary: 'feed' }, { ...all, feed: false }).primary).toBe('record')
  })
  it('toggle hides a shown view and brings it back; a new view joins at the end', () => {
    const hid = toggleBar(undefined, 'web', all)
    expect(resolveBar(hid, all).ids).not.toContain('web')
    expect(resolveBar(toggleBar(hid, 'web', all), all).ids).toEqual(DEFAULT_ORDER)
    const withNet = toggleBar(undefined, 'network', all)
    expect(resolveBar(withNet, all).ids.at(-1)).toBe('network')
  })
  it('toggle never hides Record and ignores unknown ids', () => {
    expect(resolveBar(toggleBar(undefined, 'record', all), all).ids).toContain('record')
    expect(toggleBar(undefined, 'zzz', all)).toEqual(undefined)
  })
  it('hiding the primary hands the primary back to Record', () => {
    const six = addBar(setPrimary(undefined, 'web', all), 'feed', 'web', 'right', all)
    expect(resolveBar(toggleBar(six, 'web', all), all).primary).toBe('record')
  })
  it('move swaps with the neighbour and stops at the ends', () => {
    expect(resolveBar(moveBar(undefined, 'chat', -1, all), all).ids.slice(0, 3)).toEqual(['chat', 'web', 'record'])
    expect(resolveBar(moveBar(undefined, 'web', -1, all), all).ids).toEqual(DEFAULT_ORDER)
    expect(resolveBar(moveBar(undefined, 'inventory', 1, all), all).ids).toEqual(DEFAULT_ORDER)
  })
  it('setPrimary refuses a view that is not shown', () => {
    expect(setPrimary(undefined, 'map', all)).toEqual(undefined)
    expect(resolveBar(setPrimary(undefined, 'chat', all), all).primary).toBe('chat')
  })
  it('layout: at most PHONE_MAX shown, the rest in the sheet', () => {
    expect(PHONE_MAX).toBe(6)
    const l = barLayout(resolveBar(undefined, all).ids, 'record', PHONE_MAX)
    expect(l.shown).toHaveLength(5)
    expect(l.overflow).toEqual([])
    const seven = barLayout(resolveBar(addBar(addBar(undefined, 'feed', 'web', 'right', all), 'ask', 'web', 'left', all), all).ids, 'record', PHONE_MAX)
    expect(seven.shown).toHaveLength(6)
    expect(seven.shown).toContain('record')
    expect(seven.overflow).toEqual(['inventory'])
    expect(barLayout(['web', 'chat'], 'record', 6)).toEqual({ shown: ['web', 'chat'], overflow: [] })
  })
  it('choices list every available view with its state', () => {
    const c = barChoices(undefined, all)
    expect(c.map((x) => x.id)).toEqual(['web', 'feed', 'chat', 'events', 'inventory', 'ask', 'network', 'people', 'map'])
    expect(c.find((x) => x.id === 'feed').on).toBe(false)
    expect(c.find((x) => x.id === 'web').on).toBe(true)
    expect(c.find((x) => x.id === 'network').on).toBe(false)
  })
  it('addBar puts a view left or right of a shown view and persists it in order', () => {
    const r = addBar(undefined, 'feed', 'web', 'right', all)
    expect(resolveBar(r, all).ids).toEqual(['web', 'feed', 'chat', 'record', 'events', 'inventory'])
    expect(r.order).toEqual(['web', 'feed', 'chat', 'record', 'events', 'inventory'])
    expect(resolveBar(addBar(undefined, 'feed', 'web', 'left', all), all).ids[0]).toBe('feed')
  })
  it('addBar moves an already shown view, un-hides a hidden one, keeps primary, ignores bad input', () => {
    expect(resolveBar(addBar(undefined, 'events', 'web', 'left', all), all).ids[0]).toBe('events')
    const hid = toggleBar(undefined, 'chat', all)
    expect(resolveBar(addBar(hid, 'chat', 'web', 'left', all), all).ids[0]).toBe('chat')
    expect(addBar({ primary: 'web' }, 'feed', 'web', 'left', all).primary).toBe('web')
    expect(addBar(undefined, 'zzz', 'web', 'left', all)).toEqual(undefined)
    expect(addBar(undefined, 'feed', 'map', 'left', all)).toEqual(undefined)
    expect(addBar(undefined, 'feed', 'feed', 'left', all)).toEqual(undefined)
  })
})

describe('bottom_bar profiles (wave 33)', () => {
  it('has three presets of five slots, centre = primary', async () => {
    const { PROFILES } = await import('../../src/bottom_bar.ts')
    expect(PROFILES.map((p) => p.id)).toEqual(['connector', 'up_to_date', 'note_taker'])
    for (const p of PROFILES) { expect(p.order).toHaveLength(5); expect(p.order[2]).toBe(p.primary) }
    expect(PROFILES.find((p) => p.id === 'note_taker').order).toEqual(DEFAULT_ORDER)
    expect(new Set(PROFILES.map((p) => p.order.join()))).toHaveProperty('size', 3)
  })
  it('applyProfile sets order, primary, marker, profile and clears hidden', async () => {
    const { applyProfile, BAR_ORDER_VERSION } = await import('../../src/bottom_bar.ts')
    const r = applyProfile({ order: ['web'], hidden: ['chat'], primary: 'web' }, 'up_to_date')
    expect(r).toEqual({ order: ['web', 'chat', 'feed', 'events', 'inventory'], hidden: [], primary: 'feed', orderVersion: BAR_ORDER_VERSION, profile: 'up_to_date' })
    expect(applyProfile(undefined, 'nope')).toBeUndefined()
    // Record cannot leave the row: presets without it get it mid-row (six buttons).
    expect(resolveBar(r, all).ids).toEqual(['web', 'chat', 'feed', 'record', 'events', 'inventory'])
    expect(resolveBar(applyProfile(undefined, 'connector'), all).ids).toEqual(['web', 'record', 'chat', 'events', 'inventory'])
  })
  it('manual edits set profile custom', async () => {
    const { applyProfile } = await import('../../src/bottom_bar.ts')
    const p = applyProfile(undefined, 'connector')
    expect(toggleBar(p, 'events', all).profile).toBe('custom')
    expect(moveBar(p, 'web', 1, all).profile).toBe('custom')
    expect(addBar(p, 'ask', 'web', 'left', all).profile).toBe('custom')
    expect(setPrimary(p, 'web', all).profile).toBe('custom')
  })
  it('activeProfile: stored id, else the matching preset, else custom', async () => {
    const { activeProfile, applyProfile } = await import('../../src/bottom_bar.ts')
    expect(activeProfile(applyProfile(undefined, 'up_to_date'), all)).toBe('up_to_date')
    expect(activeProfile(undefined, all)).toBe('note_taker')
    expect(activeProfile({ order: ['chat', 'record', 'web'] }, all)).toBe('custom')
  })
  it('a stored communicator profile (retired) leaves the bar unchanged and counts as custom', async () => {
    const { activeProfile, applyProfile } = await import('../../src/bottom_bar.ts')
    const bar = { order: ['web', 'feed', 'chat', 'events', 'inventory'], primary: 'chat', profile: 'communicator' }
    expect(applyProfile(bar, 'communicator')).toBe(bar)
    expect(activeProfile(bar, all)).toBe('custom')
  })
  it('customFrom keeps the shown ids and primary as profile custom', async () => {
    const { customFrom, BAR_ORDER_VERSION } = await import('../../src/bottom_bar.ts')
    expect(customFrom({ hidden: ['map'], profile: 'connector' }, ['web', 'record', 'chat'], 'chat'))
      .toEqual({ order: ['web', 'record', 'chat'], hidden: [], primary: 'chat', orderVersion: BAR_ORDER_VERSION, profile: 'custom' })
  })
  it('defaultPrimary: an even number of buttons has no highlight, an odd one the preset or Record', () => {
    expect(defaultPrimary(['web', 'chat', 'record', 'events'])).toBe(null)
    expect(defaultPrimary(DEFAULT_ORDER)).toBe('record')
    expect(defaultPrimary(['web', 'chat', 'feed'], 'feed')).toBe('feed')
    expect(defaultPrimary(['web', 'chat', 'feed'], 'record')).toBe('record')
  })
  it('resolveBar: user choice wins, "none" gives null, never chosen follows the count', () => {
    const four = { order: ['web', 'chat', 'record', 'events'] }
    expect(resolveBar(four, all).primary).toBe(null)
    expect(resolveBar({ ...four, primary: 'chat' }, all).primary).toBe('chat')
    expect(resolveBar({ primary: 'none' }, all).primary).toBe(null)
    expect(resolveBar({ order: ['web', 'chat', 'record', 'events', 'inventory', 'feed'] }, all).primary).toBe(null)
  })
  it('setPrimary accepts none', () => {
    expect(setPrimary(undefined, 'none', all)).toEqual({ primary: 'none', profile: 'custom' })
    expect(resolveBar(setPrimary(undefined, 'none', all), all).primary).toBe(null)
  })
  it('barLayout with no primary keeps the first buttons', () => {
    expect(barLayout(['a', 'b', 'c', 'd'], null, 2)).toEqual({ shown: ['a', 'b'], overflow: ['c', 'd'] })
  })
  it('customFrom stores no primary as none', async () => {
    const { customFrom } = await import('../../src/bottom_bar.ts')
    expect(customFrom(undefined, ['web', 'record'], null).primary).toBe('none')
  })
  it('overflowChoices: views not in the bar, People and Map only when the user took them out', () => {
    const ids = resolveBar(undefined, all).ids
    expect(overflowChoices(ids, [], all)).toEqual(['feed', 'ask', 'network'])
    expect(overflowChoices(ids, ['map'], all)).toEqual(['feed', 'ask', 'network', 'map'])
    expect(overflowChoices(ids, [], { ...all, feed: false })).toEqual(['ask', 'network'])
    expect(overflowChoices(['web', 'chat', 'record', 'events', 'inventory', 'feed', 'ask', 'network'], [], all)).toEqual([])
  })
})
