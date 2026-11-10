// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 feed-events: both stubs are heavy view modules, on in Full, off under IYG support, and load only when on. */
import { switchProfile, moduleOff } from '../../src/ext/profiles.ts'

describe.each([['feed-view', '../../src/ext/feed/index.ts'], ['events-view', '../../src/ext/events/index.ts']])('%s stub', async (id, path) => {
  const { module } = await import(path)
  const { createRegistry, createBus } = await import('../../src/ext/tw_registry.ts')
  const run = async (profile) => {
    let tw = profile ? switchProfile(undefined, profile, { [id]: true }) : undefined
    const load = vi.fn(async () => ({ views: [{ id, title: id, icon: 'feed', mount: () => () => {} }] }))
    const reg = createRegistry({ settings: () => tw, save: (n) => { tw = n }, ctx: () => ({ bus: createBus() }) })
    reg.registerModule({ ...module, load })
    await reg.start()
    return { reg, load }
  }

  it('is a heavy view module that is on by default', () => {
    expect(module).toMatchObject({ id, kind: 'view', heavy: true, enabledByDefault: true })
  })
  it('Full: loaded on start, view listed', async () => {
    const { reg, load } = await run('full')
    expect(load).toHaveBeenCalledTimes(1)
    expect(reg.views().map((v) => v.id)).toEqual([id])
  })
  it('IYG support: switched off, never loaded; switching it on loads it', async () => {
    expect(moduleOff(switchProfile(undefined, 'iyg-support', { [id]: true }), id)).toBe(true)
    const { reg, load } = await run('iyg-support')
    expect(load).not.toHaveBeenCalled()
    expect(reg.views()).toEqual([])
    await reg.setEnabled(id, true)
    expect(load).toHaveBeenCalledTimes(1)
    expect(reg.views().map((v) => v.id)).toEqual([id])
  })
})
