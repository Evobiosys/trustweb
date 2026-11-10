// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 ai-edit-chat: the app's actions (src/app_actions.ts) on a synthetic record, each applied and undone. */
import { createActions } from '../../src/actions.ts'
import { defineAppActions, PLACES, PLACE_TARGET } from '../../src/app_actions.ts'
import { Ring } from '../../src/model.ts'
import { planServices, commitPlan, pendingProposals } from '../../src/services_import.ts'
import { NAMES, syntheticVcf } from '../fixtures/synthetic_contacts.mjs'

const NOW = Date.UTC(2026, 10, 10)

function setup() {
  const s = {
    people: [
      { id: 'p1', name: 'Ada Lovelace', context: '', ring: Ring.Friend, metAt: 0, lines: [] },
      { id: 'p2', name: 'Bo Tester', context: 'met at a fair', ring: Ring.Acquaintance, metAt: 0, lines: [], fields: { iyg: 'true' } },
    ],
    serviceImports: [],
    twSettings: undefined,
  }
  commitPlan(s, planServices(s, [{ name: 'contacts.vcf', text: syntheticVcf() }], { me: 'Me', now: NOW }), 'b1', NOW)
  const log = []
  const host = {
    tagsSaved: 0,
    tagList: [{ id: 'iyg', colour: '#2e7d32', label: 'IYG' }],
    lookNow: 'default', profileNow: 'full', ext: { feed: true }, settings: { 'system-tags': false }, placeNow: 'web',
    state: () => s,
    save: () => log.push('save'),
    changed: () => log.push('changed'),
    open: (place, personId) => { host.placeNow = place; log.push(`open:${place}${personId ? ':' + personId : ''}`) },
    place: () => host.placeNow,
    tap: (sel) => (sel === '[data-x]' ? 'X button' : null),
    tags: () => host.tagList,
    saveTags: (t) => { host.tagList = [...t]; host.tagsSaved++ },
    look: () => host.lookNow,
    setLook: (l) => { host.lookNow = l },
    profile: () => host.profileNow,
    setProfile: (p) => { host.profileNow = p },
    modules: () => ['feed', 'events', 'assistant'],
    isEnabled: (id) => host.ext[id] ?? true,
    setExtension: (id, on) => { host.ext[id] = on },
    setting: (k) => host.settings[k],
    setSetting: (k, v) => { host.settings[k] = v },
    saveTw: (tw) => { s.twSettings = tw },
    newId: (() => { let n = 0; return () => `n${++n}` })(),
    now: () => NOW,
  }
  const a = createActions()
  defineAppActions(a, host)
  return { a, s, host, log }
}

const ok = (a, type, args) => { const r = a.check({ type, args }); if (!r.ok) throw new Error(r.error); return r.action }

