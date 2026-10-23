// The fold state is a plain string list in prefs (prefs.svelte.ts is a rune module: not importable here, see vitest.config.ts); the
// pure part lives in contacts.ts.
import { describe, expect, it } from 'vitest'
import { foldedKeys, toggleAll, toggleGroup } from '../../src/contacts'

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
  it('a device that never chose (null) starts with every group folded', () => {
    expect(foldedKeys(null, ['close', 'friend'])).toEqual(['close', 'friend'])
  })
  it('a saved [] means the user opened all', () => {
    expect(foldedKeys([], ['close', 'friend'])).toEqual([])
    expect(foldedKeys(JSON.parse(JSON.stringify({ c: [] })).c, ['close'])).toEqual([])
  })
  it('opening one group from never-chosen keeps the others folded', () => {
    expect(toggleGroup(foldedKeys(null, ['close', 'friend', 'acquaintance']), 'friend')).toEqual(['close', 'acquaintance'])
  })
  it('Show all from never-chosen opens all and saves []', () => {
    expect(toggleAll(foldedKeys(null, ['close', 'friend']), ['close', 'friend'])).toEqual([])
  })
})
