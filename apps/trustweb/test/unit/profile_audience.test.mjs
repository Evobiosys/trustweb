/** Wave 19 (Jakob 2026-10-23): each profile section is shared with a ring and closer (profile.ts profileFor); 'nobody' hides it from everyone. */
import { DEFAULT_AUDIENCE, buildProfileText, parseProfileText, profileFor, repairProfile } from '../../src/profile.ts'
import { CLOSENESS_KEY, Ring } from '../../src/model.ts'

const APP = 'https://app.trustintheweb.org/'
const NOW = 1_800_000_000_000
const d = (text) => ({ text, at: NOW, by: 'me' })
const full = (audience) => ({ norms: [{ norm: 'text-first', text: '', at: NOW, by: 'me' }], favourite: d('a walk'), intro: d('hi'), audience })
const who = (ring, closeness) => ({ ring, fields: closeness ? { [CLOSENESS_KEY]: closeness } : undefined })
const sections = (s) => (s ? ['norms', 'favourite', 'intro'].filter((k) => (k === 'norms' ? s.norms.length > 0 : s[k] !== undefined)) : [])

describe('profileFor', () => {
  it('defaults every section to acquaintances: everyone in the rings sees all, as before', () => {
    expect(DEFAULT_AUDIENCE).toBe('acquaintance')
    for (const r of [Ring.Close, Ring.Friend, Ring.Acquaintance]) expect(sections(profileFor(full(), who(r)))).toEqual(['norms', 'favourite', 'intro'])
  })
  it('close sees all, acquaintance only what is open to acquaintances', () => {
    const p = full({ norms: 'acquaintance', favourite: 'friend', intro: 'close' })
    expect(sections(profileFor(p, who(Ring.Close)))).toEqual(['norms', 'favourite', 'intro'])
    expect(sections(profileFor(p, who(Ring.Friend)))).toEqual(['norms', 'favourite'])
    expect(sections(profileFor(p, who(Ring.Acquaintance)))).toEqual(['norms'])
  })
  it("'nobody' hides a section even from close", () => {
    expect(sections(profileFor(full({ intro: 'nobody' }), who(Ring.Close)))).toEqual(['norms', 'favourite'])
    expect(profileFor(full({ norms: 'nobody', favourite: 'nobody', intro: 'nobody' }), who(Ring.Close))).toBeNull()
  })
  it('family counts as the ring of its closeness (Close when unset)', () => {
    const p = full({ norms: 'acquaintance', favourite: 'friend', intro: 'close' })
    expect(sections(profileFor(p, who(Ring.Family)))).toEqual(['norms', 'favourite', 'intro'])
    expect(sections(profileFor(p, who(Ring.Family, Ring.Friend)))).toEqual(['norms', 'favourite'])
    expect(sections(profileFor(p, who(Ring.Family, Ring.Acquaintance)))).toEqual(['norms'])
    expect(profileFor(p, who(Ring.Family, Ring.Intending))).toBeNull()
  })
  it('intending, not in my web and unsorted get nothing', () => {
    for (const r of [Ring.Intending, Ring.None, Ring.Unsorted]) expect(profileFor(full(), who(r))).toBeNull()
  })
  it('the wire text carries only the sections the person may see, dated by the newest of those', () => {
    const p = full({ intro: 'close' })
    p.intro.at = NOW + 5
    const t = buildProfileText(APP, p, who(Ring.Friend))
    const got = parseProfileText(APP, t, NOW + 10)
    expect(got.intro).toBeUndefined()
    expect(got.favourite).toBe('a walk')
    expect(got.at).toBe(NOW)
    expect(buildProfileText(APP, p, who(Ring.Intending))).toBeNull()
  })
})

describe('repairProfile and the audience', () => {
  it('keeps a valid audience, drops an unknown one and keeps the profile', () => {
    const ok = { profile: full({ intro: 'nobody' }) }
    expect(repairProfile(ok)).toBe(false)
    const bad = { profile: full({ intro: 'everyone', norms: 'close' }) }
    expect(repairProfile(bad)).toBe(true)
    expect(bad.profile.audience).toEqual({ norms: 'close' })
    const junk = { profile: full('x') }
    expect(repairProfile(junk)).toBe(true)
    expect(junk.profile.audience).toBeUndefined()
    expect(junk.profile.intro.text).toBe('hi')
  })
})