describe('app actions: people', () => {
  it('set-ring by id or by unique name; undo puts the ring back', () => {
    const { a, s } = setup()
    const d = a.run(ok(a, 'set-ring', { person: 'Ada Lovelace', ring: 'close' }))
    expect(d.label).toBe('Ring of Ada Lovelace: Close')
    expect(s.people[0].ring).toBe(Ring.Close)
    d.undo()
    expect(s.people[0].ring).toBe(Ring.Friend)
    expect(a.check({ type: 'set-ring', args: { person: 'p1', ring: 'boss' } }).ok).toBe(false)
  })

  it('an unknown person fails at apply, nothing changes', () => {
    const { a, s } = setup()
    expect(() => a.run(ok(a, 'set-ring', { person: 'Nobody', ring: 'close' }))).toThrow('no person "Nobody"')
    expect(s.people.map((p) => p.ring)).toEqual([Ring.Friend, Ring.Acquaintance])
  })

  it('add-tag uses an existing tag by label, creates a missing one; undo takes both away', () => {
    const { a, s, host } = setup()
    const d1 = a.run(ok(a, 'add-tag', { person: 'p1', tag: 'iyg' }))
    expect(String(s.people[0].fields.iyg)).toBe('true')
    expect(host.tagsSaved).toBe(0)
    d1.undo()
    expect(s.people[0].fields ?? {}).toEqual({})
    const d2 = a.run(ok(a, 'add-tag', { person: 'p1', tag: 'Padel friends' }))
    expect(host.tagList.map((t) => t.id)).toEqual(['iyg', 'padel-friends'])
    expect(String(s.people[0].fields['padel-friends'])).toBe('true')
    expect(d2.label).toBe('Tag Ada Lovelace #Padel friends')
    d2.undo()
    expect(host.tagList.map((t) => t.id)).toEqual(['iyg'])
  })

  it('remove-tag and its undo', () => {
    const { a, s } = setup()
    const d = a.run(ok(a, 'remove-tag', { person: 'p2', tag: 'IYG' }))
    expect(s.people[1].fields?.iyg).toBeUndefined()
    d.undo()
    expect(String(s.people[1].fields.iyg)).toBe('true')
  })

  it('set-field writes name, context, the only-me note or a field; undo restores', () => {
    const { a, s } = setup()
    const d1 = a.run(ok(a, 'set-field', { person: 'p2', field: 'context', value: 'padel club' }))
    expect(s.people[1].context).toBe('padel club')
    d1.undo()
    expect(s.people[1].context).toBe('met at a fair')
    const d2 = a.run(ok(a, 'set-field', { person: 'p1', field: 'company', value: 'Analytical Engines' }))
    expect(s.people[0].fields.company).toBe('Analytical Engines')
    d2.undo()
    expect(s.people[0].fields?.company).toBeUndefined()
    expect(a.check({ type: 'set-field', args: { person: 'p1', field: 'ring', value: 'x' } }).ok).toBe(false)
    expect(a.check({ type: 'set-field', args: { person: 'p1', field: '__proto__', value: 'x' } }).ok).toBe(false)
  })

  it('add-note appends to the only-me note; undo restores it', () => {
    const { a, s } = setup()
    const d = a.run(ok(a, 'add-note', { person: 'p1', text: 'Wrote the first program.' }))
    expect(s.people[0].generalNote).toBe('Wrote the first program.')
    a.run(ok(a, 'add-note', { person: 'p1', text: 'Likes poetry.' }))
    expect(s.people[0].generalNote).toBe('Wrote the first program.\nLikes poetry.')
    d.undo()
    expect(s.people[0].generalNote).toBe('Likes poetry.')
  })

  it('create-group-tag defines the tag and tags its members; undo takes it all back', () => {
    const { a, s, host } = setup()
    const d = a.run(ok(a, 'create-group-tag', { label: 'Board', members: ['p1', 'Bo Tester'] }))
    expect(host.tagList.some((t) => t.id === 'board')).toBe(true)
    expect(s.people.map((p) => String(p.fields?.board))).toEqual(['true', 'true'])
    d.undo()
    expect(host.tagList.some((t) => t.id === 'board')).toBe(false)
    expect(s.people.map((p) => p.fields?.board)).toEqual([undefined, undefined])
  })
})

describe('app actions: import rows (before Accept)', () => {
  const first = (s) => pendingProposals(s, NOW).find((x) => x.row.name === NAMES[0])

  it('row-add-tag, row-set-ring, row-note change the staged row only; undo restores', () => {
    const { a, s } = setup()
    const key = first(s).row.key
    const before = JSON.stringify(first(s).row)
    const ds = [
      a.run(ok(a, 'row-add-tag', { row: key, tag: 'Board' })),
      a.run(ok(a, 'row-set-ring', { row: NAMES[0], ring: 'friend' })),
      a.run(ok(a, 'row-note', { row: key, text: 'from the conference' })),
    ]
    const row = first(s).row
    expect(row.labels).toContain('Board')
    expect(row.ring).toBe(Ring.Friend)
    expect(row.note).toContain('from the conference')
    expect(s.people).toHaveLength(2)
    for (const d of ds.reverse()) d.undo()
    expect(JSON.stringify(first(s).row)).toBe(before)
  })

  it('accept-row creates the person; undo takes them out and the row is pending again', () => {
    const { a, s } = setup()
    const key = first(s).row.key
    const d = a.run(ok(a, 'accept-row', { row: key }))
    expect(s.people.some((p) => p.name === NAMES[0])).toBe(true)
    expect(first(s)).toBeUndefined()
    d.undo()
    expect(s.people.some((p) => p.name === NAMES[0])).toBe(false)
    expect(first(s).row.key).toBe(key)
  })

  it('leave-row and its undo', () => {
    const { a, s } = setup()
    const key = first(s).row.key
    const d = a.run(ok(a, 'leave-row', { row: key }))
    expect(first(s)).toBeUndefined()
    d.undo()
    expect(first(s).row.key).toBe(key)
  })

  it('an unknown row fails at apply', () => {
    const { a } = setup()
    expect(() => a.run(ok(a, 'accept-row', { row: 'nope' }))).toThrow('no import row "nope"')
  })
})

