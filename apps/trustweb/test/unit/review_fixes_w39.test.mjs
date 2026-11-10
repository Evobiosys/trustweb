// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 review fixes: screen gate for switched-off parts, registry races, undo across imports that touched the same person. */
import { Ring } from '../../src/model.ts'
import { planServices, commitPlan, decide } from '../../src/services_import.ts'
import { previewUndo, undoBatches } from '../../src/import_curate.ts'
import { createRegistry, createBus } from '../../src/ext/tw_registry.ts'
import { gateScreen } from '../../src/screen_gate.ts'
import { syntheticVcf } from '../fixtures/synthetic_contacts.mjs'

describe('screen gate: a switched-off part is never shown (deep links, card buttons)', () => {
  const all = { events: true, inventory: true, feed: true, resources: true }
  it('passes every screen while everything is on', () => {
    for (const s of ['web', 'events', 'inventory', 'feed', 'notes', 'chat']) expect(gateScreen(s, all)).toBe(s)
  })
  it('sends Events, Resources, Feed to the Web when off; Notes follows the Resources module', () => {
    expect(gateScreen('events', { ...all, events: false })).toBe('web')
    expect(gateScreen('inventory', { ...all, inventory: false })).toBe('web')
    expect(gateScreen('feed', { ...all, feed: false })).toBe('web')
    expect(gateScreen('notes', { ...all, resources: false })).toBe('web')
    expect(gateScreen('notes', { ...all, inventory: false })).toBe('notes')
    expect(gateScreen('chat', { events: false, inventory: false, feed: false, resources: false })).toBe('chat')
  })
})

describe('registry: switches flipped while a heavy module loads', () => {
  const ctx = () => ({ store: () => ({}), strings: {}, bus: createBus(), navigate: () => {}, profile: () => 'full' })
  function make() {
    let tw
    const reg = createRegistry({ settings: () => tw, save: (t) => { tw = t }, ctx })
    return reg
  }
  it('off before the load finished: never initialised, no view', async () => {
    const reg = make()
    const log = []
    let release
    const gate = new Promise((r) => { release = r })
    reg.registerModule({ id: 'h', title: 'h', kind: 'view', enabledByDefault: false, heavy: true,
      load: async () => { await gate; return { views: [{ id: 'hv', title: 'hv', icon: 'x', mount: () => () => {} }], init: () => { log.push('init') }, dispose: () => { log.push('dispose') } } } })
    const on = reg.setEnabled('h', true)
    const off = reg.setEnabled('h', false)
    release()
    await Promise.all([on, off])
    expect(reg.isEnabled('h')).toBe(false)
    expect(reg.views()).toEqual([])
    expect(log.filter((x) => x === 'init').length - log.filter((x) => x === 'dispose').length).toBe(0)
  })
  it('two syncs at once initialise a module once', async () => {
    const reg = make()
    let inits = 0
    reg.registerModule({ id: 'h', title: 'h', kind: 'view', enabledByDefault: true, heavy: true, load: async () => ({ init: () => { inits++ } }) })
    await Promise.all([reg.start(), reg.sync(), reg.sync()])
    expect(inits).toBe(1)
  })
})

describe('undo across imports that touched the same person', () => {
  const NOW = Date.UTC(2026, 10, 10)
  let n = 0
  const newId = () => `p${++n}`
  const second = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Alma Brandt', 'N:;Alma Brandt;;;', 'EMAIL:test.01@example.org', 'CATEGORIES:Choir', 'UID:x1', 'END:VCARD', ''].join('\r\n')
  function twoImports() {
    const s = { people: [], serviceImports: [] }
    commitPlan(s, planServices(s, [{ name: 'a.vcf', text: syntheticVcf() }], { me: 'Me', now: NOW }), 'b1', NOW)
    for (const r of s.serviceImports[0].rows.slice(0, 3)) decide(s, 'b1', r.key, { do: 'accept' }, NOW, newId)
    commitPlan(s, planServices(s, [{ name: 'b.vcf', text: second }], { me: 'Me', now: NOW + 86_400_000 }), 'b2', NOW + 86_400_000)
    const b2 = s.serviceImports.find((b) => b.id === 'b2')
    decide(s, 'b2', b2.rows[0].key, { do: 'accept' }, NOW + 86_400_000, newId)
    return s
  }
  it('a later import is not an edit by the owner', () => {
    const s = twoImports()
    expect(s.people).toHaveLength(3)
    expect(previewUndo(s, ['b1']).edited).toEqual([])
  })
  it('undoing both (ticked oldest first) leaves nobody kept and no import tag behind', () => {
    const s = twoImports()
    const r = undoBatches(s, ['b1', 'b2'])
    expect(r.kept).toBe(0)
    expect(s.people.every((p) => p.ring === Ring.None)).toBe(true)
    expect(s.people.every((p) => !Object.keys(p.fields ?? {}).some((k) => k.startsWith('import:') || k === 'choir'))).toBe(true)
  })
  it('an owner edit after both imports still keeps the person', () => {
    const s = twoImports()
    s.people[0].generalNote = 'mine'
    const r = undoBatches(s, ['b2', 'b1'])
    expect(r.keptIds).toContain(s.people[0].id)
    expect(s.people[0].ring).not.toBe(Ring.None)
  })
  it('a newer import that moved the ring does not bring an archived person back', () => {
    const s = { people: [], serviceImports: [] }
    commitPlan(s, planServices(s, [{ name: 'a.vcf', text: syntheticVcf() }], { me: 'Me', now: NOW }), 'b1', NOW)
    decide(s, 'b1', s.serviceImports[0].rows[0].key, { do: 'accept' }, NOW, newId)
    commitPlan(s, planServices(s, [{ name: 'b.vcf', text: second }], { me: 'Me', now: NOW + 86_400_000 }), 'b2', NOW + 86_400_000)
    const b2 = s.serviceImports.find((b) => b.id === 'b2')
    b2.rows[0].ring = Ring.Friend
    decide(s, 'b2', b2.rows[0].key, { do: 'accept' }, NOW + 86_400_000, newId)
    expect(s.people[0].ring).toBe(Ring.Friend)
    undoBatches(s, ['b1', 'b2'])
    expect(s.people[0].ring).toBe(Ring.None)
  })
})
