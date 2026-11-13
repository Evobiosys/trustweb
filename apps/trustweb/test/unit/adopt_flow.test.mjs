// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 B17: taking another device's state is two steps: a read-only preview, then an explicit Adopt. Nothing is archived or replaced before Adopt. */
import { adoptIdle, adoptStep, mayArchive } from '../../src/adopt_flow.ts'
import { archiveRecord, previewChanges, readArchived } from '../../src/device_adopt.ts'
import { bundleOf, refreshStamps } from '../../src/sync_core.ts'

const person = (id, name, extra = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...extra })
const state = (over = {}) => ({ v: 1, me: { displayName: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const bundle = (s) => bundleOf(s, refreshStamps(s, {}, 1, 'Phone'))
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } } }

describe('adopt state machine', () => {
  it('Adopt is refused until the preview was shown', () => {
    expect(adoptStep(adoptIdle, 'adopt')).toBe(adoptIdle)
    const previewed = adoptStep(adoptIdle, 'preview')
    expect(previewed).toBe('previewed')
    expect(adoptStep(previewed, 'adopt')).toBe('adopting')
  })
  it('only the adopting phase may archive and replace', () => {
    const seen = [adoptIdle, 'previewed', 'adopting', 'adopted', 'failed', 'declined'].filter(mayArchive)
    expect(seen).toEqual(['adopting'])
  })
  it('a finished adoption reports done or failed; decline ends it from idle or previewed', () => {
    expect(adoptStep('adopting', 'done')).toBe('adopted')
    expect(adoptStep('adopting', 'fail')).toBe('failed')
    expect(adoptStep('previewed', 'decline')).toBe('declined')
    expect(adoptStep(adoptIdle, 'decline')).toBe('declined')
    expect(adoptStep('adopted', 'adopt')).toBe('adopted')   // a second press cannot run it twice
    expect(adoptStep('adopting', 'adopt')).toBe('adopting')
  })
  it('a failed adoption can be previewed and tried again', () => {
    expect(adoptStep('failed', 'preview')).toBe('previewed')
  })
})

describe('previewChanges is read-only', () => {
  it('lists who would be added, removed and changed, the settings that differ, and changes nothing', () => {
    const mine = state({ people: [person('a', 'Ada'), person('b', 'Ben'), person('c', 'Cy')], membraneLimit: 5 })
    const theirs = state({ people: [person('a', 'Ada'), person('b', 'Ben B'), person('d', 'Di')], membraneLimit: 7 })
    const b = bundle(theirs)
    const before = JSON.stringify([mine, b])
    const p = previewChanges(mine, b)
    expect(p.added).toEqual(['Di'])
    expect(p.removed).toEqual(['Cy'])
    expect(p.changed).toEqual(['Ben'])
    expect(p.settings).toEqual(['membraneLimit'])
    expect(JSON.stringify([mine, b])).toBe(before)
  })
  it('identical state: nothing in any list; long lists are capped with a rest count', () => {
    const s = state({ people: [person('a', 'Ada')] })
    expect(previewChanges(s, bundle(structuredClone(s)))).toEqual({ added: [], removed: [], changed: [], settings: [], more: 0 })
    const many = state({ people: Array.from({ length: 30 }, (_, i) => person('p' + i, 'P' + i)) })
    const p = previewChanges(state(), bundle(many))
    expect(p.added).toHaveLength(12)
    expect(p.more).toBe(18)
  })
  it('previewing archives nothing: the archive list stays empty until archiveRecord runs (Adopt)', () => {
    const store = memStore()
    previewChanges(state({ people: [person('a', 'Ada')] }), bundle(state()))
    expect(readArchived(store, 'k', 1)).toEqual([])
    expect(archiveRecord(store, 'k', state(), { reason: 'r', device: 'd' }, 1)).toBe(true)
    expect(readArchived(store, 'k', 2)).toHaveLength(1)
  })
})
