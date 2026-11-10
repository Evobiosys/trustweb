// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 40 photo-rails: a chosen file becomes a kept picture (<= 1280 px) plus a 256 px thumbnail; EXIF never reaches the store; duplicates and a full store are refused.
import { createHash } from 'node:crypto'
import { hasExif, ingestFiles, isImageFile } from '../../src/ext/photos/photo_ingest.ts'
import { PhotoStore } from '../../src/ext/photos/photo_store.ts'
import { fitSize } from '../../src/image_store.ts'
import { fakeIndexedDB } from './helpers/fake_idb.mjs'
import { png, pngSize } from './helpers/png.mjs'

const file = (name, w, h, rgb = [10, 120, 200]) => Object.assign(new Blob([png(w, h, rgb)], { type: 'image/png' }), { name })
/** A JPEG-looking blob that still carries an APP1/Exif segment (what a phone camera writes). */
const exifJpeg = (name) => Object.assign(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3, 4, 5, 6, 0xff, 0xd9])], { type: 'image/jpeg' }), { name })

// The fake scaler stands in for canvas: it asks for the side, returns a new solid PNG of the fitted size (so the original bytes, EXIF included, are gone).
const scale = async (blob, side) => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const { w, h } = fitSize(pngSize(bytes).w, pngSize(bytes).h, side)
  const tint = bytes.reduce((a, b) => (a + b) & 255, 0)   // different source pictures stay different, equal ones stay equal
  return { blob: new Blob([png(w, h, [tint, 2, 3])], { type: 'image/png' }), w, h }
}
const sha = async (bytes) => createHash('sha256').update(bytes).digest('hex')
let n = 0
const deps = (over = {}) => ({
  store: new PhotoStore('t', fakeIndexedDB()), scale, hash: sha, newId: () => 'id' + ++n, now: () => 1_800_000_000_000, room: async () => true, ...over,
})

describe('ingest', () => {
  it('keeps a 3000x2000 picture at 1280 px and a 256 px thumbnail, linked to the person, with the source note', async () => {
    const d = deps()
    const [r] = await ingestFiles([file('a.png', 3000, 2000)], { source: 'Photos folder: Seoul', people: ['p1'] }, d)
    expect(r.kind).toBe('added')
    const [m] = await d.store.list()
    expect(m).toMatchObject({ source: 'Photos folder: Seoul', people: ['p1'], w: 1280, h: 853, addedAt: 1_800_000_000_000 })
    const full = pngSize(new Uint8Array(await (await d.store.blob(m.id, 'full')).arrayBuffer()))
    const thumb = pngSize(new Uint8Array(await (await d.store.blob(m.id, 'thumb')).arrayBuffer()))
    expect(full).toEqual({ w: 1280, h: 853 })
    expect(thumb).toEqual({ w: 256, h: 171 })
    expect(m.bytes).toBeGreaterThan(0)
    expect(m.thumbBytes).toBeGreaterThan(0)
  })
  it('a small picture is not scaled up', async () => {
    const d = deps()
    await ingestFiles([file('s.png', 100, 80)], { source: 's', people: [] }, d)
    expect((await d.store.list())[0]).toMatchObject({ w: 100, h: 80 })
  })
  it('several files in one go; the progress callback sees each', async () => {
    const d = deps()
    const seen = []
    const out = await ingestFiles([file('a.png', 10, 10, [1, 1, 1]), file('b.png', 10, 10, [9, 9, 9])], { source: 'x', people: [] }, d, (done, total) => seen.push([done, total]))
    expect(out.map((r) => r.kind)).toEqual(['added', 'added'])
    expect(seen).toEqual([[1, 2], [2, 2]])
  })
  it('the same picture twice is stored once; the second person is linked to the first copy', async () => {
    const d = deps()
    await ingestFiles([file('a.png', 40, 40)], { source: 'x', people: ['p1'] }, d)
    const [r] = await ingestFiles([file('copy.png', 40, 40)], { source: 'y', people: ['p2'] }, d)
    expect(r.kind).toBe('duplicate')
    const all = await d.store.list()
    expect(all.length).toBe(1)
    expect(all[0].people).toEqual(['p1', 'p2'])
  })
  it('skips what is no picture, what cannot be read and what does not fit', async () => {
    const d = deps({ scale: async (b, s) => { if (b.name === 'bad.png') throw new Error('decode'); return scale(b, s) } })
    const out = await ingestFiles([Object.assign(new Blob(['x'], { type: 'text/plain' }), { name: 'notes.txt' }), file('bad.png', 5, 5)], { source: 'x', people: [] }, d)
    expect(out.map((r) => [r.kind, r.why])).toEqual([['skipped', 'not-image'], ['skipped', 'unreadable']])
    const full = deps({ room: async () => false })
    expect((await ingestFiles([file('a.png', 5, 5)], { source: 'x', people: [] }, full))[0]).toMatchObject({ kind: 'skipped', why: 'no-room' })
    expect(await full.store.list()).toEqual([])
  })
  it('refuses a result that still carries Exif (a scaler that copied the camera data)', async () => {
    const d = deps({ scale: async (b) => ({ blob: b, w: 4, h: 4 }) })
    const [r] = await ingestFiles([exifJpeg('cam.jpg')], { source: 'x', people: [] }, d)
    expect(r).toMatchObject({ kind: 'skipped', why: 'exif' })
    expect(await d.store.list()).toEqual([])
  })
})

describe('helpers', () => {
  it('hasExif finds the APP1 Exif segment of a JPEG and nothing in a PNG', () => {
    expect(hasExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0]))).toBe(true)
    expect(hasExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 8, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0xff, 0xd9]))).toBe(false)
    expect(hasExif(png(2, 2, [0, 0, 0]))).toBe(false)
  })
  it('isImageFile goes by type, else by extension (folder pickers give an empty type for some files)', () => {
    expect(isImageFile({ type: 'image/webp', name: 'x' })).toBe(true)
    expect(isImageFile({ type: '', name: 'IMG_1.JPG' })).toBe(true)
    expect(isImageFile({ type: '', name: 'notes.txt' })).toBe(false)
    expect(isImageFile({ type: 'video/mp4', name: 'a.mp4' })).toBe(false)
  })
})
