// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 extensions-profiles: the module registry (src/ext/tw_registry.ts). */
import { createRegistry, createBus } from '../../src/ext/tw_registry.ts'

const mod = (id, extra = {}) => ({ id, title: id, kind: 'service', enabledByDefault: true, ...extra })

function make(initial) {
  let tw = initial
  const log = []
  const reg = createRegistry({ settings: () => tw, save: (t) => { tw = t }, ctx: () => ({ store: () => ({}), strings: {}, bus: createBus(), navigate: () => {}, profile: () => 'full' }) })
  return { reg, log, tw: () => tw }
}

describe('registry: add, enable, disable, dispose order', () => {
  it('registers once per id and lists in order; a bad or repeated id throws', () => {
    const { reg } = make()
    reg.registerModule(mod('a'))
    reg.registerModule(mod('b-c'))
    expect(reg.listModules().map((m) => m.id)).toEqual(['a', 'b-c'])
    expect(() => reg.registerModule(mod('a'))).toThrow()
    expect(() => reg.registerModule(mod('Bad Id'))).toThrow()
  })

  it('isEnabled: stored choice wins, else the default; unknown ids are off', () => {
    const { reg } = make({ extensions: { b: true, c: false } })
    reg.registerModule(mod('a'))
    reg.registerModule(mod('b', { enabledByDefault: false }))
    reg.registerModule(mod('c'))
    expect([reg.isEnabled('a'), reg.isEnabled('b'), reg.isEnabled('c'), reg.isEnabled('zzz')]).toEqual([true, true, false, false])
  })

  it('start inits enabled modules in order; stop disposes them in reverse; a disabled module is never initialised', async () => {
    const { reg, log } = make({ extensions: { c: false } })
    for (const id of ['a', 'b', 'c']) reg.registerModule(mod(id, { init: () => { log.push('init ' + id) }, dispose: () => { log.push('dispose ' + id) } }))
    await reg.start()
    expect(log).toEqual(['init a', 'init b'])
    reg.stop()
    expect(log.slice(2)).toEqual(['dispose b', 'dispose a'])
  })

  it('setEnabled persists, initialises live, and disposes on off', async () => {
    const { reg, log, tw } = make()
    reg.registerModule(mod('a', { enabledByDefault: false, init: () => { log.push('init') }, dispose: () => { log.push('dispose') } }))
    await reg.start()
    expect(log).toEqual([])
    await reg.setEnabled('a', true)
    expect(tw().extensions.a).toBe(true)
    expect(log).toEqual(['init'])
    await reg.setEnabled('a', false)
    expect(log).toEqual(['init', 'dispose'])
    expect(reg.isEnabled('a')).toBe(false)
  })

  it('a throwing dispose does not stop the others', async () => {
    const { reg, log } = make()
    reg.registerModule(mod('a', { dispose: () => { log.push('a') } }))
    reg.registerModule(mod('b', { dispose: () => { throw new Error('x') } }))
    await reg.start()
    expect(() => reg.stop()).not.toThrow()
    expect(log).toEqual(['a'])
  })

  it('init failing leaves that module inactive, the rest run', async () => {
    const { reg, log } = make()
    reg.registerModule(mod('a', { init: () => { throw new Error('x') }, dispose: () => { log.push('dispose a') } }))
    reg.registerModule(mod('b', { init: () => { log.push('init b') } }))
    await reg.start()
    reg.stop()
    expect(log).toEqual(['init b'])
  })

  it('a module that needs a reload says so once its switch differs from the one at start', async () => {
    const { reg } = make()
    reg.registerModule(mod('legacy', { reload: true }))
    reg.registerModule(mod('live'))
    await reg.start()
    expect(reg.needsReload()).toEqual([])
    await reg.setEnabled('live', false)
    expect(reg.needsReload()).toEqual([])
    await reg.setEnabled('legacy', false)
    expect(reg.needsReload()).toEqual(['legacy'])
    await reg.setEnabled('legacy', true)
    expect(reg.needsReload()).toEqual([])
  })
})

describe('registry: heavy modules load only when on', () => {
  it('the loader is not called while disabled; called once on enable; its body is used', async () => {
    const load = vi.fn(async () => ({ init: () => { calls.push('init') }, views: [{ id: 'v', title: 'V', icon: 'x', mount: () => () => {} }] }))
    const calls = []
    const { reg } = make({ extensions: { h: false } })
    reg.registerModule(mod('h', { heavy: true, load, enabledByDefault: true }))
    await reg.start()
    expect(load).not.toHaveBeenCalled()
    expect(reg.views()).toEqual([])
    await reg.setEnabled('h', true)
    expect(load).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['init'])
    expect(reg.views().map((v) => v.id)).toEqual(['v'])
    await reg.setEnabled('h', false)
    await reg.setEnabled('h', true)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a disabled module adds no views and no settings sections', async () => {
    const { reg } = make({ extensions: { a: false } })
    reg.registerModule(mod('a', { views: [{ id: 'v', title: 'V', icon: 'x', mount: () => () => {} }], settings: () => [{ id: 's', title: 'S', rows: () => [] }] }))
    await reg.start()
    expect(reg.views()).toEqual([])
    expect(reg.settingsSections()).toEqual([])
  })
})

describe('bus', () => {
  it('on / emit / unsubscribe', () => {
    const bus = createBus()
    const got = []
    const off = bus.on('x', (d) => got.push(d))
    bus.emit('x', 1)
    off()
    bus.emit('x', 2)
    expect(got).toEqual([1])
  })
})
