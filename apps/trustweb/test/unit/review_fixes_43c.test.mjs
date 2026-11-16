// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** review-fixes-43c: unit proofs of the fixes of the wave-43c review (DEVLOG/wave43/review-fixes-43c_result-report.txt). */
import { describe, expect, it } from 'vitest'
import { layoutShareAllowed } from '../../src/ext/community-mighty/community_server.ts'

describe('F: trusted-only closes the dashboard aggregate server path too', () => {
  it('needs the per-community opt-in AND servers allowed', () => {
    expect(layoutShareAllowed({}, true)).toBe(true)
    expect(layoutShareAllowed({}, false)).toBe(false)
    expect(layoutShareAllowed({ trustedOnly: true }, true)).toBe(false)
  })
})

import { SocialHost } from '../../src/social_hosting.ts'
describe('F: a person who is not discoverable never calls the directory (no periodic intents pull with their key)', () => {
  const host = (state, calls) => new SocialHost({
    self: { did: 'did:peer:2.Vzme' }, state: () => state, sign: () => 'sig', verify: () => true, now: () => 1, wait: async () => undefined,
    send: async () => undefined, save: () => undefined,
    dir: () => ({ origins: ['https://dir.test'], now: () => 1, verify: () => true, fetch: async (url) => { calls.push(url); return { status: 200, json: async () => ({ intents: [] }) } } }),
  })
  it('not discoverable: no request', async () => {
    const calls = []
    expect(await host({ people: [], peers: [] }, calls).pullIntents()).toBe(0)
    expect(calls).toEqual([])
  })
  it('discoverable: pulls', async () => {
    const calls = []
    await host({ discoverable: true, people: [], peers: [] }, calls).pullIntents()
    expect(calls.length).toBe(1)
  })
})

import { WEB_ONLY_KINDS, visibleKinds } from '../../src/notice_layer.ts'
describe('F: persistent cards (ask results, message cards) stay on the Web screen; toasts follow everywhere (P06, 43b sweep)', () => {
  it('cards are Web-only; transient kinds are not', () => {
    expect(WEB_ONLY_KINDS).toEqual(['cards', 'wants'])
  })
  it('off the Web screen the cards neither show nor take a cap slot', () => {
    expect(visibleKinds(new Set(['cards', 'toast']), 3, false)).toEqual(['toast'])
    expect(visibleKinds(new Set(['cards', 'toast']), 3, true)).toEqual(['cards', 'toast'])
    expect(visibleKinds(new Set(['cards', 'update', 'notice', 'toast']), 3, false)).toEqual(['update', 'notice', 'toast'])
  })
})
