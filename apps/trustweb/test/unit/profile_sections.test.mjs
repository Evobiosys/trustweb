// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** E3 profile sections (profile.ts): one scope per section, one check (canAccess) for preview, send and auto-send. */
import {
  ONE_MAX, PROFILE_ITEM, PROFILE_SECTIONS, SECTION_DEFAULT_ZONE, SECTION_FIELDS, SECTION_KEYS, buildProfileText, parseProfileText, previewSection,
  profileStore, receiveProfileText, repairProfile, scopeOf, sectionOf, sectionOpen, setOne, setScope, sliceFor, sliceForViewer,
} from '../../src/profile.ts'
import { Ring } from '../../src/model.ts'

const APP = 'https://app.example.org/'
const NOW_MS = Date.parse('2026-11-01T10:00:00.000Z')
const NOW = new Date(NOW_MS)
const PIC = 'data:image/jpeg;base64,' + 'A'.repeat(200)
const d = (text) => ({ text, at: NOW_MS, by: 'me' })
/** Short values, so a whole profile fits one message and nothing is dropped. */
const full = (extra = {}) => ({
  norms: [{ norm: 'text-first', text: '', at: NOW_MS, by: 'me' }], favourite: d('a walk'), intro: d('hi'), interests: d('moss'), availability: d('eves'),
  website: d('probe.example.org'), offers: d('talks'), working: d('seeds'), address: d('1 Probe Ln'), pictureId: 'pic1', pictureAt: NOW_MS, ...extra,
})
const P = (id, name, ring, extra = {}) => ({ id, name, ring, ...extra })
const basis = {
  people: [
    P('ada', 'Ada Probe', Ring.Friend), P('bo', 'Bo Test', Ring.Acquaintance, { fields: { garden: 'true' } }), P('cy', 'Cy Sample', Ring.Close),
    P('di', 'Di Example', Ring.Intending, { events: ['ev1'] }), P('eli', 'Eli Mock', Ring.Unsorted),
  ],
  tags: [{ id: 'garden', colour: '#00aa00', label: 'garden' }],
  events: [{ id: 'ev1', name: 'Probe Forum' }],
}
const scope = (zone, include = [], exclude = []) => ({ zone, include, exclude })
const who = (p, section) => basis.people.filter((x) => sectionOpen(p, section, { kind: 'person', id: x.id }, basis, NOW)).map((x) => x.id)
const seen = (p, viewer) => SECTION_KEYS.filter((k) => sectionOpen(p, k, viewer, basis, NOW))

describe('the sections', () => {
  it('six sections in table order; every profile field sits in exactly one', () => {
    expect(SECTION_KEYS).toEqual(['picture', 'about', 'contact', 'address', 'work', 'availability'])
    expect(SECTION_FIELDS.about).toEqual(['intro', 'interests'])
    expect(SECTION_FIELDS.contact).toEqual(['norms', 'favourite'])
    expect(SECTION_FIELDS.work).toEqual(['website', 'offers', 'working'])
    const all = SECTION_KEYS.flatMap((k) => SECTION_FIELDS[k])
    expect([...all].sort()).toEqual([...PROFILE_SECTIONS].sort())
    expect(new Set(all).size).toBe(all.length)
    for (const f of all) expect(SECTION_FIELDS[sectionOf(f)]).toContain(f)
    expect(PROFILE_ITEM('work')).toBe('profile:work')
  })
  it('defaults: picture and address Friends, work Public, the rest Acquaintances', () => {
    expect(SECTION_DEFAULT_ZONE).toEqual({ picture: 'friend', about: 'acquaintance', contact: 'acquaintance', address: 'friend', work: 'public', availability: 'acquaintance' })
    for (const k of SECTION_KEYS) expect(scopeOf(undefined, k)).toEqual(scope(SECTION_DEFAULT_ZONE[k]))
  })
})

