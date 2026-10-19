/** Dev-only seed (src/dev_record.ts): inert where the build defined no record (every build, and unit tests). */
import { devRecordFile, HOSTED_RECORD_PATH, keepPlacements, seedDevRecord, seedHostedDevRecord } from '../../src/dev_record.ts'
import { hideDemoContent } from '../../src/demo_hide.ts'

const RECORD = JSON.stringify({ v: 1, me: { id: 'x', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false })
const memStorage = () => { const m = new Map(); return { get: m, api: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } } }

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

describe('dev record and demo content (2026-10-19)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('a seeded record that carries demo marks is not seeded again while the seed file is unchanged', () => {
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text: RECORD })
    const { get, api } = memStorage()
    vi.stubGlobal('localStorage', api)
    seedDevRecord('me')
    const stored = JSON.parse(get.get('trustweb.v1.me'))
    expect(stored.demo.people).toHaveLength(3)  // the dummies are marked demo content
    stored.me.displayName = 'edited'
    get.set('trustweb.v1.me', JSON.stringify(stored))
    seedDevRecord('me')
    expect(JSON.parse(get.get('trustweb.v1.me')).me.displayName).toBe('edited')
  })
  it('a changed seed keeps the demo content hidden when the phone had hidden it', () => {
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text: RECORD })
    const { get, api } = memStorage()
    vi.stubGlobal('localStorage', api)
    seedDevRecord('me')
    const stored = JSON.parse(get.get('trustweb.v1.me'))
    hideDemoContent(stored)
    get.set('trustweb.v1.me', JSON.stringify(stored))
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text: RECORD.replace('"J"', '"Jakob"') })
    seedDevRecord('me')
    const next = JSON.parse(get.get('trustweb.v1.me'))
    expect(next.me.displayName).toBe('Jakob')
    expect(next.people).toEqual([])
    expect(next.demoHidden.people.map((p) => p.name)).toEqual(['Dummy Alpha', 'Dummy Beta', 'Dummy Gamma'])
  })
})

describe('hosted dev record: a preview slot fetches the record the Mac put on the VM (2026-10-19)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const slotPage = (hasOverlay) => ({ querySelector: (sel) => (hasOverlay && sel.includes('/__tw/overlay.js') ? {} : null) })
  const response = (status, text, file) => ({ ok: status === 200, status, text: async () => text, headers: { get: (h) => (h === 'X-TW-Record-File' ? file ?? null : null) } })
  it('fetches nothing where the page is not a preview slot, or where a build-time record is in play', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('localStorage', memStorage().api)
    expect(await seedHostedDevRecord('me', { fetch, doc: slotPage(false) })).toBe(false)
    vi.stubGlobal('__TW_DEV_RECORD__', { file: 'r.json', text: RECORD })
    expect(await seedHostedDevRecord('me', { fetch, doc: slotPage(true) })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('seeds the slot origin from /__tw/dev-record, remembers the file name, and reports a change only when the stored record changed', async () => {
    const { get, api } = memStorage()
    vi.stubGlobal('localStorage', api)
    const fetch = vi.fn(async () => response(200, RECORD, 'trustweb-record.json'))
    expect(await seedHostedDevRecord('me', { fetch, doc: slotPage(true) })).toBe(true)
    expect(fetch).toHaveBeenCalledWith(HOSTED_RECORD_PATH, expect.objectContaining({ credentials: 'same-origin' }))
    expect(JSON.parse(get.get('trustweb.v1.me')).me.displayName).toBe('J')
    expect(devRecordFile()).toBe('trustweb-record.json')
    expect(await seedHostedDevRecord('me', { fetch, doc: slotPage(true) })).toBe(false)
    fetch.mockResolvedValue(response(200, RECORD.replace('"J"', '"Jakob"'), 'trustweb-record.json'))
    expect(await seedHostedDevRecord('me', { fetch, doc: slotPage(true) })).toBe(true)
    expect(JSON.parse(get.get('trustweb.v1.me')).me.displayName).toBe('Jakob')
  })
  it('a record taken off the VM (404) or a failed fetch leaves the stored record alone; 404 also forgets the file name', async () => {
    const { get, api } = memStorage()
    vi.stubGlobal('localStorage', api)
    await seedHostedDevRecord('me', { fetch: async () => response(200, RECORD, 'r.json'), doc: slotPage(true) })
    expect(devRecordFile()).toBe('r.json')
    expect(await seedHostedDevRecord('me', { fetch: async () => { throw new Error('offline') }, doc: slotPage(true) })).toBe(false)
    expect(devRecordFile()).toBe('r.json')
    expect(await seedHostedDevRecord('me', { fetch: async () => response(404, 'nope'), doc: slotPage(true) })).toBe(false)
    expect(devRecordFile()).toBeNull()
    expect(JSON.parse(get.get('trustweb.v1.me')).me.displayName).toBe('J')
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
