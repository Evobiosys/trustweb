import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('prefs.collapsedGroups', () => {
  beforeEach(() => {
    vi.resetModules()
    for (const k of ['__TW_TANA_TOKEN__', '__TW_RECORD__', '__TW_NOTES_TOKEN__']) vi.stubGlobal(k, '')
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
  })
  it('starts empty and survives a save + reload', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
    const a = await import('../../src/prefs.svelte')
    expect(a.prefs.collapsedGroups).toEqual([])
    a.prefs.collapsedGroups = ['friend']
    a.savePrefs()
    vi.resetModules()
    const b = await import('../../src/prefs.svelte')
    expect(b.prefs.collapsedGroups).toEqual(['friend'])
  })
})
