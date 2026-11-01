// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 share wording: typeahead modes (none / @ / #), the tag's people (3 + more), profiles and their default, archived people. */
import { candidates, suggest, withChip, initial, membersOf, MEMBERS_PEEK } from '../../src/share_page.ts'
import { saveProfile, removeProfile, applyProfile } from '../../src/share_profiles.ts'
import { basisOf } from '../../src/share_page_view.ts'
import { Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'

const P = (id, name, ring, fields) => ({ id, name, ring, ...(fields && { fields }) })
const tags = [{ id: 'garden', colour: '#00aa00', label: 'garden' }]
const people = [P('ada', 'Ada', Ring.Friend, { garden: 'true' }), P('bo', 'Bo', Ring.Acquaintance, { garden: 'true' }), P('cy', 'Cy', Ring.Close, { garden: 'true' }),
  P('di', 'Di', Ring.Friend, { garden: 'true' }), P('ed', 'Ed', Ring.Friend), P('gardener', 'Gardener Gus', Ring.Friend)]
const basis = { people, tags }
const c = candidates(basis)
const ids = (l) => l.map((x) => x.id)

describe('typeahead modes', () => {
  it('no prefix: people and tags', () => {
    expect(ids(suggest('gard', c, []))).toEqual(expect.arrayContaining(['tag:garden', 'person:gardener']))
  })
  it('@ only people, # only tags', () => {
    expect(ids(suggest('@gard', c, []))).toEqual(['person:gardener'])
    expect(ids(suggest('#gard', c, []))).toEqual(['tag:garden'])
  })
  it('a bare @ or # lists that kind', () => {
    expect(suggest('@', c, []).every((x) => x.id.startsWith('person:'))).toBe(true)
    expect(ids(suggest('#', c, []))).toEqual(['tag:garden'])
  })
  it('nothing typed: nothing offered', () => expect(suggest('', c, [])).toEqual([]))
})

describe('a tag shows its people', () => {
  it('lists all tagged people, the peek is 3', () => {
    expect(MEMBERS_PEEK).toBe(3)
    expect(membersOf(basis, 'tag:garden').map((m) => m.name)).toEqual(['Ada', 'Bo', 'Cy', 'Di'])
  })
  it('archived people are left out of the basis (G5)', () => {
    const store = { 'trustweb-crm.v1.me': JSON.stringify({ hiddenPeople: [{ id: 'bo' }] }) }
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => undefined }
    const ids = basisOf({ people: people.map((p) => ({ ...p, lines: [] })), shares: [] }).people.map((p) => p.id)
    delete globalThis.localStorage
    expect(ids).not.toContain('bo')
    expect(ids).toHaveLength(people.length - 1)
  })
})

describe('profiles', () => {
  const profs = saveProfile([], 'Garden crew', ['person:ada', 'tag:garden'])
  it('saving under a known name replaces it; remove drops it', () => {
    expect(saveProfile(profs, 'garden crew', ['person:cy'])).toEqual([expect.objectContaining({ name: 'Garden crew', members: ['person:cy'] })])
    expect(removeProfile(profs, profs[0].id)).toEqual([])
  })
  it('by default a profile leaves out people on the don\'t-share list', () => {
    const page = withChip(initial(), 'exclude', 'person:ada')
    const out = applyProfile(page, profs[0], false)
    expect(out.include).toEqual(['tag:garden'])
    expect(out.exclude).toEqual(['person:ada'])
  })
  it('with the setting on, the profile wins over the don\'t-share list', () => {
    const page = withChip(initial(), 'exclude', 'person:ada')
    const out = applyProfile(page, profs[0], true)
    expect(out.include).toEqual(['person:ada', 'tag:garden'])
    expect(out.exclude).toEqual([])
  })
})

describe('wording', () => {
  it('the two lists say what Jakob asked', () => {
    expect(S.shareAlsoHint).toBe('People with these tags or these individuals should be able to see it even outside the zone.')
    expect(S.shareExceptHint).toBe('This overrides the zone as well as the in-addition list.')
    expect(JSON.stringify(S.shareZones)).not.toMatch(/whitelist|blacklist/i)
  })
})
