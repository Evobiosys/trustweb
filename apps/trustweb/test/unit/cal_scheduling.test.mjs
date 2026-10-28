// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar scheduling (wave 24, cal5): busy intervals, snapshots, team intersection, the two link kinds, accept. Pure. */
import { acceptBooking, busyOf, decodeBookLink, decodeBookedLink, encodeBookLink, encodeBookedLink, freeSlots, keepHeld, snapshot } from '../../src/ext/calendar/scheduling.ts'

const H = 3_600_000
const win = (day, from = '09:00', to = '17:00') => ({ day, from, to })
const WEEK = [0, 1, 2, 3, 4].map((d) => win(d))
const snap = (o = {}) => ({ name: 'Ada', tz: 'UTC', windows: WEEK, slotMin: 60, busy: [], at: 0, ...o })
const mon = Date.UTC(2026, 10, 2) // Monday 2026-11-02 00:00 UTC

describe('busyOf', () => {
  const t = (iso) => new Date(iso).getTime()
  it('a timed event without end lasts one hour; names never appear', () => {
    const b = busyOf([{ id: 'e', name: 'Secret', from: '2026-11-02T10:00', where: 'Home', createdAt: 0, attended: true }], t('2026-11-01T00:00'), 14)
    expect(b).toEqual([{ s: t('2026-11-02T10:00'), e: t('2026-11-02T11:00') }])
    expect(JSON.stringify(b)).not.toContain('Secret')
  })
  it('a date-only event blocks the whole day, a range every day', () => {
    const b = busyOf([{ id: 'e', name: 'x', from: '2026-11-03', to: '2026-11-04', where: '', createdAt: 0, attended: true }], t('2026-11-01T00:00'), 14)
    expect(b).toEqual([{ s: t('2026-11-03T00:00'), e: t('2026-11-05T00:00') }])
  })
  it('leaves out what lies outside the horizon', () => {
    expect(busyOf([{ id: 'e', name: 'x', from: '2026-12-25', where: '', createdAt: 0, attended: true }], t('2026-11-01T00:00'), 14)).toEqual([])
  })
})

describe('freeSlots', () => {
  it('slots inside the windows, one hour each, weekends empty', () => {
    const s = freeSlots([snap()], mon, 7, 60)
    expect(s.length).toBe(5 * 8)
    expect(s[0]).toEqual({ s: mon + 9 * H, e: mon + 10 * H })
  })
  it('busy removes slots and partial overlap removes the slot', () => {
    const s = freeSlots([snap({ busy: [{ s: mon + 9 * H + 1, e: mon + 11 * H }] })], mon, 1, 60)
    expect(s[0].s).toBe(mon + 11 * H)
    expect(s.length).toBe(6)
  })
  it('a team is the intersection', () => {
    const b = snap({ name: 'Ben', windows: [win(0, '13:00', '15:00')] })
    expect(freeSlots([snap(), b], mon, 1, 60).map((x) => x.s)).toEqual([mon + 13 * H, mon + 14 * H])
  })
  it('two time zones: windows are read in each snapshot own zone', () => {
    // Vienna is UTC+1 in November: 09-17 there = 08-16 UTC; Auckland UTC+13: 09-17 there = Sunday 20:00 .. Monday 04:00 UTC -> no overlap on Monday
    const vie = snap({ tz: 'Europe/Vienna' })
    expect(freeSlots([vie], mon, 1, 60)[0].s).toBe(mon + 8 * H)
    const nyc = snap({ tz: 'America/New_York' }) // UTC-5 in November: 14-22 UTC
    expect(freeSlots([vie, nyc], mon, 1, 60).map((x) => x.s)).toEqual([mon + 14 * H, mon + 15 * H])
  })
  it('Europe/Vienna across the DST change of 2026-10-25: 09:00 local moves from 07:00 UTC to 08:00 UTC', () => {
    const vie = snap({ tz: 'Europe/Vienna', windows: [win(5, '09:00', '10:00'), win(6, '09:00', '10:00'), win(0, '09:00', '10:00')] })
    const sat = Date.UTC(2026, 9, 24)
    const s = freeSlots([vie], sat, 4, 60) // Sat 24 .. Tue 27
    expect(s.map((x) => x.s)).toEqual([Date.UTC(2026, 9, 24, 7), Date.UTC(2026, 9, 25, 8), Date.UTC(2026, 9, 26, 8)])
  })
  it('slots before the start time are dropped', () => {
    expect(freeSlots([snap()], mon + 12 * H, 1, 60).map((x) => x.s)[0]).toBe(mon + 12 * H)
  })
})

