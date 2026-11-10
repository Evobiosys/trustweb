// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 community-mode: interface state, the event suggestion rule, the community bar and saved layouts (src/ext/community_mode/mode.ts). */
import {
  COMM_ITEMS, DEFAULT_ITEMS, parseInterface, resolveInterface, setDefaultInterface, parseModeData, mergeModeData,
  suggestForEvent, dismissSuggestion, communityBar, setItems, toggleItem, saveVersion, restoreVersion, removeVersion, moveItem,
} from '../../src/ext/community_mode/mode.ts'
import { switchProfile } from '../../src/ext/profiles.ts'

const NOW = new Date(2026, 10, 10, 14, 0).getTime()
const ev = (o = {}) => ({ id: 'e1', name: 'Gathering', from: '2026-11-10', where: 'Hall', createdAt: 1, attended: true, ...o })

describe('interface state', () => {
  it('parseInterface accepts only the two names', () => {
    expect(parseInterface('community')).toBe('community')
    expect(parseInterface('personal')).toBe('personal')
    expect(parseInterface('x')).toBeNull()
    expect(parseInterface(null)).toBeNull()
  })

  it('this session\'s pick beats the profile default, which beats personal', () => {
    expect(resolveInterface(undefined, null)).toBe('personal')
    const tw = setDefaultInterface(undefined, 'full', 'community')
    expect(resolveInterface(tw, null)).toBe('community')
    expect(resolveInterface(tw, 'personal')).toBe('personal')
    expect(resolveInterface({ profile: 'reader', interfaces: { full: 'community' } }, null)).toBe('personal')
  })

  it('the default is kept per profile and by switching profiles', () => {
    let tw = setDefaultInterface(undefined, 'full', 'community')
    tw = setDefaultInterface(tw, 'iyg-support', 'personal')
    expect(tw.interfaces).toEqual({ full: 'community', 'iyg-support': 'personal' })
    const defaults = { events: true }
    const back = switchProfile(switchProfile(tw, 'reader', defaults), 'full', defaults)
    expect(back.interfaces).toEqual(tw.interfaces)
    expect(resolveInterface(back, null)).toBe('community')
  })

  it('setDefaultInterface does not mutate and ignores unknown values', () => {
    const tw = { profile: 'full' }
    expect(setDefaultInterface(tw, 'full', 'community')).not.toBe(tw)
    expect(tw).toEqual({ profile: 'full' })
    expect(setDefaultInterface(tw, 'full', 'bogus')).toBe(tw)
  })
})

describe('event suggestion', () => {
  const base = { mode: 'personal', data: {}, now: NOW, rsvp: undefined }
  it('suggests an event I am going to that is today', () => {
    expect(suggestForEvent({ ...base, events: [ev()] })).toEqual({ id: 'e1', name: 'Gathering' })
  })
  it('a multi-day event counts on each of its days', () => {
    expect(suggestForEvent({ ...base, events: [ev({ from: '2026-11-08', to: '2026-11-11' })] })?.id).toBe('e1')
    expect(suggestForEvent({ ...base, events: [ev({ from: '2026-11-08', to: '2026-11-09' })] })).toBeNull()
  })
  it('not today, not going, or already in Community: nothing', () => {
    expect(suggestForEvent({ ...base, events: [ev({ from: '2026-11-11' })] })).toBeNull()
    expect(suggestForEvent({ ...base, events: [ev({ attended: false })] })).toBeNull()
    expect(suggestForEvent({ ...base, mode: 'community', events: [ev()] })).toBeNull()
  })
  it('a Going answer in the events module counts, a Maybe does not', () => {
    expect(suggestForEvent({ ...base, events: [ev({ attended: false })], rsvp: { e1: 'going' } })?.id).toBe('e1')
    expect(suggestForEvent({ ...base, events: [ev({ attended: false })], rsvp: { e1: 'maybe' } })).toBeNull()
  })
  it('Not now holds for today only; Never holds for good and only for that event', () => {
    const later = dismissSuggestion({}, 'e1', 'later', NOW)
    expect(suggestForEvent({ ...base, data: later, events: [ev()] })).toBeNull()
    const tomorrow = NOW + 24 * 3600 * 1000
    expect(suggestForEvent({ ...base, data: later, now: tomorrow, events: [ev({ to: '2026-11-12' })] })?.id).toBe('e1')
    const never = dismissSuggestion(later, 'e1', 'never', NOW)
    expect(suggestForEvent({ ...base, data: never, now: tomorrow, events: [ev({ to: '2026-11-12' })] })).toBeNull()
    expect(suggestForEvent({ ...base, data: never, events: [ev(), ev({ id: 'e2', name: 'Other' })] })).toEqual({ id: 'e2', name: 'Other' })
  })
  it('an undated or malformed event never suggests', () => {
    expect(suggestForEvent({ ...base, events: [ev({ from: 'soon' }), ev({ from: '' })] })).toBeNull()
    expect(suggestForEvent({ ...base, events: undefined })).toBeNull()
  })
})

