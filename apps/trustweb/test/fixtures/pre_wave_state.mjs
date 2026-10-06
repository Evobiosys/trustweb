/**
 * A record exactly as the TrustWeb build BEFORE wave 1733 saved it (tag
 * trustweb-pre-wave-1733-2026-10-06): no `source` anywhere, and a bit of
 * everything a real phone can hold (connected and note-only people, gone
 * notes, custom tags, channels, stored meetings with and without a person,
 * a kept meeting pack, demo content, demo accounts, received shares, and
 * fields this build does not know at three levels). Shared by
 * test/unit/state_safety.test.mjs and test/e2e/state_migration.mjs: the
 * regression net for every round that touches the stored record.
 */
import { AboutKind, Audience, LineStatus, Ring, Tag } from '../../src/model.ts'

export const NOW = 1_760_000_000_000
const DAY = 86_400_000

export const line = (id, text, extra = {}) => ({
  id, text, tag: Tag.Note, audience: Audience.Friends, status: LineStatus.Current, notedAt: NOW - 3 * DAY, checkedAt: NOW - 3 * DAY, ...extra,
})

/** A record exactly as the pre-wave build saved it (no `source` anywhere), with a bit of everything Jakob's phone can hold. */
export function preWaveState() {
  return {
    v: 1,
    me: { id: 'jakob-me-id', displayName: 'Jakob' },
    identity: { v: 1, did: 'did:peer:2.live', secret: 'LIVE-SECRET' },
    peers: [{ id: 'peer-anna', displayName: 'Anna', did: 'did:peer:2.anna', ring: Ring.Close, connectedAt: NOW - 9 * DAY }],
    people: [
      // connected, notes saved with a stored meeting (one exact, one prefixed by the about)
      { id: 'anna', name: 'Anna', context: 'Impact Hub', ring: Ring.Close, metAt: NOW - 9 * DAY, peerId: 'peer-anna',
        channels: { signal: '+43 660 0000000' },
        lines: [line('a1', 'Looking for a flat in Graz', { tag: Tag.Looking }), line('a2', 'Has a spare ladder', { tag: Tag.Offer, customTag: 'tools' }), line('a3', 'Old note', { status: LineStatus.Gone })] },
      // notes only (no stored meeting: older notes listed by person and day)
      { id: 'max', name: 'Max', context: 'Café Prückel', ring: Ring.Friend, metAt: NOW - 20 * DAY,
        lines: [line('x1', 'Knows a 3D printer', { notedAt: NOW - 20 * DAY, checkedAt: NOW - 20 * DAY }), line('x2', 'Typed by hand', { notedAt: NOW - 20 * DAY, checkedAt: NOW - 20 * DAY })],
        futureField: { keep: 'me' } },
      // came from a kept meeting pack (another phone sent it)
      { id: 'lea', name: 'Lea', context: 'Shared by Lea', ring: Ring.Acquaintance, metAt: NOW - 2 * DAY, lines: [line('l1', 'Runs a repair café', { audience: Audience.OnlyMe })] },
      // demo content (Show demo content)
      { id: 'demo-p1', name: 'Maya', context: 'Imaginary', ring: Ring.Friend, metAt: NOW, lines: [line('d1', 'Dummy note')] },
      // a person without notes
      { id: 'empty', name: 'Ben', context: '', ring: Ring.Intending, metAt: NOW, lines: [] },
    ],
    inventory: [
      { id: 'i1', text: 'Motorbike, weekends', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW - 30 * DAY },
      { id: 'i2', text: 'Cargo bike: borrowable', audience: Audience.Friends, included: false, createdAt: NOW - 3 * DAY },
      { id: 'demo-i1', text: 'Dummy thing', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW },
    ],
    log: [{ id: 'log1', at: NOW - DAY, from: 'Anna', text: 'ladder?', outcome: 'shared', peerId: 'peer-anna' }],
    notificationsOn: true,
    tabOrder: 'inventory-left',
    queryStyle: 'call',
    myChannels: { signal: '+43 660 1111111' },
    talkWeaveLocal: true,
    defaultRecording: 'meeting',
    demo: { people: ['demo-p1'], inventory: ['demo-i1'] },
    demoOffered: true,
    showRingNames: true,
    hiddenHints: ['meeting'],
    testAccounts: [{ id: 'acc1', name: 'Jakob-demo', createdAt: NOW - DAY, expiresAt: NOW + 6 * DAY, peerId: 'peer-demo' }],
    found: [],
    meetings: [
      { id: 'm-anna', about: 'Anna', kind: AboutKind.Who, personId: 'anna', where: 'Impact Hub', startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY + 3_600_000,
        durationMs: 3_600_000, meeting: true,
        lines: [{ text: 'Looking for a flat in Graz', tag: Tag.Looking }, { text: 'Has a spare ladder', tag: Tag.Offer }],
        transcript: [{ speaker: 1, atMs: 0, text: 'Hello Anna' }, { speaker: 2, atMs: 61_000, text: 'I am looking for a flat in Graz' }] },
      { id: 'm-inv', about: 'Cargo bike', kind: AboutKind.What, where: '', startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY, durationMs: 0, meeting: false,
        lines: [{ text: 'borrowable', tag: Tag.Offer }], transcript: [] },
      { id: 'm-lea', about: 'Lea', kind: AboutKind.Who, personId: 'lea', where: 'Vienna', startedAt: NOW - 2 * DAY, endedAt: NOW - 2 * DAY, durationMs: 1000, meeting: true,
        lines: [{ text: 'Runs a repair café', tag: Tag.Note }], transcript: [{ speaker: 1, atMs: 0, text: 'hi' }], fromName: 'Lea', laterField: 7 },
    ],
    received: [{ id: 'r1', at: NOW - DAY, fromName: 'Lea', fromPeerId: 'peer-lea', link: 'https://app.idea2.site/trustweb/?share=1#k=x', title: 'Meeting with Lea' }],
    demoOnlyForDemoAccounts: true,
    unknownTopLevel: { from: 'a later build', n: 1 },
  }
}
