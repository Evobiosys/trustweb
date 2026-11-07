// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28: the TrustZones view (trustzones.ts): filters, archived, tones, community source, zzz groups, accept (engagement.ts dueMoves / releaseTies). */
import { Ring } from '../../src/model.ts'
import { angleOf, ringsGeometry, lapRadius } from '../../src/rings_layout.ts'
import { DAY_MS, dueMoves, releaseTies } from '../../src/engagement.ts'
import { ringShown, setRingShown } from '../../src/rings_filter.ts'
import { TONE_ORDER, communityTags, filledRings, inZones, isArchived, moveKinds, openRings, toggleRing, toneIndex, toneVar, zoneFor } from '../../src/trustzones.ts'
import { pinnedOrder } from '../../src/membranes_five.ts'
import { S } from '../../src/strings.ts'
import { readFileSync } from 'node:fs'

const NOW = Date.UTC(2026, 10, 1, 12)
const person = (o = {}) => ({ id: 'p1', name: 'Anna', context: '', ring: Ring.Close, metAt: 0, peerId: 'pe1', ...o })

describe('dots keep their axis', () => {
  it('a ring change moves the dot radially: the angle comes from the person, never from the ring or its neighbours', () => {
    const p = person({ id: 'x', angle: 123 })
    const before = angleOf(p)
    p.ring = Ring.Friend
    expect(angleOf(p)).toBe(before)
    const g = ringsGeometry({ [Ring.Close]: 1, [Ring.Friend]: 1 })
    expect(lapRadius(g, Ring.Friend, 0)).toBeGreaterThan(lapRadius(g, Ring.Close, 0))
  })
  it('without a stored angle the spot is fixed from the id (stable)', () => {
    expect(angleOf({ id: 'abc' })).toBe(angleOf({ id: 'abc' }))
  })
})

describe('zzz suggestions need a tap', () => {
  const quiet = (o = {}) => ({ people: [person(o)], engagementSince: NOW - 40 * DAY_MS, engagementDays: 0 })
  it('dueMoves only suggests: nothing moves, also with expiry off (30-day default)', () => {
    const s = quiet()
    expect(dueMoves(s, NOW).map((m) => [m.person.id, m.to])).toEqual([['p1', Ring.Friend]])
    expect(s.people[0].ring).toBe(Ring.Close)
    expect(releaseTies(s, NOW)).toEqual([])
    expect(s.people[0].ring).toBe(Ring.Close)
  })
  it('accepting one writes the ring of that person only', () => {
    const s = { people: [person(), person({ id: 'p2', peerId: 'pe2' })], engagementSince: NOW - 40 * DAY_MS }
    expect(releaseTies(s, NOW, new Set(['p1'])).map((r) => r.personId)).toEqual(['p1'])
    expect(s.people.map((p) => p.ring)).toEqual([Ring.Friend, Ring.Close])
  })
  it('accept all of a kind: groups by from > to; a second kind stays', () => {
    const s = { people: [person(), person({ id: 'p2', peerId: 'pe2' }), person({ id: 'p3', peerId: 'pe3', ring: Ring.Friend })], engagementSince: NOW - 40 * DAY_MS }
    const kinds = moveKinds(dueMoves(s, NOW))
    expect(kinds).toEqual([{ from: Ring.Close, to: Ring.Friend, ids: ['p1', 'p2'] }, { from: Ring.Friend, to: Ring.Acquaintance, ids: ['p3'] }])
    releaseTies(s, NOW, new Set(kinds[0].ids))
    expect(s.people.map((p) => p.ring)).toEqual([Ring.Friend, Ring.Friend, Ring.Friend])
  })
  it('an accepted move starts a fresh window: the next ring is not suggested at once', () => {
    const s = quiet()
    releaseTies(s, NOW, new Set(['p1']))
    expect(dueMoves(s, NOW)).toEqual([])
    expect(dueMoves(s, NOW + 31 * DAY_MS).map((m) => m.to)).toEqual([Ring.Acquaintance])
  })
  it('a recent contact raises no marker', () => {
    expect(dueMoves({ people: [person({ metAt: NOW - DAY_MS })], engagementSince: NOW - 40 * DAY_MS }, NOW)).toEqual([])
  })
})

