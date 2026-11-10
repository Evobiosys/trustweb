// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 40 photo-rails: the IndexedDB photo store, against a fake IndexedDB (helpers/fake_idb.mjs). Synthetic PNGs only.
import { PhotoStore, usageOf } from '../../src/ext/photos/photo_store.ts'
import { TOMBSTONE_MS, tombstone } from '../../src/ext/photos/photo_model.ts'
import { fakeIndexedDB } from './helpers/fake_idb.mjs'
import { png } from './helpers/png.mjs'

const NOW = 1_800_000_000_000
const photo = (id, over = {}) => {
  const full = new Blob([png(8, 6, [200, 30, 30])], { type: 'image/png' })
  const thumb = new Blob([png(4, 3, [200, 30, 30])], { type: 'image/png' })
  return { meta: { id, source: 'picker', addedAt: NOW, bytes: full.size, thumbBytes: thumb.size, w: 8, h: 6, hash: 'hash-' + id, people: [], ...over }, full, thumb }
}
const newStore = () => new PhotoStore('trustweb-photos.test', fakeIndexedDB())

describe('photo store', () => {
  it('keeps meta and both blobs, lists the meta without the blobs', async () => {
    const s = newStore()
    await s.add(photo('a'))
    const list = await s.list()
    expect(list.map((m) => m.id)).toEqual(['a'])
    expect(list[0]).not.toHaveProperty('full')
    expect((await s.blob('a', 'thumb')).size).toBe(photo('a').thumb.size)
    expect((await s.blob('a', 'full')).size).toBe(photo('a').full.size)
    expect(await s.blob('nope', 'full')).toBeNull()
  })
  it('assigns a person to a photo and keeps it across a new store on the same database', async () => {
    const idb = fakeIndexedDB()
    const s = new PhotoStore('x', idb)
    await s.add(photo('a'))
    await s.update('a', (m) => ({ ...m, people: ['p1'] }))
    expect((await new PhotoStore('x', idb).list())[0].people).toEqual(['p1'])
  })
  it('finds a photo by hash so the same picture is not stored twice', async () => {
    const s = newStore()
    await s.add(photo('a'))
    expect((await s.byHash('hash-a'))?.id).toBe('a')
    expect(await s.byHash('other')).toBeNull()
  })
  it('update of an unknown id changes nothing', async () => {
    const s = newStore()
    expect(await s.update('ghost', (m) => m)).toBeNull()
    expect(await s.list()).toEqual([])
  })
  it('tombstoned photos stay on disk for 30 days, then purgeExpired drops meta and blobs', async () => {
    const s = newStore()
    await s.add(photo('a'))
    await s.add(photo('b'))
    await s.update('a', (m) => tombstone(m, NOW))
    expect(await s.purgeExpired(NOW + TOMBSTONE_MS - 1)).toEqual([])
    expect((await s.list()).length).toBe(2)
    expect(await s.purgeExpired(NOW + TOMBSTONE_MS)).toEqual(['a'])
    expect((await s.list()).map((m) => m.id)).toEqual(['b'])
    expect(await s.blob('a', 'full')).toBeNull()
    expect(await s.blob('b', 'full')).not.toBeNull()
  })
  it('usage counts picture and thumbnail bytes of every photo, tombstoned ones too', async () => {
    const s = newStore()
    const a = photo('a')
    await s.add(a)
    await s.update('a', (m) => tombstone(m, NOW))
    expect(usageOf(await s.list())).toBe(a.meta.bytes + a.meta.thumbBytes)
  })
  it('clear removes everything', async () => {
    const s = newStore()
    await s.add(photo('a'))
    await s.clear()
    expect(await s.list()).toEqual([])
  })
  it('without IndexedDB it fails soft: empty list, add refused', async () => {
    const s = new PhotoStore('x', undefined)
    expect(await s.list()).toEqual([])
    expect(await s.add(photo('a'))).toBe(false)
  })
})
