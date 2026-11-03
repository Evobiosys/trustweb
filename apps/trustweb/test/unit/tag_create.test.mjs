// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29 filters-create: the filter box offers to create a missing person or tag, and tags people in a row (src/tag_create.ts). Pure. */
import { suggestOrCreate, createPerson, createTag, tagPerson, untagPerson } from '../../src/tag_create.ts'
import { candidates } from '../../src/share_page.ts'
import { tagsOf } from '../../src/colour_tags.ts'
import { Ring } from '../../src/model.ts'

const people = [{ id: 'a', name: 'Anna', ring: Ring.Friend }]
const tags = [{ id: 'club', colour: '#111111', label: 'Club' }]
const cands = candidates({ people, tags })

describe('suggestOrCreate', () => {
  it('@ with an unknown name ends with a create-person row', () => {
    const r = suggestOrCreate('@Zed', cands, [])
    expect(r.at(-1)).toEqual({ create: 'person', name: 'Zed' })
  })
  it('# with an unknown tag ends with a create-tag row', () => {
    expect(suggestOrCreate('#garden', cands, []).at(-1)).toEqual({ create: 'tag', name: 'garden' })
  })
  it('an exact existing name offers no create row', () => {
    expect(suggestOrCreate('@anna', cands, []).some((r) => 'create' in r)).toBe(false)
    expect(suggestOrCreate('#club', cands, []).some((r) => 'create' in r)).toBe(false)
  })
  it('a partial match keeps its hits and still offers create', () => {
    const r = suggestOrCreate('@Ann', cands, [])
    expect(r[0]).toEqual({ id: 'person:a', label: 'Anna' })
    expect(r.at(-1)).toEqual({ create: 'person', name: 'Ann' })
  })
  it('no prefix and a bare prefix offer no create row', () => {
    expect(suggestOrCreate('Zed', cands, [])).toEqual([])
    expect(suggestOrCreate('@', cands, []).some((r) => 'create' in r)).toBe(false)
  })
})

describe('creation and tagging', () => {
  it('createPerson adds the person Not yet sorted', () => {
    const list = [...people]
    const p = createPerson(list, '  Ben ', 'b1', 5)
    expect(list.at(-1)).toBe(p)
    expect(p).toMatchObject({ id: 'b1', name: 'Ben', ring: Ring.Unsorted, metAt: 5, lines: [] })
  })
  it('createTag defines a tag with a unique id and a colour', () => {
    const t = createTag(tags, 'Garden Club')
    expect(t.label).toBe('Garden Club')
    expect(t.id).toBe('garden-club')
    expect(t.colour).toMatch(/^#[0-9a-f]{6}$/i)
    expect(createTag([...tags, t], 'garden club').id).not.toBe('garden-club')
  })
  it('several creations in one go, then tag and undo', () => {
    const list = [...people]
    const defs = [...tags]
    const tag = createTag(defs, 'garden'); defs.push(tag)
    const ben = createPerson(list, 'Ben', 'b1', 1)
    tagPerson(list.find((p) => p.id === 'a'), tag.id)
    tagPerson(ben, tag.id)
    expect(list.filter((p) => tagsOf(p, defs).some((x) => x.id === 'garden')).map((p) => p.id)).toEqual(['a', 'b1'])
    untagPerson(ben, tag.id)
    expect(tagsOf(ben, defs)).toEqual([])
    expect(tagsOf(list[0], defs).map((x) => x.id)).toEqual(['garden'])
  })
})
