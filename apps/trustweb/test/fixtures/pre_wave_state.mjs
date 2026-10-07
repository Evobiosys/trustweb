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

/** The secret of the hosted account in the round-B record (64 hex). */
export const HOSTED_SECRET = 'ab'.repeat(32)

/**
 * The record as wave 1733 round B saves it: the pre-wave record (with sources
 * now) plus EVERY optional field round B adds, at every level: a server
 * transcription job (one cut off mid-call, one done), packs sent while the
 * transcript was still arriving (with their keys, A3), a kept pack still
 * arriving, the consent, the hosted account with its recordings, an import
 * batch, the Feed settings, a person's fediverse handle, an item's image.
 * Wave 2 (2026-10-07) adds its optional fields here too: a meeting's roughTimes, the audience "close",
 * an imported line's reviewedAt.
 * The regression net for rolling round B back: the pre-wave build must open
 * it, and its saves must keep every one of these fields.
 */
export function roundBState() {
  const s = preWaveState()
  s.inventory[0].source = { kind: 'typed' }
  s.inventory[1].source = { kind: 'recorded-solo', meetingId: 'm-inv', atMs: 0 }
  s.inventory[2].source = { kind: 'demo' }
  for (const p of s.people) for (const l of p.lines) l.source = p.id === 'demo-p1' ? { kind: 'demo' } : { kind: 'typed' }
  s.inventory.push({ id: 'imp1', text: 'Knows the Graz housing co-op board', audience: 'me', included: true, createdAt: NOW - DAY, source: { kind: 'tana', ref: '0123456789abcdef' } })
  s.inventory[0].imageId = 'img-1'
  s.transcription = 'server'
  s.serverTranscriptionConsentAt = NOW - DAY
  s.meetings[0].serverJob = { state: 'done', at: NOW - 3 * DAY, takesDone: 1 }
  // wave 2: the server estimated the times per sentence (approx); an item for close friends only (P22)
  s.meetings[0].roughTimes = true
  s.inventory.push({ id: 'close1', text: 'Offers a body-work session', audience: 'close', included: true, createdAt: NOW - DAY, source: { kind: 'typed' } })
  // wave 2 (B4): an imported line the person opened and kept
  s.inventory.push({ id: 'imp2', text: 'Can lend a cargo bike', audience: 'me', included: true, createdAt: NOW - DAY, source: { kind: 'tana', ref: 'fedcba9876543210', reviewedAt: NOW - 3_600_000 } })
  s.meetings[0].fullSentAt = NOW - 3 * DAY
  s.meetings[1].serverJob = { state: 'running', at: NOW - DAY, takesDone: 0 }
  s.meetings[1].outbox = [{ keyText: 'TW1R-AAAAA-BBBBB', title: 'Meeting with Cargo bike', notes: ['borrowable'], at: NOW - DAY }]
  s.meetings[2].late = { keyText: 'TW1R-CCCCC-DDDDD', etag: '"0123456789abcdef0123456789abcdef"', since: Date.now() - 1000 }
  s.received[0].pending = true
  s.received[0].keptAs = 'm-lea'
  s.hosting = { secret: HOSTED_SECRET, on: true, recs: [
    { meetingId: 'm-anna', rid: 'cd'.repeat(16), seconds: 3600, bytes: 14_400_000, at: NOW - DAY },
    // review-app-b: an upload whose answer was lost, waiting to go again under the same id
    { meetingId: 'm-inv', rid: 'ef'.repeat(16), seconds: 60, bytes: 240_000, at: NOW - DAY, pending: true },
  ] }
  s.imports = [
    // review-app-b: a fingerprint instead of a second copy of the text; and a batch saved before that
    { id: 'imp-batch-2', at: NOW - DAY, exportedOn: '2026-10-06', items: [{ itemId: 'imp1', key: '0123456789abcdef', sig: '1a2b3c4d' }] },
    { id: 'imp-batch-1', at: NOW - 2 * DAY, exportedOn: '2026-10-05', items: [{ itemId: 'imp0', key: 'fedcba9876543210', text: 'Old import line', audience: 'me' }] },
  ]
  // review-app-b: what an ask brought back, attributed by the peer that answered
  s.found = [{ id: 'f-1', at: NOW - DAY, text: 'Who has a ladder?', shared: [{ from: 'Anna', peerId: 'peer-anna', items: [{ text: 'Ladder, 3 m', context: 'What I have', when: 'early October' }] }] }]
  s.feed = { on: true, remote: true, images: false, myInstance: 'mastodon.social' }
  s.people[0].fediverse = { handle: 'anna@mastodon.social', show: true, reach: 'api' }
  // review-app-b: an address saved but never read yet (whether the instance allows this page is found out by the first read)
  s.people[1].fediverse = { handle: 'max@pixelfed.social', show: false }
  return s
}

/** The round-B fields of a record, for comparing them across saves (what an older build must keep). */
export function roundBFields(s) {
  return JSON.stringify({
    transcription: s.transcription, consent: s.serverTranscriptionConsentAt, hosting: s.hosting, imports: s.imports, feed: s.feed, found: s.found,
    meetings: (s.meetings ?? []).map((m) => ({ id: m.id, serverJob: m.serverJob, outbox: m.outbox, fullSentAt: m.fullSentAt, late: m.late, roughTimes: m.roughTimes })),
    received: (s.received ?? []).map((r) => [r.pending, r.keptAs]),
    fediverse: s.people.map((p) => p.fediverse ?? null),
    images: s.inventory.map((i) => i.imageId ?? null),
    tana: s.inventory.map((i) => i.source ?? null),
    audiences: s.inventory.map((i) => i.audience),
  })
}
