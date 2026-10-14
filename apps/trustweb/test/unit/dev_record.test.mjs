/** Dev-only seed (src/dev_record.ts): inert where the build defined no record (every build, and unit tests). */
import { devRecordFile, seedDevRecord } from '../../src/dev_record.ts'

describe('dev record', () => {
  it('is absent and writes nothing when no record was defined', () => {
    const set = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: set })
    expect(devRecordFile()).toBeNull()
    seedDevRecord('me')
    expect(set).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it('seeds a fresh origin only, never over an existing record', () => {
    const text = JSON.stringify({ v: 1, me: { id: 'x', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false })
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text })
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) })
    expect(devRecordFile()).toBe('r.json')
    seedDevRecord('me')
    expect(store.get('trustweb.v1.me')).toBe(text)
    store.set('trustweb.v1.me', 'mine')
    seedDevRecord('me')
    expect(store.get('trustweb.v1.me')).toBe('mine')
    vi.unstubAllGlobals()
  })
})
