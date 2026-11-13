// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 settings-llm-first: the registry is the one table; every valued entry round-trips and is found by search. */
import { SETTINGS_REGISTRY, settingById, valued, readSetting, writeSetting, searchSettings, describeSetting } from '../../src/settings_registry.ts'
import { upgradeSwitches, simpleRows } from '../../src/settings_page.ts'

const sample = (d) => (d.type === 'boolean' ? !d.default : d.type === 'choice' ? d.choices.find((c) => c !== d.default) : d.type === 'number' ? 45 : 'x')

describe('settings registry', () => {
  it('ids are unique and every entry has a label, a section and a type', () => {
    const ids = SETTINGS_REGISTRY.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of SETTINGS_REGISTRY) { expect(d.label).toBeTruthy(); expect(d.section).toBeTruthy(); expect(['boolean', 'choice', 'number', 'text', 'action']).toContain(d.type) }
  })
  it('the short page holds at most 12 entries', () => {
    expect(SETTINGS_REGISTRY.filter((d) => d.simple).length).toBeLessThanOrEqual(12)
    expect(SETTINGS_REGISTRY.filter((d) => !d.simple).length).toBeGreaterThan(SETTINGS_REGISTRY.filter((d) => d.simple).length)
  })
  it('an empty record reads every valued entry as its default', () => {
    for (const d of valued()) expect(readSetting({}, d.id)).toBe(d.default)
  })
  it('every valued entry round-trips set -> get, and back to default', () => {
    for (const d of valued()) {
      const r = {}
      const v = sample(d)
      expect(writeSetting(r, d.id, v)).toBe(v)
      expect(readSetting(r, d.id)).toBe(v)
      writeSetting(r, d.id, d.default)
      expect(readSetting(r, d.id)).toBe(d.default)
    }
  })
  it('a value equal to the default leaves the record as it was (sparse storage)', () => {
    const r = { people: [] }
    for (const d of valued().filter((x) => x.id !== 'feed.on' && !x.id.startsWith('pins.') && x.id !== 'chats.hidden' && x.id !== 'birthdays.reminders' && x.id !== 'general.qrProfileOption' && x.id !== 'general.apkUpdates' && x.id !== 'general.notificationsOn' && x.id !== 'web.ringNames')) {
      writeSetting(r, d.id, sample(d)); writeSetting(r, d.id, d.default)
    }
    expect(r).toEqual({ people: [] })
  })
  it('stores in the shapes the app reads', () => {
    const r = {}
    writeSetting(r, 'features.events', false); expect(r.features).toEqual({ events: false })
    writeSetting(r, 'features.events', true); expect(r.features).toBeUndefined()
    writeSetting(r, 'notices.on', false); expect(r.dismissed).toEqual(['all-notices'])
    writeSetting(r, 'general.profileAuto', false); expect(r.profileAutoOff).toBe(true)
    writeSetting(r, 'chat.preferConsensual', false); expect(r.preferConsensual).toBe(false)
    writeSetting(r, 'pins.header.dnd', true); expect(r.uiPins).toEqual({ views: [], header: ['dnd'] })
    writeSetting(r, 'web.engagementDays', 30); expect(r.engagementDays).toBe(30)
    writeSetting(r, 'feed.on', true); expect(r.feed).toEqual({ on: true })
  })
  it('rejects unknown ids, wrong types, bad choices, out-of-range numbers and actions', () => {
    expect(() => writeSetting({}, 'nope', true)).toThrow(/unknown setting/)
    expect(() => writeSetting({}, 'chats.hidden', 'yes')).toThrow(/true or false/)
    expect(() => writeSetting({}, 'web.pinnedOrder', 'zzz')).toThrow(/one of/)
    expect(() => writeSetting({}, 'web.engagementDays', 999)).toThrow(/from 0 to 365/)
    expect(() => writeSetting({}, 'ui.bar', true)).toThrow(/action/)
    expect(() => readSetting({}, 'ui.ai')).toThrow(/action/)
  })
  it('every entry is found by search for its own label, and by section', () => {
    for (const d of SETTINGS_REGISTRY) expect(searchSettings(d.label).map((x) => x.id)).toContain(d.id)
    expect(searchSettings('').length).toBe(SETTINGS_REGISTRY.length)
    expect(searchSettings('BIRTHDAY').map((x) => x.id)).toContain('birthdays.reminders')
    expect(searchSettings('zzzzqq')).toEqual([])
  })
  it('describeSetting drops the functions and adds the value', () => {
    const d = describeSetting(settingById('chats.hidden'), { chatsHidden: true })
    expect(d).toMatchObject({ id: 'chats.hidden', value: true, type: 'boolean' })
    expect('get' in d).toBe(false)
    expect('value' in describeSetting(settingById('ui.bar'), {})).toBe(false)
  })
})

describe('settings page helpers', () => {
  it('simpleRows lists the simple entries with their current values', () => {
    const rows = simpleRows({ chatsHidden: true })
    expect(rows.every((x) => settingById(x.id).simple)).toBe(true)
    expect(rows.find((x) => x.id === 'chats.hidden').value).toBe(true)
    expect(rows.find((x) => x.id === 'ui.bar').type).toBe('action')
  })
  it('upgradeSwitches gives every native checkbox role=switch and the toggle class', () => {
    const mk = () => { const a = new Map(); return { checked: true, attrs: a, classes: new Set(), setAttribute: (k, v) => a.set(k, v), classList: { add: (c) => mk.last.classes.add(c) } } }
    const boxes = [mk(), mk()]
    boxes.forEach((b) => { b.classList.add = (c) => b.classes.add(c) })
    upgradeSwitches({ querySelectorAll: () => boxes })
    for (const b of boxes) { expect(b.attrs.get('role')).toBe('switch'); expect(b.classes.has('tr-switch')).toBe(true); expect(b.attrs.get('aria-checked')).toBe('true') }
  })
})
