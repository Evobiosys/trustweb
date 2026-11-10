// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 40 photo-rails: the pure rules of the photo store (links to people, 30-day tombstone, thumbnail size, storage line).
import {
  FULL_SIDE, THUMB_SIDE, TOMBSTONE_MS, assignTo, expired, formatBytes, isLive, photosOf, quotaRoom, restore, storageShare, thumbSize, tombstone, trashedOf, unassign,
} from '../../src/ext/photos/photo_model.ts'

const NOW = 1_800_000_000_000
const meta = (id, over = {}) => ({ id, source: 'picker', addedAt: NOW, bytes: 1000, thumbBytes: 100, w: 800, h: 600, hash: 'h' + id, people: [], ...over })

describe('sizes', () => {
  it('thumbnails are 256 px on the long side, never scaled up, ratio kept', () => {
    expect(THUMB_SIDE).toBe(256)
    expect(thumbSize(1024, 512)).toEqual({ w: 256, h: 128 })
    expect(thumbSize(512, 1024)).toEqual({ w: 128, h: 256 })
    expect(thumbSize(100, 50)).toEqual({ w: 100, h: 50 })
  })
  it('the kept picture is at most the shared 1280 px', () => { expect(FULL_SIDE).toBe(1280) })
})

describe('links to people', () => {
  it('assign adds a person once, unassign removes them', () => {
    const a = assignTo(assignTo(meta('1'), 'p1'), 'p1')
    expect(a.people).toEqual(['p1'])
    expect(assignTo(a, 'p2').people).toEqual(['p1', 'p2'])
    expect(unassign(a, 'p1').people).toEqual([])
  })
  it('a photo of two people shows on both cards; newest first', () => {
    const ms = [meta('1', { people: ['p1'], addedAt: 5 }), meta('2', { people: ['p1', 'p2'], addedAt: 9 }), meta('3', { people: ['p2'], addedAt: 7 })]
    expect(photosOf(ms, 'p1').map((m) => m.id)).toEqual(['2', '1'])
    expect(photosOf(ms, 'p2').map((m) => m.id)).toEqual(['2', '3'])
    expect(photosOf(ms, 'nobody')).toEqual([])
  })
})

describe('remove = tombstone for 30 days', () => {
  it('a tombstoned photo is hidden from the card but listed as recently removed', () => {
    const t = tombstone(meta('1', { people: ['p1'] }), NOW)
    expect(isLive(t)).toBe(false)
    expect(photosOf([t], 'p1')).toEqual([])
    expect(trashedOf([t], 'p1', NOW + 1).map((m) => m.id)).toEqual(['1'])
  })
  it('restore brings it back; tombstoning twice keeps the first date', () => {
    const t = tombstone(meta('1'), NOW)
    expect(tombstone(t, NOW + 99).deletedAt).toBe(NOW)
    expect(restore(t).deletedAt).toBeUndefined()
    expect(isLive(restore(t))).toBe(true)
  })
  it('expires after exactly 30 days, not before', () => {
    expect(TOMBSTONE_MS).toBe(30 * 86_400_000)
    const t = tombstone(meta('1'), NOW)
    expect(expired(t, NOW + TOMBSTONE_MS - 1)).toBe(false)
    expect(expired(t, NOW + TOMBSTONE_MS)).toBe(true)
    expect(expired(meta('2'), NOW + 10 * TOMBSTONE_MS)).toBe(false)
    expect(trashedOf([t], 'x', NOW)).toEqual([])
  })
  it('an expired tombstone is no longer offered for restore', () => {
    const t = tombstone(meta('1', { people: ['p1'] }), NOW)
    expect(trashedOf([t], 'p1', NOW + TOMBSTONE_MS)).toEqual([])
  })
})

describe('storage', () => {
  it('formats bytes plainly', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })
  it('share of the quota in percent; unknown quota gives null', () => {
    expect(storageShare(50, 200)).toBe(25)
    expect(storageShare(50, 0)).toBeNull()
    expect(storageShare(1, 1_000_000)).toBe(0)
  })
  it('refuses a new photo that would take more than 80 % of the quota; unknown quota allows it', () => {
    expect(quotaRoom(70, 100, 5)).toBe(true)
    expect(quotaRoom(70, 100, 11)).toBe(false)
    expect(quotaRoom(70, 0, 5000)).toBe(true)
  })
})
