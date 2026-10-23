// The fold state is a plain string list in prefs (prefs.svelte.ts is a rune module: not importable here, see vitest.config.ts); the
// pure part lives in contacts.ts.
import { describe, expect, it } from 'vitest'
import { toggleGroup } from '../../src/contacts'

describe('collapsed ring groups', () => {
  it('toggles a group in and out, keeps the others, never duplicates', () => {
    expect(toggleGroup([], 'friend')).toEqual(['friend'])
    expect(toggleGroup(['friend'], 'close')).toEqual(['friend', 'close'])
    expect(toggleGroup(['friend', 'close'], 'friend')).toEqual(['close'])
    expect(toggleGroup(toggleGroup([], 'friend'), 'friend')).toEqual([])
  })
  it('survives a JSON round trip as saved prefs do', () => {
    const saved = JSON.parse(JSON.stringify({ collapsedGroups: toggleGroup([], 'friend') }))
    expect(saved.collapsedGroups).toEqual(['friend'])
  })
})