describe('scopeOf: the stored scope, else the legacy per-field audience', () => {
  it('the legacy zone is the least reach among the section\'s fields that have one; nobody is only me', () => {
    expect(scopeOf({ norms: [], audience: { website: 'acquaintance', offers: 'friend' } }, 'work')).toEqual(scope('friend'))
    expect(scopeOf({ norms: [], audience: { norms: 'public', favourite: 'close' } }, 'contact')).toEqual(scope('close'))
    expect(scopeOf({ norms: [], audience: { intro: 'public' } }, 'about')).toEqual(scope('public'))
    expect(scopeOf({ norms: [], audience: { address: 'nobody' } }, 'address')).toEqual(scope('self'))
    expect(scopeOf({ norms: [], audience: { website: 'public', working: 'nobody' } }, 'work')).toEqual(scope('self'))
    expect(scopeOf({ norms: [], audience: { intro: 'close' } }, 'work')).toEqual(scope('public'))
  })
  it('a stored scope wins over the legacy audience', () => {
    const p = { norms: [], audience: { website: 'nobody' }, sections: { work: scope('friend', ['tag:garden'], ['person:ada']) } }
    expect(scopeOf(p, 'work')).toEqual(scope('friend', ['tag:garden'], ['person:ada']))
  })
  it('setScope stores a copy and retires the legacy audience of that section only', () => {
    const p = { norms: [], audience: { website: 'nobody', intro: 'close' } }
    const s = scope('close', ['event:ev1'])
    setScope(p, 'work', s)
    s.include.push('person:ada')
    expect(scopeOf(p, 'work')).toEqual(scope('close', ['event:ev1']))
    expect(p.audience).toEqual({ intro: 'close' })
    expect(scopeOf(p, 'about')).toEqual(scope('close'))
  })
})

describe('sectionOpen: the share sink check on profile:<section>', () => {
  it('profileStore holds each section\'s scope tuples, since now so they never expire on the owner', () => {
    const store = profileStore(full(), basis, NOW)
    for (const k of SECTION_KEYS) expect(store.some((t) => t.object === PROFILE_ITEM(k) && t.relation === 'may_read' && t.since === NOW.toISOString())).toBe(true)
    expect(store).toContainEqual(expect.objectContaining({ subject: 'person:di', relation: 'has_tag', object: 'event:ev1' }))
  })
  it('by zone: Acquaintances and closer see About; Intending does not', () => {
    expect(who(full(), 'about')).toEqual(['ada', 'bo', 'cy'])
    expect(who(full(), 'work')).toEqual(['ada', 'bo', 'cy', 'di'])
  })
  it('by colour tag, by event, and an exclusion beats the zone', () => {
    const p = full()
    setScope(p, 'address', scope('close', ['tag:garden']))
    expect(who(p, 'address')).toEqual(['bo', 'cy'])
    setScope(p, 'work', scope('self', ['event:ev1']))
    expect(who(p, 'work')).toEqual(['di'])
    setScope(p, 'about', scope('acquaintance', [], ['person:ada', 'tag:garden']))
    expect(who(p, 'about')).toEqual(['cy'])
  })
  it('someone with no ring (Unsorted) gets no zone grant, even Public, only an explicit include (wave 20: no zone, no profile)', () => {
    expect(who(full(), 'work')).not.toContain('eli')
    const p = full({ sections: { work: scope('public', ['person:eli']) } })
    expect(who(p, 'work')).toContain('eli')
  })
  it('the tag and event viewers see ONLY sections whose include names them or whose zone is Public', () => {
    const p = full({
      sections: {
        picture: scope('friend', ['tag:garden']), contact: scope('close', ['event:ev1']), work: scope('public'),
        availability: scope('acquaintance', ['tag:garden', 'event:ev1']), address: scope('self', [], ['tag:garden']),
      },
    })
    expect(seen(p, { kind: 'tag', id: 'garden' })).toEqual(['picture', 'work', 'availability'])
    expect(seen(p, { kind: 'event', id: 'ev1' })).toEqual(['contact', 'work', 'availability'])
    expect(seen(p, { kind: 'tag', id: 'nowhere' })).toEqual(['work'])
    expect(seen(p, { kind: 'zone', zone: 'friend' })).toEqual(['picture', 'about', 'work', 'availability'])
  })
})

describe('sliceForViewer: what goes is what the check opens', () => {
  it('equals what buildProfileText would send to each person, picture only where the picture section opens', () => {
    const p = full({ sections: { work: scope('self', ['event:ev1']), about: scope('acquaintance', [], ['person:ada']) } })
    for (const x of basis.people) {
      const s = sliceForViewer(p, { kind: 'person', id: x.id }, basis, NOW, PIC)
      const t = buildProfileText(APP, p, x, PIC, basis)
      if (!s) { expect(t).toBeNull(); continue }
      expect(t.length).toBeLessThanOrEqual(480)
      expect(parseProfileText(APP, t, NOW_MS, s.picture)).toEqual(s)
    }
    expect(sliceForViewer(p, { kind: 'person', id: 'cy' }, basis, NOW, PIC).picture).toBe(PIC)
    expect(sliceForViewer(p, { kind: 'person', id: 'bo' }, basis, NOW, PIC).picture).toBeUndefined()
    expect(sliceForViewer(p, { kind: 'person', id: 'ada' }, basis, NOW).intro).toBeUndefined()
    expect(sliceForViewer(p, { kind: 'person', id: 'di' }, basis, NOW).working).toBe('seeds')
    expect(sliceForViewer(p, { kind: 'person', id: 'eli' }, basis, NOW)).toBeNull()
  })
  it('a zone viewer is the legacy sliceFor; no profile, nothing', () => {
    for (const z of ['close', 'friend', 'acquaintance', 'intending', 'public']) expect(sliceForViewer(full(), { kind: 'zone', zone: z }, basis, NOW, PIC)).toEqual(sliceFor(full(), z, PIC))
    expect(sliceForViewer(undefined, { kind: 'zone', zone: 'close' }, basis, NOW)).toBeNull()
  })
})

