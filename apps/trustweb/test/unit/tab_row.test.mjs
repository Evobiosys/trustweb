// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Bottom row (wave 24): default five slots, Resources pinned right, unknown ids skipped, duplicates collapsed. */
import { DEFAULT_ROW, availableTabs, resolveRow, setSlot } from '../../src/tab_row.ts'

const all = { events: true, feed: false, inventory: true }

describe('tab_row', () => {
  it('defaults to Membranes | Chat | Record | Events | Resources', () => {
    expect(DEFAULT_ROW).toEqual(['web', 'chat', 'record', 'events', 'inventory'])
    expect(resolveRow(undefined, all)).toEqual(DEFAULT_ROW)
  })
  it('has four slots when events are off', () => {
    expect(resolveRow(undefined, { ...all, events: false })).toEqual(['web', 'chat', 'record', 'inventory'])
  })
  it('skips unknown ids, collapses duplicates, pins inventory last', () => {
    expect(resolveRow(['inventory', 'web', 'web', 'zzz', 'chat', 'record'], all)).toEqual(['web', 'chat', 'record', 'inventory'])
  })
  it('falls back to the default when nothing usable is saved', () => {
    expect(resolveRow(['zzz'], all)).toEqual(DEFAULT_ROW)
    expect(resolveRow('x', all)).toEqual(DEFAULT_ROW)
  })
  it('drops feed while off, keeps it while on', () => {
    expect(resolveRow(['web', 'feed', 'record', 'chat', 'inventory'], all)).toEqual(['web', 'record', 'chat', 'inventory'])
    expect(resolveRow(['web', 'feed', 'record', 'chat', 'inventory'], { ...all, feed: true })).toEqual(['web', 'feed', 'record', 'chat', 'inventory'])
  })
  it('without the inventory feature there is no pinned tab', () => {
    expect(resolveRow(undefined, { ...all, inventory: false })).toEqual(['web', 'chat', 'record', 'events'])
  })
  it('lists the choosable screens', () => {
    expect(availableTabs(all)).toEqual(['web', 'chat', 'record', 'events', 'inventory', 'network', 'desk'])
    expect(availableTabs({ events: false, feed: true, inventory: true })).toContain('feed')
    expect(availableTabs({ events: false, feed: true, inventory: true })).not.toContain('events')
  })
  it('sets a slot, swapping with the slot that held the id; the last slot stays locked', () => {
    expect(setSlot(DEFAULT_ROW, 1, 'events', all)).toEqual(['web', 'events', 'record', 'chat', 'inventory'])
    expect(setSlot(DEFAULT_ROW, 0, 'network', all)).toEqual(['network', 'chat', 'record', 'events', 'inventory'])
    expect(setSlot(DEFAULT_ROW, 4, 'web', all)).toEqual(DEFAULT_ROW)
    expect(setSlot(DEFAULT_ROW, 1, 'zzz', all)).toEqual(DEFAULT_ROW)
  })
})
