/** Wave 19 (Jakob 2026-10-23): one view switch, four views (Dex, TrustWeb Desk, Classic, TrustWeb), one naming; Settings > View is a half pill. */
import { describe, expect, it } from 'vitest'
import { View } from '../../src/nav'
import { S } from '../../src/strings'
import { DEX_URL, viewChoices, viewLabel } from '../../src/view_pick'

const files = import.meta.glob(['../../src/*.svelte'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const src = (f: string): string => files[`../../src/${f}`] ?? ''
const noop = (): void => {}

describe('viewChoices', () => {
  it('inside TrustWeb: Dex, TrustWeb Desk, Classic, TrustWeb', () => expect(viewChoices({ showPhoneVersion: noop })).toEqual([View.Dex, View.Desk, View.Classic, View.TrustWeb]))
  it('standalone: Dex, TrustWeb Desk and Classic', () => expect(viewChoices({})).toEqual([View.Dex, View.Desk, View.Classic]))
})

describe('one naming', () => {
  it('labels', () => {
    expect([View.Dex, View.Desk, View.Classic, View.TrustWeb].map(viewLabel)).toEqual(['Dex', 'Contacts (wide)', 'Contacts', 'TrustWeb'])
    expect(S.views).toMatchObject({ dex: 'Dex', classic: 'Contacts', trustweb: 'TrustWeb', dexInfo: 'Dex-inspired' })
  })
  it('the profile menu item is "TrustWeb view"', () => expect(S.desk.profile.phone).toBe('TrustWeb view'))
  it('Dex links to getdex.com', () => expect(DEX_URL).toBe('https://getdex.com'))
})

describe('where the switch lives', () => {
  it('Settings has the View half pill, no select', () => {
    expect(src('settings.svelte')).toContain('<ViewPill')
    expect(src('settings.svelte')).not.toContain('data-field="view"')
  })
  it('the half pill and the chevron list the same choices; the Dex line links out in a new tab', () => {
    for (const f of ['view_pill.svelte', 'view_menu.svelte']) expect(src(f)).toContain('viewChoices(host)')
    expect(src('view_menu.svelte')).not.toContain('membranes')
    expect(src('view_pill.svelte')).toMatch(/href=\{DEX_URL\} target="_blank" rel="noopener"/)
  })
})