describe('previewSection: who would see a section under a scope', () => {
  it('count == the number of people for whom sectionOpen is true, with their names; the profile is untouched', () => {
    const p = full()
    for (const s of [scope('friend'), scope('close', ['tag:garden']), scope('self', ['event:ev1']), scope('acquaintance', [], ['person:bo']), scope('public')]) {
      const pv = previewSection(p, 'work', s, basis, NOW)
      const q = full()
      setScope(q, 'work', s)
      const open = basis.people.filter((x) => sectionOpen(q, 'work', { kind: 'person', id: x.id }, basis, NOW))
      expect(pv.count).toBe(open.length)
      expect(pv.names).toEqual(open.map((x) => x.name))
    }
    expect(previewSection(p, 'work', scope('close', ['tag:garden']), basis, NOW).names).toEqual(['Bo Test', 'Cy Sample'])
    expect(p.sections).toBeUndefined()
  })
})

describe('the new fields on the wire', () => {
  it('interests and availability round-trip under their short keys', () => {
    const p = { norms: [], interests: d('moss, kites'), availability: d('weekday evenings') }
    const t = buildProfileText(APP, p)
    const body = JSON.parse(decodeURIComponent(t.split('#p=')[1]))
    expect(body.r).toBe('moss, kites')
    expect(body.v).toBe('weekday evenings')
    expect(parseProfileText(APP, t, NOW_MS)).toEqual({ norms: [], interests: 'moss, kites', availability: 'weekday evenings', at: NOW_MS })
    const card = {}
    expect(receiveProfileText(APP, card, t, NOW_MS)).toBe(true)
    expect(card.theirProfile.availability).toBe('weekday evenings')
  })
  it('one line of 100 at most each; interests go first when the message is too long', () => {
    expect(ONE_MAX.interests).toBe(100)
    expect(ONE_MAX.availability).toBe(100)
    const p = { norms: [] }
    setOne(p, 'interests', 'x'.repeat(150), NOW_MS)
    expect(p.interests.text).toHaveLength(100)
    const long = { norms: [], interests: d('€'.repeat(100)), availability: d('eves'), website: d('probe.example.org') }
    const got = parseProfileText(APP, buildProfileText(APP, long), NOW_MS)
    expect(got.interests).toBeUndefined()
    expect([got.availability, got.website]).toEqual(['eves', 'probe.example.org'])
  })
})

describe('repairProfile and the sections', () => {
  it('drops a bad scope on its own, keeps the good ones and the profile', () => {
    const good = scope('friend', ['tag:garden', 'event:ev1'], ['person:ada'])
    const s = {
      profile: full({
        sections: {
          work: good, about: scope('everyone'), contact: scope('close', ['mallory']), address: { zone: 'close', include: [], exclude: 'x' },
          availability: { zone: 'close', include: [7], exclude: [] }, bogus: scope('close'),
        },
      }),
    }
    expect(repairProfile(s)).toBe(true)
    expect(s.profile.sections).toEqual({ work: good })
    expect(s.profile.intro.text).toBe('hi')
    expect(repairProfile(s)).toBe(false)
    const self = { profile: full({ sections: { address: scope('self') } }) }
    expect(repairProfile(self)).toBe(false)
    const junk = { profile: full({ sections: 'x' }) }
    expect(repairProfile(junk)).toBe(true)
    expect(junk.profile.sections).toBeUndefined()
    expect(junk.profile.norms).toHaveLength(1)
  })
  it('a bad new field drops the profile like any other bad entry', () => {
    const s = { profile: { norms: [], interests: { text: 5 } } }
    expect(repairProfile(s)).toBe(true)
    expect(s.profile).toBeUndefined()
  })
})
