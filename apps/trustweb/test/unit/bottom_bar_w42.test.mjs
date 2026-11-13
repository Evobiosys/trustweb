// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * Wave 42 bottom-bar: B04 raised rule, B05 every item (Record too) removable from one list, B08 shared "No match found". */
import { raisedIndices } from '../../src/tab_row.ts'
import { arrangeRows, barChoices, canHideBar, resolveBar, toggleBar, overflowChoices } from '../../src/bottom_bar.ts'
import { emptyState } from '../../src/empty_state.ts'
import { S } from '../../src/strings.ts'
import { filterSettings } from '../../src/settings_search.ts'

const all = { events: true, feed: true, inventory: true, people: true, map: true }

describe('B04 raisedIndices', () => {
  it.each([[0, []], [1, [0]], [2, [0, 1]], [3, [1]], [4, [1, 2]], [5, [2]], [6, [2, 3]], [7, [3]]])('n=%i', (n, want) => {
    expect(raisedIndices(n)).toEqual(want)
  })
  it('five tabs with a module button raise only the centre (the screenshot case)', () => {
    const bar = { order: ['web', 'chat', 'record', 'inventory'] }
    const r = resolveBar(bar, { ...all, events: false, mods: ['community'] })
    expect(r.ids).toHaveLength(5)
    expect(r.pair).toEqual([])
    expect(r.primary).toBe('record')
  })
  it('an odd row without Record raises the centre one', () => {
    const r = resolveBar({ order: ['web', 'chat', 'events'], hidden: ['record'] }, all)
    expect(r.ids).toEqual(['web', 'chat', 'events'])
    expect(r.primary).toBe('chat')
  })
  it('on a phone the default is chosen over the buttons that show', () => {
    const order = ['web', 'chat', 'record', 'events', 'inventory', 'network', 'people']
    expect(resolveBar({ order }, all, 6).pair).toEqual(['record', 'events'])
  })
})

describe('D2 stock bar: Web, Chat, Feed, Events, Resources', () => {
  const mods = { ...all, mods: ['feed', 'events', 'community'] }
  it('the unsaved default is exactly the five, no module button, only the centre (Feed) raised', () => {
    const r = resolveBar(undefined, mods)
    expect(r.ids).toEqual(['web', 'chat', 'feed', 'events', 'inventory'])
    expect(r.primary).toBe('feed')
    expect(r.pair).toEqual([])
  })
  it('the modules (Community too) stay reachable from the ⋮ list', () => {
    const r = resolveBar(undefined, mods)
    expect(overflowChoices(r.ids, [], mods)).toEqual(expect.arrayContaining(['record', 'mod:community', 'mod:feed', 'mod:events']))
  })
  it('the first edit keeps the modules out of the row', () => {
    const bar = toggleBar(undefined, 'chat', mods)
    expect(resolveBar(bar, mods).ids).toEqual(['web', 'feed', 'events', 'inventory'])
  })
  it('a custom bar made from the stock row keeps Record and the modules out', async () => {
    const { customFrom } = await import('../../src/bottom_bar.ts')
    const ids = resolveBar(undefined, mods).ids
    expect(resolveBar(customFrom(undefined, ids, 'feed', mods), mods).ids).toEqual(ids)
  })
  it('the Feed is on without a stored choice, off when the user switched it off', async () => {
    const { feedOn } = await import('../../src/model.ts')
    expect(feedOn({})).toBe(true)
    expect(feedOn({ feed: { on: false } })).toBe(false)
  })
})

describe('B05 one list, Record removable', () => {
  it('toggling Record off removes it from the bar, on brings it back (same store)', () => {
    const off = toggleBar({ order: ['web', 'chat', 'record', 'events', 'inventory'] }, 'record', all)
    expect(resolveBar(off, all).ids).toEqual(['web', 'chat', 'events', 'inventory'])
    expect(resolveBar(off, all).pair).toEqual(['chat', 'events'])
    expect(barChoices(off, all).find((x) => x.id === 'record')).toEqual({ id: 'record', on: false })
    expect(arrangeRows(off, all, 6).find((r) => r.id === 'record').slot).toBe('off')
    expect(resolveBar(toggleBar(off, 'record', all), all).ids).toContain('record')
  })
  it('a hidden Record is offered in the ⋮ list', () => {
    const off = toggleBar({ order: ['web', 'chat', 'record', 'events', 'inventory'] }, 'record', all)
    expect(overflowChoices(resolveBar(off, all).ids, off.hidden, all)).toContain('record')
  })
  it('removing the last item is refused', () => {
    let bar = { order: ['web', 'record'] }
    expect(canHideBar(bar, 'web', all)).toBe(true)
    bar = toggleBar(bar, 'web', all)
    expect(canHideBar(bar, 'record', all)).toBe(false)
    expect(toggleBar(bar, 'record', all)).toBe(bar)
    expect(resolveBar(bar, all).ids).toEqual(['record'])
  })
  it('showing a hidden item is always allowed', () => {
    const bar = toggleBar({ order: ['web', 'record'] }, 'web', all)
    expect(canHideBar(bar, 'web', all)).toBe(true)
  })
})

describe('B08 emptyState', () => {
  it('adds the "No match found" line once; removes it when results come back', () => {
    const box = document.createElement('div')
    emptyState(box, 'zzz', 0)
    emptyState(box, 'zzz', 0)
    expect(box.querySelectorAll('[data-no-match]')).toHaveLength(1)
    expect(box.textContent).toBe(S.noMatch)
    emptyState(box, 'zzz', 2)
    expect(box.querySelector('[data-no-match]')).toBeNull()
    emptyState(box, '', 0)
    expect(box.querySelector('[data-no-match]')).toBeNull()
  })
  it('the settings search shows it when no row matches', () => {
    const root = document.createElement('div')
    root.innerHTML = '<details data-settings-group><summary>Chat</summary><div>Notifications</div></details>'
    filterSettings(root, 'zzz')
    expect(root.querySelector('[data-no-match]')?.textContent).toBe(S.noMatch)
    filterSettings(root, 'notif')
    expect(root.querySelector('[data-no-match]')).toBeNull()
  })
})
