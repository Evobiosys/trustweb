// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave44 home-dashboard: the Home tile board's layout (default, drag, persistence, schema repair). Synthetic data only. */
import { HOME_TILES, defaultLayout, isDefaultLayout, layoutOf, moveTile, parseLayout, resetLayout, setHomeLayout } from '../../src/home_layout.ts'
import { SCHEMA_VERSION, migrate } from '../../src/schema_version.ts'

const all = (l) => [...l.left, ...l.center, ...l.right]

describe('default layout', () => {
  it('puts the Web in the big centre, others\' requests left (altruistic), mine right', () => {
    const l = defaultLayout()
    expect(l.center).toEqual(['web'])
    expect(l.left).toEqual(['asksToMe', 'connects', 'requests'])   // wave44c: Existing requests at the bottom
    expect(l.right).toEqual(['asksSent', 'invites'])
  })
  it('holds every tile exactly once', () => { expect(all(defaultLayout()).sort()).toEqual([...HOME_TILES].sort()) })
  it('a record without homeLayout reads as the default', () => { expect(layoutOf({})).toEqual(defaultLayout()) })
})

describe('parseLayout repairs what it is given', () => {
  it('garbage becomes the default', () => { for (const x of [null, 5, 'x', [], { left: 3 }]) expect(parseLayout(x)).toEqual(defaultLayout()) })
  it('drops unknown tiles and duplicates, appends missing ones to their default column', () => {
    const l = parseLayout({ left: ['web', 'zzz', 'web'], center: [], right: ['asksSent'] })
    expect(all(l).sort()).toEqual([...HOME_TILES].sort())
    expect(l.left).toEqual(['web', 'asksToMe', 'connects', 'requests'])
    expect(l.right).toEqual(['asksSent', 'invites'])
  })
})

describe('moveTile', () => {
  it('moves a tile to another column at an index; every tile stays once', () => {
    const l = moveTile(defaultLayout(), 'asksSent', 'left', 1)
    expect(l.left).toEqual(['asksToMe', 'asksSent', 'connects', 'requests'])
    expect(l.right).toEqual(['invites'])
    expect(all(l).sort()).toEqual([...HOME_TILES].sort())
  })
  it('reorders inside a column', () => { expect(moveTile(defaultLayout(), 'connects', 'left', 0).left).toEqual(['connects', 'asksToMe', 'requests']) })
  it('clamps the index and ignores an unknown tile', () => {
    expect(moveTile(defaultLayout(), 'web', 'right', 99).right).toEqual(['asksSent', 'invites', 'web'])
    expect(moveTile(defaultLayout(), 'nope', 'left', 0)).toEqual(defaultLayout())
  })
  it('does not mutate its input', () => { const d = defaultLayout(); moveTile(d, 'web', 'left', 0); expect(d).toEqual(defaultLayout()) })
})

describe('persistence in the record', () => {
  it('stores a changed layout and removes the key again for the default', () => {
    const s = {}
    setHomeLayout(s, moveTile(defaultLayout(), 'web', 'left', 0))
    expect(s.homeLayout.left[0]).toBe('web')
    expect(layoutOf(s).left[0]).toBe('web')
    setHomeLayout(s, defaultLayout())
    expect('homeLayout' in s).toBe(false)
  })
  it('resetLayout drops the stored layout', () => { const s = { homeLayout: { left: ['web'], center: [], right: [] } }; resetLayout(s); expect(s.homeLayout).toBeUndefined() })
  it('isDefaultLayout', () => { expect(isDefaultLayout(defaultLayout())).toBe(true); expect(isDefaultLayout(moveTile(defaultLayout(), 'web', 'left', 0))).toBe(false) })
})

describe('schema 3', () => {
  const base = (x = {}) => ({ v: 1, me: { id: 'm', displayName: 'T' }, people: [], ...x })
  it('is at least 3', () => { expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(3) })
  it('migrate repairs a broken homeLayout and drops a useless one', () => {
    const s = base({ homeLayout: { left: ['web', 'web', 'x'], center: [], right: [] } })
    expect(migrate(s)).toBe(true)
    expect([...s.homeLayout.left, ...s.homeLayout.center, ...s.homeLayout.right].sort()).toEqual([...HOME_TILES].sort())
    const d = base({ homeLayout: defaultLayout() })
    migrate(d)
    expect('homeLayout' in d).toBe(false)
  })
})
