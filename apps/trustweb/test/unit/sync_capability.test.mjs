// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 sync-visibility: which devices can sync a local vault / Tana, and where the entries sit (main surface or Advanced). */
import { canSyncLocalVault, canSyncTana, syncCapabilities, syncEnvFrom, syncPlacement } from '../../src/sync_capability.ts'

const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const win = (over = {}) => ({ innerWidth: 1280, matchMedia: () => ({ matches: false }), ...over })
const nav = (userAgent, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints })

describe('sync capability', () => {
  it('a desktop browser can sync a local vault and Tana, both on the main surface', () => {
    const env = syncEnvFrom(win(), nav(DESKTOP_UA))
    expect(canSyncLocalVault(env)).toBe(true)
    expect(canSyncTana(env)).toBe(true)
    expect(syncPlacement(env)).toEqual({ obsidian: 'main', tana: 'main' })
  })
  it('a phone (coarse pointer, narrow) cannot sync a vault; both entries move under Advanced', () => {
    const env = syncEnvFrom(win({ innerWidth: 360, matchMedia: () => ({ matches: true }) }), nav(ANDROID_UA, 5))
    expect(canSyncLocalVault(env)).toBe(false)
    expect(canSyncTana(env)).toBe(true)
    expect(syncPlacement(env)).toEqual({ obsidian: 'advanced', tana: 'advanced' })
  })
  it('an Android or iOS agent is a phone even in a wide window or with a fine pointer', () => {
    expect(canSyncLocalVault(syncEnvFrom(win(), nav(ANDROID_UA)))).toBe(false)
    expect(canSyncLocalVault(syncEnvFrom(win(), nav(IPHONE_UA, 5)))).toBe(false)
  })
  it('a Tauri shell can always sync a vault, whatever the window', () => {
    const env = syncEnvFrom(win({ __TAURI__: {}, innerWidth: 360, matchMedia: () => ({ matches: true }) }), nav(ANDROID_UA))
    expect(canSyncLocalVault(env)).toBe(true)
    expect(syncPlacement(env)).toEqual({ obsidian: 'main', tana: 'main' })
  })
  it('missing window/navigator (SSR, tests) reads as a desktop; a throwing matchMedia is no phone', () => {
    expect(canSyncLocalVault(syncEnvFrom(undefined, undefined))).toBe(true)
    expect(canSyncLocalVault(syncEnvFrom(win({ matchMedia: () => { throw new Error('x') } }), nav(DESKTOP_UA)))).toBe(true)
  })
  it('syncCapabilities (the MCP answer) reports both flags and the placement', () => {
    expect(syncCapabilities(syncEnvFrom(win({ innerWidth: 360, matchMedia: () => ({ matches: true }) }), nav(ANDROID_UA)))).toEqual({
      localVault: false, tana: true, placement: { obsidian: 'advanced', tana: 'advanced' },
    })
  })
})
