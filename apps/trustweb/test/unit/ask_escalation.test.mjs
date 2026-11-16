// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-escalation: custom reach hops, "who was asked", the know-someone round, physical things need a place. */
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { HOP_CAP, HOPS_UNBOUNDED } from '../../../demo/src/types.ts'
import { reachChoice, reachFor, ReachChoice, effectiveMaxHops, askFields } from '../../src/hops.ts'
import { Ring } from '../../src/model.ts'
import { shownAskedNames, escalationTargets, knowItems, KNOW_NOTE_MAX, ASKED_NAMES_MAX } from '../../src/ask_escalation.ts'
import { placeCheck, setPhysical } from '../../src/physical_place.ts'

const BASE = { v: 1, t: 'query', from: { id: 'ann', displayName: 'Ann' }, templateId: 'free', templateVersion: 1, qid: 'q1', issuedAt: 1, freeText: 'Who has a ladder?' }
const roundTrip = (o) => decodeFromQr(encodeForQr(o))

describe('custom reach hops', () => {
  it('an explicit Custom stays Custom for 1, 2 and 3 (they used to fall back to the fixed choices)', () => {
    for (const n of [1, 2, 3, 4, HOP_CAP]) expect(reachChoice(n, true)).toBe(ReachChoice.Custom)
    expect(reachChoice(2)).toBe(ReachChoice.FriendsOfFriends)
    expect(reachChoice(HOPS_UNBOUNDED, true)).toBe(ReachChoice.NoLimit)
  })
  it('the hop count of a custom value is clamped to 1..HOP_CAP and travels', () => {
    expect(reachFor(ReachChoice.Custom, 5)).toBe(5)
    expect(reachFor(ReachChoice.Custom, 0)).toBe(1)
    expect(reachFor(ReachChoice.Custom, 99)).toBe(HOP_CAP)
    expect(reachFor(ReachChoice.Custom, 2.6)).toBe(3)
    expect(effectiveMaxHops(reachFor(ReachChoice.Custom, 5))).toBe(5)
    expect(askFields(5, 'rootABC123', '0123456789abcdef')).toEqual({ maxHops: 5, hop: 0, root: 'rootABC123', seen: ['0123456789abcdef'] })
  })
})

describe('who was asked (askedNames)', () => {
  const names = ['Ben', 'Cleo']
  it('only a Closest few or Close recipient sees the names, and only when the asker leaves it on', () => {
    expect(shownAskedNames(Ring.Closest, true, names)).toEqual(names)
    expect(shownAskedNames(Ring.Close, true, names)).toEqual(names)
    for (const r of [Ring.Friend, Ring.Acquaintance, Ring.Family, Ring.Unsorted]) expect(shownAskedNames(r, true, names)).toBeUndefined()
    expect(shownAskedNames(Ring.Closest, false, names)).toBeUndefined()
    expect(shownAskedNames(Ring.Closest, true, [])).toBeUndefined()
  })
  it('is bounded', () => {
    const many = Array.from({ length: ASKED_NAMES_MAX + 20 }, (_, i) => `P${i}`)
    expect(shownAskedNames(Ring.Close, true, many)).toHaveLength(ASKED_NAMES_MAX)
  })
  it('survives the wire; malformed rejects the envelope', () => {
    expect(roundTrip({ ...BASE, askedNames: names }).askedNames).toEqual(names)
    expect(roundTrip(BASE).askedNames).toBeUndefined()
    expect(roundTrip({ ...BASE, askedNames: [] })).toBeNull()
    expect(roundTrip({ ...BASE, askedNames: ['ok', 5] })).toBeNull()
    expect(roundTrip({ ...BASE, askedNames: 'Ben' })).toBeNull()
    expect(roundTrip({ ...BASE, askedNames: Array.from({ length: ASKED_NAMES_MAX + 1 }, () => 'x') })).toBeNull()
  })
})

describe('escalate: do you know someone who has this?', () => {
  it('kind know needs no target; an intro still needs one; unknown kinds are rejected', () => {
    expect(roundTrip({ ...BASE, kind: 'know' }).kind).toBe('know')
    expect(roundTrip({ ...BASE, kind: 'know', target: 'x' })).toBeNull()
    expect(roundTrip({ ...BASE, kind: 'intro' })).toBeNull()
    expect(roundTrip({ ...BASE, kind: 'intro', target: 'Ana' }).target).toBe('Ana')
    expect(roundTrip({ ...BASE, kind: 'nope' })).toBeNull()
  })
  const people = [
    { id: 'a', peerId: 'pa', ring: Ring.Closest, fields: {} }, { id: 'b', peerId: 'pb', ring: Ring.Close, fields: {} },
    { id: 'c', peerId: 'pc', ring: Ring.Friend, fields: {} }, { id: 'd', ring: Ring.Close, fields: {} },
  ]
  const none = () => false
  it('targets the chosen zone and narrower, connected only, minus those who already shared and the hidden', () => {
    expect(escalationTargets(people, 'close', [], [], none).sort()).toEqual(['pa', 'pb'])
    expect(escalationTargets(people, 'friend', [], [], none).sort()).toEqual(['pa', 'pb', 'pc'])
    expect(escalationTargets(people, 'friend', ['pb'], [], none).sort()).toEqual(['pa', 'pc'])
    expect(escalationTargets(people, 'friend', [], ['person:a'], none).sort()).toEqual(['pb', 'pc'])
  })
  it('a tip is one shared item, bounded and trimmed; empty gives none', () => {
    expect(knowItems('  Ana, 555  ', 'a tip', 'now')).toEqual([{ text: 'Ana, 555', context: 'a tip', when: 'now' }])
    expect(knowItems('x'.repeat(KNOW_NOTE_MAX + 50), 'c', 'w')[0].text).toHaveLength(KNOW_NOTE_MAX)
    expect(knowItems('   ', 'c', 'w')).toEqual([])
    expect(knowItems(undefined, 'c', 'w')).toEqual([])
  })
})

describe('physical things need a place', () => {
  const item = (extra = {}) => ({ id: 'i', text: 'Ladder', ...extra })
  it('placeCheck: a physical thing without a place asks first; everything else is fine', () => {
    expect(placeCheck(item())).toBe('ok')
    expect(placeCheck(item({ physical: true, place: 'Garage, Linz' }))).toBe('ok')
    expect(placeCheck(item({ physical: true }))).toBe('needs-place')
    expect(placeCheck(item({ physical: true, place: '   ' }))).toBe('needs-place')
  })
  it('setPhysical stores the place trimmed; no place and no confirmation changes nothing', () => {
    const i = item()
    expect(setPhysical(i, true, '  Garage ', false)).toBe('ok')
    expect(i).toMatchObject({ physical: true, place: 'Garage' })
    const j = item()
    expect(setPhysical(j, true, '', false)).toBe('needs-place')
    expect(j.physical).toBeUndefined()
    expect(setPhysical(j, true, '', true)).toBe('ok')
    expect(j.physical).toBe(true)
    expect(j.place).toBeUndefined()
    expect(setPhysical(j, false, '', false)).toBe('ok')
    expect(j.physical).toBeUndefined()
    expect(j.place).toBeUndefined()
  })
})
