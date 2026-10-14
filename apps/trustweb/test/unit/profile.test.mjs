/** My profile (src/profile.ts, wave 7): norms, dating, staleness, the wire text and its untrusted-input boundary. */
import { Norm, addNorm, buildProfileText, isProfileText, isStale, parseProfileText, receiveProfileText, removeNorm, repairProfile, setOne, toShared, STALE_AFTER_MS } from '../../src/profile.ts'
import { routeText, TextKind } from '../../src/chat.ts'
import { offerLines } from '../../src/profile_view.ts'
import { Audience } from '../../src/model.ts'

const APP = 'https://app.trustintheweb.org/'
const NOW = 1_800_000_000_000

describe('norms and entries', () => {
  it('adds dated "by me" entries, refuses duplicates, empty custom and a sixth norm', () => {
    const p = { norms: [] }
    expect(addNorm(p, Norm.TextFirst, '', NOW)).toBe(true)
    expect(p.norms[0]).toMatchObject({ norm: 'text-first', at: NOW, by: 'me' })
    expect(addNorm(p, Norm.TextFirst, '', NOW)).toBe(false)
    expect(addNorm(p, Norm.Custom, '  ', NOW)).toBe(false)
    expect(addNorm(p, 'nonsense', 'x', NOW)).toBe(false)
    for (const t of ['a', 'b', 'c', 'd']) addNorm(p, Norm.Custom, t, NOW)
    expect(p.norms).toHaveLength(5)
    expect(addNorm(p, Norm.CallMe, '', NOW)).toBe(false)
    removeNorm(p, 0)
    expect(p.norms).toHaveLength(4)
  })
  it('sets and clears the favourite way and the intro', () => {
    const p = { norms: [] }
    setOne(p, 'intro', '  Hi   there ', NOW)
    expect(p.intro).toEqual({ text: 'Hi there', at: NOW, by: 'me' })
    setOne(p, 'intro', '', NOW)
    expect(p.intro).toBeUndefined()
  })
  it('is stale after 90 days, not before', () => {
    expect(isStale(NOW - STALE_AFTER_MS, NOW)).toBe(false)
    expect(isStale(NOW - STALE_AFTER_MS - 1, NOW)).toBe(true)
  })
})

describe('the wire', () => {
  const mine = { norms: [{ norm: Norm.TextFirst, text: '', at: NOW - 5, by: 'me' }, { norm: Norm.Custom, text: 'Ümlaut & more', at: NOW - 9, by: 'me' }], favourite: { text: 'a walk', at: NOW - 1, by: 'me' }, intro: { text: 'Hello', at: NOW - 2, by: 'me' } }
  it('round-trips, dated by the newest entry', () => {
    const t = buildProfileText(APP, mine)
    expect(isProfileText(APP, t)).toBe(true)
    expect(parseProfileText(APP, t, NOW)).toEqual({ norms: [{ norm: 'text-first', text: '' }, { norm: 'custom', text: 'Ümlaut & more' }], favourite: 'a walk', intro: 'Hello', at: NOW - 1 })
    expect(toShared(mine).at).toBe(NOW - 1)
  })
  it('sends nothing for an empty profile and always fits one message', () => {
    expect(buildProfileText(APP, undefined)).toBeNull()
    expect(buildProfileText(APP, { norms: [] })).toBeNull()
    const wide = { norms: ['ö'.repeat(40), 'ü'.repeat(40), 'ä'.repeat(40), 'é'.repeat(40), 'ß'.repeat(40)].map((text) => ({ norm: Norm.Custom, text, at: NOW, by: 'me' })), intro: { text: '€'.repeat(100), at: NOW, by: 'me' } }
    expect(buildProfileText(APP, wide).length).toBeLessThanOrEqual(480)
  })
  it('routes as Profile, never as chat', () => {
    expect(routeText(APP, buildProfileText(APP, mine))).toBe(TextKind.Profile)
    expect(routeText(APP, `${APP}?profile=1#p=garbage`)).toBe(TextKind.Ignore)
  })
  it.each([
    ['another prefix', 'https://evil.example/?profile=1#p=%7B%7D'], ['not JSON', `${APP}?profile=1#p=%7Bnope`], ['broken escape', `${APP}?profile=1#p=%E0%A4%A`],
    ['no content', `${APP}?profile=1#p=${encodeURIComponent('{"n":[["bogus","x"]],"at":1}')}`], ['a number', 7],
  ])('reads nothing from %s, without throwing', (_n, text) => expect(parseProfileText(APP, text, NOW)).toBeNull())
  it('cleans what arrives: unknown norms dropped, hidden characters stripped, a future date clamped', () => {
    const raw = { n: [['bogus', 'x'], ['custom', 'A‮B\u0007'], ['custom', '']], f: 'x'.repeat(99), at: NOW + 1e9 }
    const got = parseProfileText(APP, `${APP}?profile=1#p=${encodeURIComponent(JSON.stringify(raw))}`, NOW)
    expect(got.norms).toEqual([{ norm: 'custom', text: 'AB' }])
    expect(got.favourite).toHaveLength(40)
    expect(got.at).toBe(NOW)
  })
  it('receiving is idempotent', () => {
    const person = {}
    const t = buildProfileText(APP, mine)
    expect(receiveProfileText(APP, person, t, NOW)).toBe(true)
    expect(receiveProfileText(APP, person, t, NOW)).toBe(false)
  })
})

describe('record and view helpers', () => {
  it('repairs a profile of the wrong shape', () => {
    const s = { profile: { norms: 'x' } }
    expect(repairProfile(s)).toBe(true)
    expect(s.profile).toBeUndefined()
    expect(repairProfile({ profile: { norms: [] } })).toBe(false)
    expect(repairProfile({})).toBe(false)
  })
  it('offers only included lines acquaintances may ask about', () => {
    const item = (text, audience, included = true) => ({ id: text, text, audience, included, createdAt: 0 })
    const got = offerLines([item('a', Audience.FriendsOfFriends), item('b', Audience.Close), item('c', Audience.FriendsOfFriends, false)])
    expect(got.map((i) => i.text)).toEqual(['a'])
  })
})
