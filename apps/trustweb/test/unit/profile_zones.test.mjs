/** Wave 20 (Jakob 2026-10-23): profile sharing by trust zone, sent automatically (profile.ts sliceFor, zoneOf, autoSendRank). */
import { autoSendRank, buildProfileText, parseProfileText, profileFor, repairProfile, setOne, sliceFor, zoneOf, DEFAULT_AUDIENCE, PROFILE_AUDIENCES } from '../../src/profile.ts'
import { Ring } from '../../src/model.ts'

const APP = 'https://app.trustintheweb.org/'
const NOW = 1_800_000_000_000
const d = (text) => ({ text, at: NOW, by: 'me' })
const mine = (audience) => ({
  norms: [{ norm: 'text-first', text: '', at: NOW, by: 'me' }], favourite: d('a walk'), intro: d('hi'),
  website: d('japossert.com'), offers: d('talks, paid'), working: d('TrustWeb, seeking investment'), address: d('Geologengasse, Wien'), audience,
})
const keys = (s) => (s ? Object.keys(s).filter((k) => !['at', 'norms'].includes(k) && s[k] !== undefined).concat(s.norms.length ? ['norms'] : []).sort() : [])

describe('zoneOf', () => {
  it('maps the rings: close, friend, acquaintance, intending; family by its closeness; unsorted and none get no zone', () => {
    expect(zoneOf({ ring: Ring.Close })).toBe('close')
    expect(zoneOf({ ring: Ring.Friend })).toBe('friend')
    expect(zoneOf({ ring: Ring.Acquaintance })).toBe('acquaintance')
    expect(zoneOf({ ring: Ring.Intending })).toBe('intending')
    expect(zoneOf({ ring: Ring.Family })).toBe('close')
    expect(zoneOf({ ring: Ring.Unsorted })).toBeNull()
    expect(zoneOf({ ring: Ring.None })).toBeNull()
  })
  it('someone who reached me through my public address and still sits on Intending is public', () => {
    expect(zoneOf({ ring: Ring.Intending, reachedOut: 'received' })).toBe('public')
    expect(zoneOf({ ring: Ring.Intending, reachedOut: 'sent' })).toBe('intending')
    expect(zoneOf({ ring: Ring.Friend, reachedOut: 'received' })).toBe('friend')
  })
})

describe('sliceFor', () => {
  it('defaults: website, offers, working are public; address is friends; the older sections stay acquaintances', () => {
    expect(PROFILE_AUDIENCES).toContain('public')
    expect(DEFAULT_AUDIENCE).toBe('acquaintance')
    const p = mine()
    expect(keys(sliceFor(p, 'public'))).toEqual(['offers', 'website', 'working'])
    expect(keys(sliceFor(p, 'acquaintance'))).toEqual(['favourite', 'intro', 'norms', 'offers', 'website', 'working'])
    expect(keys(sliceFor(p, 'friend'))).toEqual(['address', 'favourite', 'intro', 'norms', 'offers', 'website', 'working'])
  })
  it('intending is the public slice, and so is a person reached through the public address', () => {
    const p = mine()
    expect(sliceFor(p, 'intending')).toEqual(sliceFor(p, 'public'))
    expect(profileFor(p, { ring: Ring.Intending, reachedOut: 'received' })).toEqual(sliceFor(p, 'public'))
  })
  it('closer rings get everything but what is set to nobody', () => {
    expect(keys(sliceFor(mine(), 'close'))).toEqual(['address', 'favourite', 'intro', 'norms', 'offers', 'website', 'working'])
    expect(keys(sliceFor(mine({ address: 'nobody', website: 'nobody' }), 'close'))).toEqual(['favourite', 'intro', 'norms', 'offers', 'working'])
  })
  it('a section at an audience goes to that zone and every closer one, never to a wider one', () => {
    const p = mine({ address: 'close', website: 'acquaintance', offers: 'friend' })
    expect(keys(sliceFor(p, 'public'))).toEqual(['working'])
    expect(keys(sliceFor(p, 'acquaintance'))).toEqual(['favourite', 'intro', 'norms', 'website', 'working'])
    expect(keys(sliceFor(p, 'friend'))).toEqual(['favourite', 'intro', 'norms', 'offers', 'website', 'working'])
  })
  it('the picture can be public; nobody-audience never leaves; no zone, no profile', () => {
    const pic = 'data:image/jpeg;base64,AAAA'
    expect(sliceFor(mine({ picture: 'public' }), 'public', pic).picture).toBe(pic)
    expect(sliceFor(mine(), 'public', pic).picture).toBeUndefined()
    expect(sliceFor(mine(), null)).toBeNull()
    expect(profileFor(mine(), { ring: Ring.Unsorted })).toBeNull()
    expect(sliceFor({ norms: [], audience: {} }, 'close')).toBeNull()
  })
})

describe('wire and edits', () => {
  it('a public slice travels and parses with the new sections only', () => {
    const t = buildProfileText(APP, mine(), 'public')
    const got = parseProfileText(APP, t, NOW + 1)
    expect([got.website, got.offers, got.working, got.address, got.intro]).toEqual(['japossert.com', 'talks, paid', 'TrustWeb, seeking investment', undefined, undefined])
  })
  it('setOne sets and clears the new sections; repairProfile keeps the public audience', () => {
    const p = { norms: [], audience: { website: 'public', address: 'bogus' } }
    setOne(p, 'address', ' Geologengasse,  Wien ', NOW)
    expect(p.address.text).toBe('Geologengasse, Wien')
    setOne(p, 'address', '', NOW)
    expect(p.address).toBeUndefined()
    const st = { profile: p }
    expect(repairProfile(st)).toBe(true)
    expect(st.profile.audience).toEqual({ website: 'public' })
  })
})

describe('autoSendRank', () => {
  it('sends the first time and when the person moved to a closer zone; never again outward or sideways', () => {
    expect(autoSendRank(undefined, 'public')).toBe(0)
    expect(autoSendRank(0, 'public')).toBeNull()
    expect(autoSendRank(0, 'intending')).toBeNull()
    expect(autoSendRank(0, 'friend')).toBe(2)
    expect(autoSendRank(2, 'acquaintance')).toBeNull()
    expect(autoSendRank(2, 'close')).toBe(3)
    expect(autoSendRank(3, 'friend')).toBeNull()
  })
})
