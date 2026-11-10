// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 ai-edit-chat: variations made by the assistant (custom profiles in src/ext/profiles.ts) and the person lookup's quick answer. */
import { profileOf, profileDef, switchProfile, addCustom, removeCustom, customProfile, safeTokens, allProfiles } from '../../src/ext/profiles.ts'
import { quickLook } from '../../src/ext/assistant/person_context.ts'
import { Ring } from '../../src/model.ts'

const DEFAULTS = { events: true, resources: true, feed: true, matches: true, 'support-ask': true, 'ai-button': true }
const quiet = { id: 'custom-quiet', name: 'Quiet', base: 'reader', modules: { feed: false }, look: 'sleek', tokens: { '--trust': '#335577' } }

describe('custom variations', () => {
  it('customProfile validates a raw object into a variation; slug id from the name', () => {
    expect(customProfile({ name: 'Quiet reader', base: 'reader', modules: { feed: false } }, Object.keys(DEFAULTS))).toEqual({ id: 'custom-quiet-reader', name: 'Quiet reader', base: 'reader', modules: { feed: false } })
    expect(() => customProfile({ name: '', base: 'full' }, [])).toThrow('name is required')
    expect(() => customProfile({ name: 'X', base: 'root' }, [])).toThrow('base must be one of')
    expect(() => customProfile({ name: 'X', base: 'full', modules: { evil: true } }, ['feed'])).toThrow('unknown module: evil')
  })

  it('safeTokens keeps design tokens with plain values only', () => {
    expect(safeTokens({ '--trust': '#335577', '--r-card': '4px', '--line': 'rgba(0,0,0,.1)', '--dur-1': '90ms' })).toEqual({ '--trust': '#335577', '--r-card': '4px', '--line': 'rgba(0,0,0,.1)', '--dur-1': '90ms' })
    expect(() => safeTokens({ '--trust': 'url(x)' })).toThrow('unsafe value for --trust')
    expect(() => safeTokens({ '--trust': 'red;}body{display:none' })).toThrow()
    expect(() => safeTokens({ background: '#fff' })).toThrow('not a design token: background')
  })

  it('addCustom lists it; profileOf and profileDef read it over its base', () => {
    const tw = addCustom(undefined, quiet)
    expect(allProfiles(tw).map((p) => p.id)).toEqual(['full', 'iyg-support', 'reader', 'note-taker', 'custom-quiet'])
    const on = switchProfile(tw, 'custom-quiet', DEFAULTS)
    expect(profileOf(on)).toBe('custom-quiet')
    expect(on.custom).toEqual([quiet])
    const def = profileDef('custom-quiet', on)
    expect(def.readOnly).toBe(true)
    expect(def.modules).toEqual({ 'support-ask': false, feed: false })
    expect(on.extensions.feed).toBe(false)
  })

  it('same name again replaces the variation; removeCustom drops it and falls back to its base', () => {
    let tw = addCustom(addCustom(undefined, quiet), { ...quiet, tokens: {} })
    expect(tw.custom).toHaveLength(1)
    tw = switchProfile(tw, 'custom-quiet', DEFAULTS)
    tw = removeCustom(tw, 'custom-quiet', DEFAULTS)
    expect(tw.custom).toEqual([])
    expect(profileOf(tw)).toBe('reader')
  })

  it('an unknown custom id reads as full', () => {
    expect(profileOf({ profile: 'custom-gone' })).toBe('full')
  })
})

describe('quickLook (local data, no network)', () => {
  const s = {
    people: [
      { id: 'p1', name: 'Ada Lovelace', context: 'met at the fair', ring: Ring.Friend, metAt: 0, lines: [], fields: { iyg: 'true' }, knows: ['p2'], generalNote: 'Writes poems.', sources: [{ source: 'vcf', file: 'a.vcf', importedAt: Date.UTC(2026, 10, 1), key: 'k' }] },
      { id: 'p2', name: 'Bo Tester', context: '', ring: Ring.Close, metAt: 0, lines: [] },
    ],
  }
  const tags = [{ id: 'iyg', colour: '#2e7d32', label: 'IYG' }]

  it('a person: ring, tags, context, who they know, note, where they came from', () => {
    const lines = quickLook(s, { personId: 'p1' }, tags)
    expect(lines.join('\n')).toContain('Ada Lovelace')
    expect(lines.join('\n')).toContain('Friend')
    expect(lines.join('\n')).toContain('#IYG')
    expect(lines.join('\n')).toContain('met at the fair')
    expect(lines.join('\n')).toContain('Bo Tester')
    expect(lines.join('\n')).toContain('Writes poems.')
    expect(lines.join('\n')).toContain('a.vcf')
  })

  it('an import row: name, tags, note and the person it may already be', () => {
    const lines = quickLook(s, { row: { key: 'r', name: 'Ada Lovelace', labels: ['Board'], note: 'CEO', emails: ['ada@x.org'] } }, tags)
    const t = lines.join('\n')
    expect(t).toContain('#Board')
    expect(t).toContain('CEO')
    expect(t).toContain('already in your web')
  })
})