describe('fill all', () => {
  it('default fill = acquaintances; pressing fills, pressing again collapses; idempotent per state', () => {
    const s = {}
    expect(filledRings(s)).toEqual([Ring.Acquaintance])
    toggleRing(s, 'filled', Ring.Friend)
    expect(filledRings(s)).toEqual([Ring.Acquaintance, Ring.Friend])
    toggleRing(s, 'filled', Ring.Friend)
    expect(filledRings(s)).toEqual([Ring.Acquaintance])
  })
  it('closest few list is open by default and collapsible', () => {
    const s = {}
    expect(openRings(s)).toEqual([Ring.Closest])
    toggleRing(s, 'open', Ring.Closest)
    expect(openRings(s)).toEqual([])
  })
})

describe('orange gradient tokens', () => {
  it('six rungs, strongest inside, the outermost grey; every rung its own token', () => {
    expect(TONE_ORDER.map(toneIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(TONE_ORDER.map(toneVar)).size).toBe(6)
    const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
    const tone = (n) => css.match(new RegExp(`--ring-${n}:\\s*(#[0-9a-fA-F]{6})`))[1]
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) }
    const ls = [0, 1, 2, 3, 4].map((i) => lum(tone(i)))
    expect(ls).toEqual([...ls].sort((a, b) => a - b))
    expect(new Set(ls.map(Math.round)).size).toBe(5)
    const g = parseInt(tone(5).slice(1), 16)
    expect([g >> 16, (g >> 8) & 255, g & 255].every((c, _, a) => c === a[0])).toBe(true)
  })
})

describe('who the zones show', () => {
  const ppl = [person({ id: 'a', ring: Ring.Acquaintance }), person({ id: 'u', ring: Ring.Unsorted }), person({ id: 'x', ring: Ring.None }), person({ id: 'b', blocked: 5 }), person({ id: 'c' })]
  it('archived (Not in my web) and blocked are never shown; every ring is shown by default', () => {
    expect(isArchived(ppl[2])).toBe(true)
    expect(inZones(ppl, {}).map((p) => p.id)).toEqual(['a', 'u', 'c'])
    expect(ringShown({}, Ring.Unsorted)).toBe(true)
  })
  it('the filters save in uiRings and change the result', () => {
    const s = {}
    setRingShown(s, Ring.Unsorted, false); setRingShown(s, Ring.Acquaintance, false)
    expect(inZones(ppl, s).map((p) => p.id)).toEqual(['c'])
  })
})

describe('community tag source', () => {
  it('flagged colour tags; none flagged = all colour tags', () => {
    const a = { id: 'a', colour: '#111111' }, b = { id: 'b', colour: '#222222', community: true }
    expect(communityTags([a, b])).toEqual([b])
    expect(communityTags([a])).toEqual([a])
  })
  it('an acquainted holder of the picked tag joins the friends and community zone; others stay', () => {
    const holder = person({ ring: Ring.Acquaintance, fields: { t1: 'true' } })
    expect(zoneFor(holder, 't1')).toBe(Ring.Friend)
    expect(zoneFor(holder, null)).toBe(Ring.Acquaintance)
    expect(zoneFor(person({ ring: Ring.Acquaintance }), 't1')).toBe(Ring.Acquaintance)
  })
})

describe('pinned first, wording', () => {
  it('pinned people sort ahead of everyone (the list shows them above the zones)', () => {
    const ps = [person({ id: 'a' }), person({ id: 'b', pinned: true, pinnedAt: 5 })]
    expect(pinnedOrder(ps, 'pinned', () => 0)[0].id).toBe('b')
  })
  it('the ring view is TrustZones; zone words follow the ladder', () => {
    expect(S.webTitle).toBe('TrustZones')
    expect([Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending].map((r) => S.ringLabel[r])).toEqual(['Closest few', 'Close friends and allies', 'Friends & acquainted community members', 'Acquaintances', 'Intending to connect'])
    expect(S.ringHint[Ring.Acquaintance]).toBe('you have been in contact with')
    expect(S.ringHint[Ring.Friend]).toBe('community members per tag')
  })
})
