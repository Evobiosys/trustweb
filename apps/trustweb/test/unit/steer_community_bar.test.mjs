// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-community-bar: in Community mode the bottom bar is the Personal bar (same items, same order); the shell draws no 7-item bar of its own. */
import { createModeShell } from '../../src/ext/community_mode/shell.ts'
import { communityBar, communityShown, activeInterface } from '../../src/ext/community_mode/mode.ts'
import { bindTw, twRegistry } from '../../src/ext/registry.ts'

const store = new Map()
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k) }

const host = (state) => ({
  state: () => state, save() {}, overview: () => true, tabButton: () => { throw new Error('the shell must not build tab buttons') }, tabsEl: () => ({ querySelectorAll: () => [] }),
  changed() {}, openItem() {}, openPersonal() {}, settings() {}, newId: () => 'x', guest: () => false, toast() {},
})

describe('Community mode bottom bar', () => {
  it('the shell hands no bar of its own to the host while Community is the interface and its view is ready', () => {
    const state = { twSettings: { interfaces: { full: 'community' }, extensions: { 'community-mighty': true } }, extData: {} }
    bindTw({ settings: () => state.twSettings, save() {}, ctx: () => ({}) })
    expect(twRegistry.isEnabled('community-mode')).toBe(true)
    expect(twRegistry.isEnabled('community-mighty')).toBe(true)
    vi.spyOn(twRegistry, 'views').mockReturnValue([{ id: 'community' }]) // the heavy view's chunk is not loaded in node
    store.set('trustweb.ui.interface', 'community')
    expect(communityShown(activeInterface(true, false, state.twSettings, 'community'), true, true)).toBe(true) // the old rule would have drawn the 7-item row here
    expect(createModeShell(host(state)).tabs()).toBeNull() // null = main.ts draws the Personal bar
  })

  it('the Community navigation stays in the community view: the old 7-item row is still computable but unused', () => {
    expect(communityBar({}, [])).toEqual(['home', 'spaces', 'events', 'members', 'docs', 'chat', 'web'])
  })
})
