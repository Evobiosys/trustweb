// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { COLOUR_TAGS_KEY, SHOW_SYSTEM_TAGS_KEY, defineSystemTag, loadColourTags, saveColourTags, setShowSystemTags, showSystemTags, tagsOf } from '../../src/colour_tags.ts'

const store = new Map()
beforeEach(() => {
  store.clear()
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
  globalThis.window = { dispatchEvent: () => true }
  globalThis.Event = class { constructor(t) { this.type = t } }
})

describe('system tags (#import:...)', () => {
  it('are hidden by default and shown after the Tools toggle', () => {
    saveColourTags([{ id: 'minerva', colour: '#2e7d32', label: 'Minerva' }])
    defineSystemTag('import:2026-11-10-vcf')
    expect(loadColourTags().map((t) => t.id)).toEqual(['minerva'])
    expect(showSystemTags()).toBe(false)
    setShowSystemTags(true)
    expect(loadColourTags().map((t) => t.id)).toEqual(['minerva', 'import:2026-11-10-vcf'])
    expect(store.get(SHOW_SYSTEM_TAGS_KEY)).toBe('1')
  })
  it('a person holding one shows no chip while hidden', () => {
    defineSystemTag('import:2026-11-10-vcf')
    const p = { ring: 'friend', fields: { 'import:2026-11-10-vcf': true } }
    expect(tagsOf(p, loadColourTags())).toEqual([])
    setShowSystemTags(true)
    expect(tagsOf(p, loadColourTags()).map((t) => t.label)).toEqual(['#import:2026-11-10-vcf'])
  })
  it('saving the visible tags never loses a hidden system tag', () => {
    defineSystemTag('import:2026-11-10-vcf')
    saveColourTags([{ id: 'a', colour: '#2e7d32', label: 'A' }])
    setShowSystemTags(true)
    expect(loadColourTags().map((t) => t.id).sort()).toEqual(['a', 'import:2026-11-10-vcf'])
    expect(JSON.parse(store.get(COLOUR_TAGS_KEY)).length).toBe(2)
  })
  it('defining the same system tag twice keeps one', () => {
    defineSystemTag('import:x'); defineSystemTag('import:x')
    setShowSystemTags(true)
    expect(loadColourTags().filter((t) => t.id === 'import:x')).toHaveLength(1)
  })
})
