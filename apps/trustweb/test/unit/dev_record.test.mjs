/** Dev-only seed (src/dev_record.ts): inert where the build defined no record (every build, and unit tests). */
import { devRecordFile, keepPlacements, seedDevRecord } from '../../src/dev_record.ts'

describe('dev record', () => {
  it('is absent and writes nothing when no record was defined', () => {
    const set = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: set })
    expect(devRecordFile()).toBeNull()
    seedDevRecord('me')
    expect(set).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it('seeds a fresh origin, keeps an edited record while the seed is unchanged, replaces it (with a backup) when the seed changed', () => {
    const text = JSON.stringify({ v: 1, me: { id: 'x', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false })
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text })
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) })
    expect(devRecordFile()).toBe('r.json')
    seedDevRecord('me')
    // the Network demo (three dummies) rides on top of the seed
    expect(JSON.parse(store.get('trustweb.v1.me')).people.map((p) => p.name)).toEqual(['Dummy Alpha', 'Dummy Beta', 'Dummy Gamma'])
    store.set('trustweb.v1.me', 'mine')
    seedDevRecord('me')
    expect(store.get('trustweb.v1.me')).toBe('mine')
    const text2 = text.replace('"J"', '"Jakob"')
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text: text2 })
    seedDevRecord('me')
    expect(JSON.parse(store.get('trustweb.v1.me')).me.displayName).toBe('Jakob')
    expect(store.get('trustweb.v1.me.before-seed')).toBe('mine')
    vi.unstubAllGlobals()
  })
})

describe('keepPlacements: a re-applied seed never moves what the phone placed (2026-10-16)', () => {
  const person = (id, extra = {}) => ({ id, name: id, context: '', ring: 'unsorted', metAt: 1, lines: [], ...extra })
  it('ring, intending and angle of the stored record win per person; new persons come as the seed says', () => {
    const next = { v: 1, me: { id: 'me', displayName: 'Me' }, people: [person('a', { ringSuggested: true }), person('b'), person('c')], peers: [], inventory: [], log: [], notificationsOn: false }
    const old = { ...next, people: [person('a', { ring: 'intending', intending: { value: 2, since: 5 }, angle: 131 }), person('b')] }
    expect(keepPlacements(next, old)).toBe(true)
    expect(next.people[0]).toMatchObject({ ring: 'intending', intending: { value: 2, since: 5 }, angle: 131 })
    expect(next.people[0].ringSuggested).toBeUndefined()
    expect(next.people[2].ring).toBe('unsorted')
    expect(keepPlacements(structuredClone(next), structuredClone(next))).toBe(false)
  })
})
