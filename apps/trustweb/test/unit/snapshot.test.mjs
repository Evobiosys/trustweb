/** Local snapshots (src/snapshot.ts): seal/open, wrong key, cap of 5, full-storage fallback, re-keying, restore of left-out parts. */
import { SNAPSHOT_KEEP, ensureKey, openSnapshot, readSnapshots, rekey, restoreRecord, sealSnapshot, takeSnapshot } from '../../src/snapshot.ts'
import { keyFromPassphrase, newRandomKey, parseKeyText } from '../../src/backup.ts'

const mem = (limit = Infinity) => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { if (v.length > limit) throw new Error('QuotaExceededError'); m.set(k, v) } } }
const rec = (n = 1) => ({ v: 1, me: { id: 'me', displayName: 'J' }, people: [{ id: 'p', name: 'Ada ü' }], peers: [], inventory: [], log: [], notificationsOn: false,
  meetings: [{ id: 'm1', about: 'x', transcript: [{ t: 'long' }], outbox: [{ k: 1 }], late: { a: 1 }, lines: [] }], n })

describe('snapshot seal', () => {
  it('round-trips, drops transcript/outbox/late, and a wrong key or a flipped byte fails', async () => {
    const key = await newRandomKey()
    const bytes = await sealSnapshot(key, rec(), 'manual', 123)
    const open = await openSnapshot(key, bytes)
    expect(open).toMatchObject({ at: 123, reason: 'manual' })
    expect(open.record.people[0].name).toBe('Ada ü')
    expect(open.record.meetings[0]).toEqual({ id: 'm1', about: 'x', transcript: [], lines: [] })
    await expect(openSnapshot(await newRandomKey(), bytes)).rejects.toThrow()
    const bad = bytes.slice(); bad[bad.length - 1] ^= 1
    await expect(openSnapshot(key, bad)).rejects.toThrow()
  })
  it('two seals of the same record differ (fresh IV) and do not contain the plaintext', async () => {
    const key = await newRandomKey()
    const a = await sealSnapshot(key, rec(), 'm', 1), b = await sealSnapshot(key, rec(), 'm', 1)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
    expect(Buffer.from(a).includes(Buffer.from('Ada'))).toBe(false)
  })
})

describe('snapshot store', () => {
  it('keeps the last 5, oldest dropped', async () => {
    const key = await newRandomKey(), store = mem()
    for (let i = 1; i <= 7; i++) await takeSnapshot(key, rec(i), 'r' + i, store, 'k', i)
    const list = readSnapshots(store, 'k')
    expect(list).toHaveLength(SNAPSHOT_KEEP)
    expect(list.map((e) => e.reason)).toEqual(['r3', 'r4', 'r5', 'r6', 'r7'])
  })
  it('full storage: the oldest is dropped and it retries once; if still full the merge may go on (kept false, bytes still returned)', async () => {
    const key = await newRandomKey()
    const probe = (await sealSnapshot(key, rec(), 'r', 1)).length
    const store = mem(Math.ceil(probe * 1.34) * 2 + 400)
    await takeSnapshot(key, rec(), 'a', store, 'k', 1)
    await takeSnapshot(key, rec(), 'b', store, 'k', 2)
    const r = await takeSnapshot(key, rec(), 'c', store, 'k', 3)
    expect(r.kept).toBe(true)
    expect(readSnapshots(store, 'k').map((e) => e.reason)).toEqual(['b', 'c'])
    const none = await takeSnapshot(key, rec(), 'd', mem(10), 'k', 4)
    expect(none.kept).toBe(false)
    expect(none.blob.length).toBeGreaterThan(0)
  })
  it('re-keying: every snapshot opens under the new key only; one the old key cannot open is kept and counted', async () => {
    const oldKey = await newRandomKey(), store = mem()
    await takeSnapshot(await newRandomKey(), rec(), 'stranger', store, 'k', 1)
    await takeSnapshot(oldKey, rec(), 'mine', store, 'k', 2)
    const neu = await keyFromPassphrase('three unrelated words here')
    expect((await rekey(oldKey, neu, store, 'k')).skipped).toBe(1)
    const [stranger, mine] = readSnapshots(store, 'k')
    const bytes = (e) => Uint8Array.from(Buffer.from(e.blob.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
    expect((await openSnapshot(neu, bytes(mine))).reason).toBe('mine')
    await expect(openSnapshot(oldKey, bytes(mine))).rejects.toThrow()
    expect(stranger.reason).toBe('stranger')
  })
  it('the key: own setting first, then the server backup key, else one made once and kept', async () => {
    const store = mem(), backup = await newRandomKey(), own = await newRandomKey()
    expect((await ensureKey(store, 'sk', backup.text)).key.text).toBe(backup.text)
    expect(store.m.has('sk')).toBe(false)
    const made = await ensureKey(store, 'sk', null)
    expect(made.fresh).toBe(true)
    expect((await ensureKey(store, 'sk', null)).key.text).toBe(made.key.text)
    store.setItem('sk', own.text)
    expect((await ensureKey(store, 'sk', backup.text)).key.text).toBe(parseKeyText(own.text).text)
  })
})

describe('restoreRecord', () => {
  it('puts back the transcript, packs and late link the snapshot left out', () => {
    const snap = { ...rec(), meetings: [{ id: 'm1', about: 'x', transcript: [], lines: [] }, { id: 'm2', about: 'y', transcript: [], lines: [] }] }
    const out = restoreRecord(snap, rec())
    expect(out.meetings[0]).toMatchObject({ transcript: [{ t: 'long' }], outbox: [{ k: 1 }], late: { a: 1 } })
    expect(out.meetings[1].transcript).toEqual([])
    expect(restoreRecord(snap, null)).toBe(snap)
  })
})
