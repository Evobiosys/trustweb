// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Sync v3 (wave 26): every setting the owner made travels between their own devices; only what is structurally per device stays. */
import { SYNC_VERSION, SYNC_EXCLUDED, bundleOf, fromChunks, mergeBundle, parseBundle, refreshStamps, stampsAfterMerge, toChunks } from '../../src/sync_core.ts'

const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const stamps = (s, at) => refreshStamps(s, {}, at, 'T')
const send = (s, at) => fromChunks(toChunks(bundleOf(s, stamps(s, at))))

describe('sync v3 settings', () => {
  it('is version 3 and a v2 bundle (no settings) still reads and merges', () => {
    expect(SYNC_VERSION).toBe(3)
    const b = parseBundle({ v: 2, people: [], inventory: [], meetings: [], at: {}, by: {}, channels: { mine: {}, share: {} }, events: [], chats: {} })
    expect(b).not.toBeNull()
    const mine = state({ chatsHidden: true })
    mergeBundle(mine, {}, b, 0)
    expect(mine.chatsHidden).toBe(true)
  })
  it('round trip carries chatsHidden, settings sub-objects, engagement, city, membraneLimit and advanced', () => {
    const src = state({
      chatsHidden: true, membraneLimit: 8, city: 'Graz', engagementDays: 30, askDirectOnly: true, showRingNames: true,
      feed: { on: true, myInstance: 'x.example' }, features: { events: false }, advanced: { aiEndpoint: 'http://h', aiKey: 'k' },
    })
    const dst = state()
    mergeBundle(dst, {}, send(src, 10), 0)
    expect(dst).toMatchObject({
      chatsHidden: true, membraneLimit: 8, city: 'Graz', engagementDays: 30, askDirectOnly: true, showRingNames: true,
      feed: { on: true, myInstance: 'x.example' }, features: { events: false }, advanced: { aiEndpoint: 'http://h', aiKey: 'k' },
    })
  })
  it('a field added to AppState later travels without code change', () => {
    const dst = state()
    mergeBundle(dst, {}, send(state({ someFutureSwitch: 'on' }), 10), 0)
    expect(dst.someFutureSwitch).toBe('on')
  })
  it('structurally per-device fields stay out, in the bundle and on the receiving side', () => {
    const src = state({ identity: { k: 1 }, peers: [{ id: 'p' }], hosting: { secret: 's' }, connectCode: { code: 'c' }, atEvent: { eventId: 'e', since: 1 }, notificationsOn: true, tabRow: ['a'], shareMode: 'qr', chatsHidden: true })
    const bundle = send(src, 10)
    expect(Object.keys(bundle.settings)).toEqual(['chatsHidden'])
    const forged = parseBundle({ ...JSON.parse(JSON.stringify(bundle)), settings: { chatsHidden: true, identity: { k: 1 }, peers: [], __proto__: { x: 1 }, people: [] } })
    expect(Object.keys(forged.settings)).toEqual(['chatsHidden'])
    for (const k of ['identity', 'peers', 'hosting', 'connectCode', 'atEvent', 'notificationsOn', 'tabRow', 'shareMode']) expect(SYNC_EXCLUDED.has(k)).toBe(true)
    const dst = state()
    mergeBundle(dst, {}, bundle, 0)
    expect(dst.identity).toBeUndefined()
    expect(dst.hosting).toBeUndefined()
  })
  it('the newer stamp wins per field, an older one does not overwrite', () => {
    const mine = state({ city: 'Graz', chatsHidden: false })
    const myStamps = stamps(mine, 100)
    const theirs = state({ city: 'Linz', chatsHidden: true })
    const incoming = bundleOf(theirs, stamps(theirs, 50))
    incoming.at['g:chatsHidden'] = 200
    mergeBundle(mine, myStamps, incoming, 0)
    expect(mine.city).toBe('Graz')
    expect(mine.chatsHidden).toBe(true)
  })
  it('nothing is deleted: a setting the other side lacks stays, and stamps follow the adopted value', () => {
    const mine = state({ city: 'Graz', membraneLimit: 7 })
    const theirs = state({ city: 'Graz' })
    mergeBundle(mine, stamps(mine, 100), bundleOf(theirs, stamps(theirs, 200)), 0)
    expect(mine.membraneLimit).toBe(7)
    const adopt = state()
    const inc = send(state({ chatsHidden: true }), 300)
    mergeBundle(adopt, {}, inc, 0)
    const after = stampsAfterMerge(adopt, {}, inc, 400, 'D', 'Other')
    expect(after['g:chatsHidden'].at).toBe(300)
  })
})
