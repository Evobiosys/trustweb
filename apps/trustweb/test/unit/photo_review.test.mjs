// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 40 photo-rails: the Photos folder import. Pick a folder, see every picture, say who it is (existing people only), commit.
import { assignFolder, assignKeys, assigned, buildReview, foldersOf, setAssign, suggestAll, takeSuggestions } from '../../src/ext/photos/photo_review.ts'

const f = (path, type = 'image/jpeg') => ({ name: path.split('/').pop(), type, webkitRelativePath: path })
const FILES = [
  f('Seoul 2018/day1/a.jpg'), f('Seoul 2018/day1/b.jpg'), f('Seoul 2018/c.png', 'image/png'), f('Seoul 2018/notes.txt', 'text/plain'), f('Seoul 2018/.DS_Store', ''), f('Seoul 2018/d.HEIC', ''),
]

describe('review list', () => {
  it('keeps pictures only, with the sub-folder under the picked folder as their group', () => {
    const r = buildReview(FILES)
    expect(r.map((x) => x.path)).toEqual(['Seoul 2018/day1/a.jpg', 'Seoul 2018/day1/b.jpg', 'Seoul 2018/c.png', 'Seoul 2018/d.HEIC'])
    expect(r.map((x) => x.folder)).toEqual(['day1', 'day1', '', ''])
    expect(foldersOf(r)).toEqual([{ folder: 'day1', count: 2 }, { folder: '', count: 2 }])
  })
  it('a plain multi-file pick (no relative path) is one group', () => {
    const r = buildReview([{ name: 'x.jpg', type: 'image/jpeg', webkitRelativePath: '' }])
    expect(r[0]).toMatchObject({ path: 'x.jpg', folder: '' })
  })
  it('every item has a unique key', () => {
    const r = buildReview(FILES)
    expect(new Set(r.map((x) => x.key)).size).toBe(r.length)
  })
})

describe('who is this', () => {
  it('assigns one picture, and clears it again', () => {
    let r = buildReview(FILES)
    r = setAssign(r, r[0].key, 'p1')
    expect(r[0].personId).toBe('p1')
    expect(assigned(r).length).toBe(1)
    r = setAssign(r, r[0].key, undefined)
    expect(assigned(r).length).toBe(0)
  })
  it('assigns a whole sub-folder at once, leaving the other groups alone', () => {
    const r = assignFolder(buildReview(FILES), 'day1', 'p2')
    expect(r.filter((x) => x.personId === 'p2').map((x) => x.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(r.filter((x) => !x.personId).length).toBe(2)
  })
})

describe('a face group', () => {
  it('assigns exactly the pictures of the group', () => {
    const r = buildReview(FILES)
    const out = assignKeys(r, [r[0].key, r[3].key], 'p3')
    expect(out.filter((x) => x.personId === 'p3').map((x) => x.name)).toEqual(['a.jpg', 'd.HEIC'])
    expect(assigned(out).length).toBe(2)
  })
})

describe('suggestions (opt-in only)', () => {
  const people = [{ id: 'p1', name: 'Ana', channels: { whatsapp: '+436601234567' } }]
  it('puts a suggestion on a picture whose path carries a contact number; it is not assigned until taken', () => {
    const r = suggestAll(buildReview([f('WhatsApp/+436601234567/a.jpg'), f('WhatsApp/other/b.jpg')]), { people })
    expect(r[0].suggest).toEqual({ personId: 'p1', why: 'phone' })
    expect(r[0].personId).toBeUndefined()
    expect(r[1].suggest).toBeUndefined()
    const t = takeSuggestions(r)
    expect(t[0].personId).toBe('p1')
    expect(t[0].suggest).toBeUndefined()
  })
  it('face clusters add suggestions too, but never override a person already chosen', () => {
    let r = buildReview([f('a.jpg'), f('b.jpg'), f('c.jpg')])
    r = setAssign(r, r[2].key, 'p9')
    const out = suggestAll(r, { people: [], clusters: [{ id: 'k', photoIds: [r[0].key, r[1].key, r[2].key] }], clusterPerson: { k: 'p1' } })
    expect(out[0].suggest).toEqual({ personId: 'p1', why: 'face' })
    expect(out[2].suggest).toBeUndefined()
    expect(out[2].personId).toBe('p9')
  })
})
