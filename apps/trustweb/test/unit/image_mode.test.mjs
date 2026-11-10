// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 40 photo-rails: Tools > Images: show / grey out / hide. One device setting, applied to every picture.
import { IMAGE_MODES, imageMode, parseImageMode, pictureUrl, readImageMode, setImageMode, writeImageMode, nextImageMode } from '../../src/image_mode.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }

describe('image mode', () => {
  it('has three modes, show first and the default', () => {
    expect(IMAGE_MODES).toEqual(['show', 'grey', 'hide'])
    expect(parseImageMode(undefined)).toBe('show')
    expect(parseImageMode('nonsense')).toBe('show')
    expect(parseImageMode('grey')).toBe('grey')
  })
  it('is remembered on this device; show is stored as nothing', () => {
    const st = mem()
    expect(readImageMode(st)).toBe('show')
    writeImageMode('hide', st)
    expect(readImageMode(st)).toBe('hide')
    writeImageMode('show', st)
    expect(st.getItem('trustweb.v1.imagemode')).toBeNull()
    expect(readImageMode(st)).toBe('show')
  })
  it('a broken storage reads as show and never throws', () => {
    const bad = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }
    expect(readImageMode(bad)).toBe('show')
    expect(() => writeImageMode('grey', bad)).not.toThrow()
  })
  it('hide drops the picture (initials show instead), grey and show keep it', () => {
    expect(pictureUrl('show', 'data:x')).toBe('data:x')
    expect(pictureUrl('grey', 'data:x')).toBe('data:x')
    expect(pictureUrl('hide', 'data:x')).toBeUndefined()
    expect(pictureUrl('show', undefined)).toBeUndefined()
  })
  it('cycles show -> grey out -> hide -> show', () => {
    expect(['show', 'grey', 'hide'].map(nextImageMode)).toEqual(['grey', 'hide', 'show'])
  })
  it('setImageMode stores it and the app reads the new mode at once (no storage read per picture)', () => {
    const st = mem()
    setImageMode('grey', st)
    expect(imageMode()).toBe('grey')
    expect(readImageMode(st)).toBe('grey')
    setImageMode('show', st)
    expect(imageMode()).toBe('show')
  })
})
