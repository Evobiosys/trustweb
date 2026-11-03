// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { PERSON_IMAGE_MAX_LEN, PERSON_IMAGE_SIDE, notePreview, personImageOk, withoutPersonImage } from '../../src/person_image.ts'
import { fitSize } from '../../src/image_store.ts'
import { bundleOf } from '../../src/sync_core.ts'

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

describe('person image', () => {
  it('is scaled to at most 256 px on the longer side, never up', () => {
    expect(PERSON_IMAGE_SIDE).toBe(256)
    expect(fitSize(1024, 512, PERSON_IMAGE_SIDE)).toEqual({ w: 256, h: 128 })
    expect(fitSize(100, 80, PERSON_IMAGE_SIDE)).toEqual({ w: 100, h: 80 })
  })
  it('accepts a JPEG data URL within the cap only', () => {
    expect(personImageOk(JPEG)).toBe(true)
    expect(personImageOk('data:image/png;base64,AAAA')).toBe(false)
    expect(personImageOk(JPEG + 'A'.repeat(PERSON_IMAGE_MAX_LEN))).toBe(false)
    expect(personImageOk(undefined)).toBe(false)
  })
  it('round-trips through the saved record', () => {
    const p = { id: 'a', name: 'Anna', image: JPEG }
    expect(JSON.parse(JSON.stringify({ people: [p] })).people[0].image).toBe(JPEG)
  })
  it('stays on this phone: withoutPersonImage drops it, an imageless person is returned as is', () => {
    const p = { id: 'a', name: 'Anna', image: JPEG }
    expect(withoutPersonImage(p)).toEqual({ id: 'a', name: 'Anna' })
    const q = { id: 'b', name: 'Ben' }
    expect(withoutPersonImage(q)).toBe(q)
  })
  it('the sync bundle carries no person image', () => {
    const s = { v: 1, people: [{ id: 'a', name: 'Anna', lines: [], image: JPEG }], inventory: [], meetings: [] }
    expect(bundleOf(s, {}).people[0].image).toBeUndefined()
  })
  it('notePreview is the general note, else the context, clipped', () => {
    expect(notePreview({ generalNote: 'x'.repeat(300), context: 'c' }, 10)).toBe('xxxxxxxxx…')
    expect(notePreview({ context: 'met at the fair' })).toBe('met at the fair')
    expect(notePreview({ context: '' })).toBe('')
  })
})
