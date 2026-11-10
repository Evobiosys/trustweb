// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 community-mighty: a module view (`mod:<id>`) joins the bottom row while its module is on, and leaves with it. */
import { resolveBar, toggleBar, modOfBar, barChoices } from '../../src/bottom_bar.ts'

const F = { events: true, feed: false, inventory: true, people: true, map: true }

describe('module views in the bottom row', () => {
  it('absent while no module view is on', () => {
    expect(resolveBar(undefined, F).ids).toEqual(['web', 'chat', 'record', 'events', 'inventory'])
  })

  it('an enabled module view is appended at the end, and offered in the sheet', () => {
    const f = { ...F, mods: ['community'] }
    expect(resolveBar(undefined, f).ids).toEqual(['web', 'chat', 'record', 'events', 'inventory', 'mod:community'])
    expect(barChoices(undefined, f).find((c) => c.id === 'mod:community')).toEqual({ id: 'mod:community', on: true })
  })

  it('taking it out of the row keeps it out; a stored entry whose module is off is skipped', () => {
    const f = { ...F, mods: ['community'] }
    const bar = toggleBar(undefined, 'mod:community', f)
    expect(resolveBar(bar, f).ids).not.toContain('mod:community')
    expect(resolveBar(toggleBar(bar, 'mod:community', f), f).ids).toContain('mod:community')
    expect(resolveBar({ order: ['web', 'mod:community', 'record'] }, F).ids).toEqual(['web', 'record'])
  })

  it('modOfBar names the view of a mod entry only', () => {
    expect(modOfBar('mod:community')).toBe('community')
    expect(modOfBar('view:people')).toBeNull()
    expect(modOfBar('mod:')).toBeNull()
  })
})

describe('community module stub', async () => {
  const { module } = await import('../../src/ext/community-mighty/index.ts')
  const { createRegistry, createBus } = await import('../../src/ext/tw_registry.ts')

  it('is a heavy view module, off by default, never loaded while off', async () => {
    expect(module).toMatchObject({ id: 'community-mighty', kind: 'view', heavy: true, enabledByDefault: false })
    let tw
    const load = vi.fn(async () => ({ views: [{ id: 'community', title: 'Community', icon: 'users', mount: () => () => {} }] }))
    const reg = createRegistry({ settings: () => tw, save: (n) => { tw = n }, ctx: () => ({ bus: createBus() }) })
    reg.registerModule({ ...module, load })
    await reg.start()
    expect(load).not.toHaveBeenCalled()
    expect(reg.views()).toEqual([])
    await reg.setEnabled('community-mighty', true)
    expect(load).toHaveBeenCalledTimes(1)
    expect(reg.views().map((v) => v.id)).toEqual(['community'])
    await reg.setEnabled('community-mighty', false)
    expect(reg.views()).toEqual([])
  })
})