describe('community bar and saved layouts', () => {
  it('default bar: Home, Spaces, Events, Members, Docs, Chat, Web', () => {
    expect(COMM_ITEMS).toEqual(['home', 'spaces', 'events', 'members', 'docs', 'chat', 'web'])
    expect(communityBar({}, [])).toEqual(DEFAULT_ITEMS)
  })
  it('the Community module\'s own menu switches take items out of the bar; Web stays', () => {
    expect(communityBar({}, ['docs', 'chat'])).toEqual(['home', 'spaces', 'events', 'members', 'web'])
  })
  it('a chosen set keeps its order; unknown and double entries drop; an empty set falls back', () => {
    expect(communityBar({ items: ['events', 'web', 'home'] }, [])).toEqual(['events', 'web', 'home'])
    expect(setItems({}, ['web', 'x', 'web', 'home']).items).toEqual(['web', 'home'])
    expect(communityBar(setItems({ items: ['home'] }, []), [])).toEqual(DEFAULT_ITEMS)
  })
  it('moveItem swaps one place and stops at the ends', () => {
    expect(moveItem({}, 'spaces', -1).items.slice(0, 2)).toEqual(['spaces', 'home'])
    expect(moveItem({}, 'home', -1).items).toEqual(DEFAULT_ITEMS)
    expect(moveItem({}, 'web', 1).items).toEqual(DEFAULT_ITEMS)
  })
  it('toggleItem takes an item out or appends it back; the last item stays', () => {
    const out = toggleItem({}, 'docs')
    expect(communityBar(out, [])).toEqual(['home', 'spaces', 'events', 'members', 'chat', 'web'])
    expect(communityBar(toggleItem(out, 'docs'), []).at(-1)).toBe('docs')
    expect(toggleItem({ items: ['web'] }, 'web').items).toEqual(['web'])
  })
  it('Save as my version keeps the items; Use restores them; the version outlives later edits', () => {
    const d1 = setItems({}, ['events', 'members', 'web'])
    const d2 = saveVersion(d1, '  Festival  ', 'v1')
    expect(d2.versions).toEqual([{ id: 'v1', name: 'Festival', items: ['events', 'members', 'web'] }])
    const edited = setItems(d2, ['home', 'chat'])
    expect(communityBar(restoreVersion(edited, 'v1'), [])).toEqual(['events', 'members', 'web'])
    expect(restoreVersion(edited, 'nope')).toBe(edited)
    expect(edited.versions).toHaveLength(1)
  })
  it('an empty name becomes "My version"; the same id overwrites; remove drops one', () => {
    const d = saveVersion(setItems({}, ['home', 'web']), '', 'v1')
    expect(d.versions[0].name).toBe('My version')
    const again = saveVersion(setItems(d, ['chat', 'web']), 'Two', 'v1')
    expect(again.versions).toEqual([{ id: 'v1', name: 'Two', items: ['chat', 'web'] }])
    expect(removeVersion(again, 'v1').versions).toEqual([])
  })
})

describe('slice check and merge', () => {
  it('parseModeData keeps only valid fields', () => {
    const d = parseModeData({
      items: ['home', 'x'], suggest: { never: ['a', 3], notNow: { b: '2026-11-10', c: 5 } },
      versions: [{ id: 'v', name: 'N', items: ['web', 'zz'] }, { id: 1 }, null], junk: true,
    })
    expect(d).toEqual({ items: ['home'], suggest: { never: ['a'], notNow: { b: '2026-11-10' } }, versions: [{ id: 'v', name: 'N', items: ['web'] }] })
    expect(parseModeData('x')).toEqual({})
  })
  it('two devices: Never unions, versions join by id, the incoming items win', () => {
    const a = { items: ['home'], suggest: { never: ['a'] }, versions: [{ id: 'v1', name: 'A', items: ['home'] }] }
    const b = { items: ['web'], suggest: { never: ['b'], notNow: { c: '2026-11-10' } }, versions: [{ id: 'v2', name: 'B', items: ['web'] }] }
    const m = mergeModeData(a, b)
    expect(m.suggest.never.sort()).toEqual(['a', 'b'])
    expect(m.suggest.notNow).toEqual({ c: '2026-11-10' })
    expect(m.versions.map((v) => v.id).sort()).toEqual(['v1', 'v2'])
    expect(m.items).toEqual(['web'])
  })
})