describe('snapshot', () => {
  const ev = { id: 'e', name: 'Dentist', from: '2026-11-02T10:00', where: 'Graz', createdAt: 0, attended: true }
  const state = (o = {}) => ({ me: { displayName: 'Jakob' }, events: [ev], availability: { windows: WEEK }, ...o })
  it('is null when availability is not set up', () => {
    expect(snapshot(state({ availability: undefined }), 0, 'UTC')).toBeNull()
  })
  it('carries name, tz, windows, default slot 30, rounded busy and nothing about the event', () => {
    const s = snapshot(state(), new Date('2026-11-01T00:00').getTime(), 'UTC')
    expect(s.name).toBe('Jakob'); expect(s.tz).toBe('UTC'); expect(s.slotMin).toBe(30)
    expect(s.busy.length).toBe(1)
    expect(JSON.stringify(s)).not.toContain('Dentist'); expect(JSON.stringify(s)).not.toContain('Graz')
  })
})

describe('book link', () => {
  const payload = { v: 1, owner: { name: 'Jakob', did: 'did:x' }, snaps: [snap()], id: 'abc123' }
  it('round-trips', () => {
    const link = encodeBookLink('https://app.trustweb.one', payload)
    expect(link.startsWith('https://app.trustweb.one/#book=')).toBe(true)
    expect(decodeBookLink(new URL(link).hash)).toEqual(payload)
  })
  it('rejects garbage, wrong version, bad tz, bad windows, oversize', () => {
    expect(decodeBookLink('#book=!!!')).toBeNull()
    expect(decodeBookLink('')).toBeNull()
    const bad = (p) => decodeBookLink(new URL(encodeBookLink('https://x', p)).hash)
    expect(bad({ ...payload, v: 2 })).toBeNull()
    expect(bad({ ...payload, snaps: [snap({ tz: 'Nowhere/Land' })] })).toBeNull()
    expect(bad({ ...payload, snaps: [snap({ windows: [win(9)] })] })).toBeNull()
    expect(bad({ ...payload, snaps: [snap({ windows: [win(1, '25:00', '26:00')] })] })).toBeNull()
    expect(bad({ ...payload, snaps: [snap({ busy: Array.from({ length: 900 }, (_, i) => ({ s: i * 7e6, e: i * 7e6 + 3e6 })) })] })).toBeNull()
  })
})

describe('booked link and accept', () => {
  const booked = { v: 1, id: 'abc123', slot: { s: mon + 9 * H, e: mon + 10 * H }, from: { name: 'Eva', did: 'did:eva' }, note: 'hello' }
  const state = (o = {}) => ({ bookLinks: [{ id: 'abc123', at: 0, held: [] }], events: [], people: [{ id: 'p1', name: 'Eva', did: 'did:eva' }], ...o })
  it('round-trips and rejects garbage', () => {
    expect(decodeBookedLink(new URL(encodeBookedLink('https://x', booked)).hash)).toEqual(booked)
    expect(decodeBookedLink('#booked=zz')).toBeNull()
    expect(decodeBookedLink(new URL(encodeBookedLink('https://x', { ...booked, slot: { s: 5, e: 1 } })).hash)).toBeNull()
  })
  it('accept builds a local-time event with the matching person', () => {
    const ev = acceptBooking(state(), booked, 'ev1', 7)
    expect(ev.id).toBe('ev1'); expect(ev.name).toContain('Eva'); expect(ev.people).toEqual(['p1'])
    expect(ev.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(new Date(ev.from).getTime()).toBe(booked.slot.s)
    expect(new Date(ev.to).getTime()).toBe(booked.slot.e)
  })
  it('an unknown link id gives no event', () => {
    expect(acceptBooking(state({ bookLinks: [] }), booked, 'ev1', 7)).toBeNull()
    expect(acceptBooking(state({ bookLinks: undefined }), booked, 'ev1', 7)).toBeNull()
  })
})

describe('keepHeld', () => {
  it('stores one snapshot per person, a newer one replaces it', () => {
    const s = { people: [{ id: 'p1', name: 'Ada', did: 'did:a' }] }
    keepHeld(s, snap(), 'did:a', 5)
    keepHeld(s, snap({ at: 9 }), 'did:a', 9)
    expect(s.heldAvailability).toHaveLength(1)
    expect(s.heldAvailability[0]).toMatchObject({ personId: 'p1', name: 'Ada', at: 9 })
  })
})
