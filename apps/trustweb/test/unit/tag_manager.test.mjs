// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 group-tags: the Tags manager's edits on the stored colour tags (pure). */
import { addChild, createGroup, forkTag, removeChild, setManaged, toggleExclude, toggleSteward } from '../../src/tag_manager.ts'

const ct = (id, extra = {}) => ({ id, colour: '#1565c0', label: id, ...extra })
const base = [ct('c1'), ct('c2')]
const byId = (l, id) => l.find((x) => x.id === id)
/** Empty lists and the personal kind are not stored. */
const of = (l, id, k) => byId(l, id)[k] ?? (k === 'kind' ? 'personal' : [])

describe('tag manager', () => {
  it('createGroup adds a group tag with its own id and colour', () => {
    const out = createGroup(base, 'IYG')
    expect(byId(out, 'iyg')).toMatchObject({ label: 'IYG', kind: 'group' })
    expect(createGroup(out, 'IYG').map((t) => t.id)).toEqual(['c1', 'c2', 'iyg', 'iyg-2'])
    expect(base).toHaveLength(2)
  })

  it('addChild / removeChild move a tag under and out of a group; a cycle is refused', () => {
    const g = addChild(addChild(createGroup(base, 'IYG'), 'iyg', 'c1'), 'iyg', 'c2')
    expect(byId(g, 'c1').parents).toEqual(['iyg'])
    expect(of(removeChild(g, 'iyg', 'c1'), 'c1', 'parents')).toEqual([])
    expect(() => addChild(g, 'c1', 'iyg')).toThrow(/cycle/)
  })

  it('toggleExclude puts a person on and off the exclude list', () => {
    const g = createGroup(base, 'IYG')
    const on = toggleExclude(g, 'iyg', 'p1')
    expect(byId(on, 'iyg').excludes).toEqual(['p1'])
    expect(of(toggleExclude(on, 'iyg', 'p1'), 'iyg', 'excludes')).toEqual([])
  })

  it('setManaged marks managed (stewards kept), unmark returns to group when it has children', () => {
    const g = toggleSteward(setManaged(addChild(createGroup(base, 'IYG'), 'iyg', 'c1'), 'iyg', true), 'iyg', 's1')
    expect(byId(g, 'iyg')).toMatchObject({ kind: 'managed', stewardIds: ['s1'] })
    expect(of(toggleSteward(g, 'iyg', 's1'), 'iyg', 'stewardIds')).toEqual([])
    expect(of(setManaged(g, 'iyg', false), 'iyg', 'kind')).toBe('group')
    expect(of(setManaged(g, 'iyg', false), 'iyg', 'stewardIds')).toEqual([])
    expect(byId(setManaged(base, 'c1', true), 'c1').kind).toBe('managed')
    expect(of(setManaged(setManaged(base, 'c1', true), 'c1', false), 'c1', 'kind')).toBe('personal')
  })

  it('forkTag copies a tag as the user\'s own, with forkedFrom and the same colour', () => {
    const g = setManaged(addChild(createGroup(base, 'IYG'), 'iyg', 'c1'), 'iyg', true)
    const out = forkTag(g, 'iyg')
    const f = out.find((t) => t.forkedFrom === 'iyg')
    expect(f).toMatchObject({ id: 'iyg-2', label: 'IYG', colour: byId(g, 'iyg').colour })
    expect(f.kind).toBeUndefined()
    expect(byId(out, 'c1').parents).toEqual(['iyg', 'iyg-2'])
  })
})
