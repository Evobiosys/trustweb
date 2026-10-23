/** Wave 19 (Jakob 2026-10-23): the Desk's profile button (top right) and its menu, in place of the sheet's "× Home". */
import { describe, expect, it } from 'vitest'
import { ProfileItem, profileItems } from '../../src/profile_menu'

const files = import.meta.glob(['../../src/*.svelte', '../../src/nav.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const src = (f: string): string => files[`../../src/${f}`] ?? ''
const noop = (): void => {}

describe('profileItems', () => {
  it('inside TrustWeb: My profile, Settings, Show phone version, Close the Desk, in that order', () => {
    expect(profileItems({ renderProfile: () => ({}) as HTMLElement, showPhoneVersion: noop, closeDesk: noop })).toEqual([ProfileItem.Profile, ProfileItem.Settings, ProfileItem.Phone, ProfileItem.Close])
  })
  it('standalone (no host hooks): Settings only', () => {
    expect(profileItems({})).toEqual([ProfileItem.Settings])
  })
})

describe('where the button lives', () => {
  it('in the Desk topbar after the view menu, never in the classic face', () => {
    const top = src('desk_topbar.svelte')
    expect(top.indexOf('<ProfileMenu')).toBeGreaterThan(top.indexOf('<ViewMenu'))
    expect(src('app.svelte')).not.toContain('ProfileMenu')
    expect(src('profile_menu.svelte')).toContain('data-profile-button')
  })
  it('My profile opens the Desk profile page, which shows the host-lent editor', () => {
    expect(src('nav.ts')).toMatch(/Profile = 'profile'/)
    expect(src('desk.svelte')).toMatch(/DeskPage\.Profile[\s\S]*<DeskProfile/)
    expect(src('desk_profile.svelte')).toContain('host.renderProfile')
  })
})
