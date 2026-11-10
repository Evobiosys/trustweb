// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 40 photo-rails: opt-in local matching. The embedder is pluggable; only a deterministic stub ships. Phone numbers come from file names and the contacts already on the device.
import { clusterFaces, cosine, stubEmbedder, suggestForCluster } from '../../src/ext/photos/face_match.ts'
import { phoneHint, phonesOf, digitsIn } from '../../src/ext/photos/phone_match.ts'
import { png } from './helpers/png.mjs'

const blob = (rgb, w = 6, h = 6) => new Blob([png(w, h, rgb)], { type: 'image/png' })

describe('stub embedder', () => {
  it('is deterministic, unit length, and says it is a stub', async () => {
    const a = await stubEmbedder.embed(blob([200, 10, 10]))
    const b = await stubEmbedder.embed(blob([200, 10, 10]))
    expect(a).toEqual(b)
    expect(Math.hypot(...a)).toBeCloseTo(1, 6)
    expect(stubEmbedder.stub).toBe(true)
    expect(stubEmbedder.id).toBe('stub-bytes-v1')
  })
  it('equal pictures give cosine 1; different pictures differ', async () => {
    const a = await stubEmbedder.embed(blob([200, 10, 10]))
    const c = await stubEmbedder.embed(blob([5, 220, 90], 9, 9))
    expect(cosine(a, a)).toBeCloseTo(1, 6)
    expect(cosine(a, c)).toBeLessThan(0.999)
  })
  it('cosine of empty or mismatched vectors is 0', () => {
    expect(cosine([], [])).toBe(0)
    expect(cosine([1, 0], [1])).toBe(0)
  })
})

describe('clusters', () => {
  const v = (...x) => { const n = Math.hypot(...x); return x.map((y) => y / n) }
  it('groups photos whose embeddings are close, in input order, deterministically', () => {
    const items = [{ photoId: 'a', vec: v(1, 0, 0) }, { photoId: 'b', vec: v(0.99, 0.05, 0) }, { photoId: 'c', vec: v(0, 1, 0) }, { photoId: 'd', vec: v(0.02, 0.98, 0) }, { photoId: 'e', vec: v(0, 0, 1) }]
    const out = clusterFaces(items, 0.9)
    expect(out.map((c) => c.photoIds)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
    expect(clusterFaces(items, 0.9)).toEqual(out)
  })
  it('a photo without a face (no embedding) stays out of every cluster', () => {
    expect(clusterFaces([{ photoId: 'a', vec: null }, { photoId: 'b', vec: [1, 0] }], 0.9).map((c) => c.photoIds)).toEqual([['b']])
  })
  it('suggests the person most of the cluster is already assigned to, only when more than half agree', () => {
    const c = { id: 'k', photoIds: ['a', 'b', 'c'] }
    expect(suggestForCluster(c, { a: ['p1'], b: ['p1'], c: [] })).toBe('p1')
    expect(suggestForCluster(c, { a: ['p1'], b: ['p2'], c: [] })).toBeUndefined()
    expect(suggestForCluster(c, {})).toBeUndefined()
  })
})

describe('phone numbers', () => {
  const people = [
    { id: 'p1', name: 'Ana', channels: { whatsapp: '+436601234567' } },
    { id: 'p2', name: 'Ben', channels: { signal: '+4915112345678' }, fields: { 'phone-mobile': '0043 699 1112223' } },
    { id: 'p3', name: 'Cy', channels: {} },
  ]
  it('reads the numbers a person has as plain digits', () => {
    expect(phonesOf(people[0])).toEqual(['436601234567'])
    expect(phonesOf(people[1]).sort()).toEqual(['436991112223', '4915112345678'])
    expect(phonesOf(people[2])).toEqual([])
  })
  it('finds numbers in a file name or folder: +, 00, spaces, dashes', () => {
    expect(digitsIn('WhatsApp Image with +43 660 1234567.jpg')).toEqual(['436601234567'])
    expect(digitsIn('Chat/0043-699-1112223/IMG_1.jpg')).toEqual(['436991112223'])
    expect(digitsIn('IMG_20240101_123456.jpg')).toEqual([])
    expect(digitsIn('2024-11-10 12.30.45.png')).toEqual([])
  })
  it('suggests the one person whose number the path carries; none when two match or none do', () => {
    expect(phoneHint('WhatsApp/+43660123/x.jpg', people)).toBeUndefined()
    expect(phoneHint('WhatsApp/+436601234567/x.jpg', people)).toBe('p1')
    expect(phoneHint('Chat 4915112345678 and 436601234567.jpg', people)).toBeUndefined()
    expect(phoneHint('holiday.jpg', people)).toBeUndefined()
  })
  it('matches a number written without the country code only when it is the national part of exactly one contact', () => {
    expect(phoneHint('Chat/0660 1234567/x.jpg', people)).toBe('p1')
  })
})
