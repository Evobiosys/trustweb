// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Bottom bar (wave 31): configurable order, hidden views, one primary; pure. */
import { DEFAULT_ORDER, PHONE_MAX, barChoices, barLayout, moveBar, resolveBar, setPrimary, toggleBar } from '../../src/bottom_bar.ts'

const all = { events: true, feed: true, inventory: true, people: true, map: true }

describe('bottom_bar', () => {
  it('defaults to Ask, Resources, Web, Feed, Record, Chat, Events', () => {
    expect(DEFAULT_ORDER).toEqual(['ask', 'inventory', 'web', 'feed', 'record', 'chat', 'events'])
    expect(resolveBar(undefined, all).ids).toEqual(DEFAULT_ORDER)
  })
  it('leaves out views whose feature is off', () => {
    expect(resolveBar(undefined, { ...all, feed: false, events: false }).ids).toEqual(['ask', 'inventory', 'web', 'record', 'chat'])
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
    const hid = toggleBar(undefined, 'feed', all)
    expect(resolveBar(hid, all).ids).not.toContain('feed')
    expect(resolveBar(toggleBar(hid, 'feed', all), all).ids).toEqual(DEFAULT_ORDER)
    const withNet = toggleBar(undefined, 'network', all)
    expect(resolveBar(withNet, all).ids.at(-1)).toBe('network')
  })
  it('toggle never hides Record and ignores unknown ids', () => {
    expect(resolveBar(toggleBar(undefined, 'record', all), all).ids).toContain('record')
    expect(toggleBar(undefined, 'zzz', all)).toEqual(undefined)
  })
  it('hiding the primary hands the primary back to Record', () => {
    const b = toggleBar(setPrimary(undefined, 'web', all), 'web', all)
    expect(resolveBar(b, all).primary).toBe('record')
  })
  it('move swaps with the neighbour and stops at the ends', () => {
    expect(resolveBar(moveBar(undefined, 'web', -1, all), all).ids.slice(0, 3)).toEqual(['ask', 'web', 'inventory'])
    expect(resolveBar(moveBar(undefined, 'ask', -1, all), all).ids).toEqual(DEFAULT_ORDER)
    expect(resolveBar(moveBar(undefined, 'events', 1, all), all).ids).toEqual(DEFAULT_ORDER)
  })
  it('setPrimary refuses a view that is not shown', () => {
    expect(setPrimary(undefined, 'map', all)).toEqual(undefined)
    expect(resolveBar(setPrimary(undefined, 'chat', all), all).primary).toBe('chat')
  })
  it('layout: at most PHONE_MAX shown, the rest in the sheet', () => {
    expect(PHONE_MAX).toBe(6)
    const l = barLayout(resolveBar(undefined, all).ids, 'record', PHONE_MAX)
    expect(l.shown).toHaveLength(6)
    expect(l.shown).toContain('record')
    expect(l.overflow).toEqual(['events'])
    expect(barLayout(['web', 'chat'], 'record', 6)).toEqual({ shown: ['web', 'chat'], overflow: [] })
  })
  it('choices list every available view with its state', () => {
    const c = barChoices(toggleBar(undefined, 'feed', all), all)
    expect(c.map((x) => x.id)).toEqual(['web', 'feed', 'chat', 'events', 'inventory', 'ask', 'network', 'people', 'map'])
    expect(c.find((x) => x.id === 'feed').on).toBe(false)
    expect(c.find((x) => x.id === 'web').on).toBe(true)
    expect(c.find((x) => x.id === 'network').on).toBe(false)
  })
})