describe('app actions: places, settings, looks, profiles', () => {
  it('open goes there; undo goes back; unknown places are rejected', () => {
    const { a, log, host } = setup()
    const d = a.run(ok(a, 'open', { place: 'variations' }))
    expect(log).toContain('open:variations')
    d.undo()
    expect(host.placeNow).toBe('web')
    a.run(ok(a, 'open', { place: 'person', person: 'Ada Lovelace' }))
    expect(log).toContain('open:person:p1')
    expect(a.check({ type: 'open', args: { place: 'javascript:alert(1)' } }).ok).toBe(false)
    for (const p of PLACES) expect(typeof PLACE_TARGET[p]).toBe('string')
  })

  it('tap: only data-attribute selectors, never auto-applied, not undoable', () => {
    const { a } = setup()
    const t = ok(a, 'tap', { selector: '[data-x]' })
    expect(t.auto).toBe(false)
    expect(t.undoable).toBe(false)
    expect(a.run(t).label).toBe('Tap [data-x]')
    expect(a.check({ type: 'tap', args: { selector: 'body' } }).ok).toBe(false)
    expect(a.check({ type: 'tap', args: { selector: '[onclick]' } }).ok).toBe(false)
    expect(() => a.run(ok(a, 'tap', { selector: '[data-gone]' }))).toThrow('nothing to tap')
  })

  it('set-look, set-profile, set-extension, set-setting go through the host and undo', () => {
    const { a, host } = setup()
    const l = a.run(ok(a, 'set-look', { look: 'sleek' }))
    expect(host.lookNow).toBe('sleek'); l.undo(); expect(host.lookNow).toBe('default')
    const p = a.run(ok(a, 'set-profile', { profile: 'reader' }))
    expect(host.profileNow).toBe('reader'); p.undo(); expect(host.profileNow).toBe('full')
    const e = a.run(ok(a, 'set-extension', { module: 'feed', on: false }))
    expect(host.ext.feed).toBe(false); e.undo(); expect(host.ext.feed).toBe(true)
    expect(a.check({ type: 'set-extension', args: { module: 'nope', on: true } }).ok).toBe(false)
    const st = a.run(ok(a, 'set-setting', { key: 'system-tags', on: true }))
    expect(host.settings['system-tags']).toBe(true); st.undo(); expect(host.settings['system-tags']).toBe(false)
    expect(a.check({ type: 'set-setting', args: { key: 'apiKey', on: true } }).ok).toBe(false)
    expect(a.check({ type: 'set-look', args: { look: 'neon' } }).ok).toBe(false)
  })

  it('set-profile to a variation that does not exist fails at apply', () => {
    const { a } = setup()
    expect(() => a.run(ok(a, 'set-profile', { profile: 'custom-ghost' }))).toThrow('no variation "custom-ghost"')
  })

  it('create-variation writes a named profile with a token overlay; undo takes it away', () => {
    const { a, s } = setup()
    const d = a.run(ok(a, 'create-variation', { name: 'Quiet reader', base: 'reader', modules: { feed: false }, look: 'sleek', tokens: { '--trust': '#335577', '--r-card': '4px' } }))
    expect(d.label).toBe('New variation "Quiet reader"')
    expect(s.twSettings.custom).toEqual([{ id: 'custom-quiet-reader', name: 'Quiet reader', base: 'reader', modules: { feed: false }, look: 'sleek', tokens: { '--trust': '#335577', '--r-card': '4px' } }])
    a.run(ok(a, 'set-profile', { profile: 'custom-quiet-reader' }))
    d.undo()
    expect(s.twSettings.custom ?? []).toEqual([])
  })

  it('create-variation drops unsafe tokens and unknown modules', () => {
    const { a } = setup()
    expect(a.check({ type: 'create-variation', args: { name: 'X', base: 'full', tokens: { '--trust': 'url(https://evil)' } } }).ok).toBe(false)
    expect(a.check({ type: 'create-variation', args: { name: 'X', base: 'full', tokens: { 'color': 'red' } } }).ok).toBe(false)
    expect(a.check({ type: 'create-variation', args: { name: 'X', base: 'full', modules: { nope: true } } }).ok).toBe(false)
    expect(a.check({ type: 'create-variation', args: { name: 'X', base: 'admin' } }).ok).toBe(false)
  })
})
