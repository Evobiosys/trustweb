import { describe, expect, it } from 'vitest'

const files = import.meta.glob(['../../src/desk*.{ts,svelte}', '../../src/view_menu.svelte', '../../src/keep_select.svelte'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Desk makes no network call (I1)', () => {
  it('finds the desk files', () => expect(Object.keys(files).length).toBeGreaterThan(5))
  for (const [f, text] of Object.entries(files)) {
    it(f, () => {
      for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', '"http', "'http", '`http', 'url(', '@import', 'trustweb/src/events', 'org_hits'])
        expect(text.includes(bad), `${f} contains ${bad}`).toBe(false)
    })
  }
})
