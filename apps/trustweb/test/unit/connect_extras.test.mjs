// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c connect-extras: eta event envelope (wire, policy, fill, controller), zeta Mastodon default, theta dashboard aggregates. Fake data only. */
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { EVENT_LINK_MAX } from '../../../demo/src/types.ts'
import { encodeEventLink } from '../../src/event_link.ts'
import { newEvent } from '../../src/events.ts'
import { EVENT_SHOW_WINDOW_MS, EVENT_WANT_RETRY_MS, mayAnswer, createEventEnvelopes, fillEvent, isIncomplete } from '../../src/event_envelope.ts'
import { MASTODON_DEFAULT_INSTANCE, MASTODON_POST_ENABLED, eventMastodonHost } from '../../src/mastodon_default.ts'
import { S } from '../../src/strings.ts'
import {
  DASHBOARD_SOCIAL_DEFAULTS, dashboardSocial, followTiles, parseCommunity, mergeCommunity, setShareLayout, shareLayoutOn, tilePercents, tileSetOf, toggleTile, setOwnTiles,
} from '../../src/ext/community-mighty/community_data.ts'
import { AGG_MIN_MEMBERS, COMMUNITY_AGG_PATH, fetchAggregate, parseAggregate, sendTileSet } from '../../src/ext/community-mighty/community_server.ts'

const ORIGIN = 'https://app.trustweb.one'
const FULL = { name: 'Winter IYG', from: '2026-12-30', to: '2027-01-02', where: 'Gasthof Alpenrose, Hinterstoder', conditions: 'Bring a warm jacket.', themes: ['trust', 'commons'], organizer: 'Verein Beispiel', hosts: ['Ben Example'] }
const mk = (over = {}, id = 'e1abc') => newEvent({ ...FULL, ...over }, id, 5)
const linkOf = (ev) => encodeEventLink(ev, ORIGIN, 'peer', { name: 'Ben Example' })
const ME = { id: 'me1', displayName: 'Ben Example' }

describe('wire: the event envelope', () => {
  it('a want round trips; only the id travels', () => {
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', want: 'e1abc' }))).toEqual({ v: 1, t: 'event', want: 'e1abc' })
  })
  it('a link envelope round trips and has its own bound, far above the 500-character chat cap', () => {
    const link = linkOf(mk({ conditions: 'x'.repeat(2000) }))
    expect(link.length).toBeGreaterThan(500)
    expect(link.length).toBeLessThan(EVENT_LINK_MAX)
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', link }))).toEqual({ v: 1, t: 'event', link })
  })
  it('rejects: neither or both of want and link, a bad id, an over-long or non-text link', () => {
    for (const bad of [{}, { want: 'a', link: 'b' }, { want: 'has space' }, { want: '' }, { want: 5 }, { link: '' }, { link: 'x'.repeat(EVENT_LINK_MAX + 1) }, { link: 7 }]) {
      expect(decodeFromQr(JSON.stringify({ v: 1, t: 'event', ...bad }))).toBeNull()
    }
  })
  it('reads nothing else a sender put in', () => {
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'event', want: 'e1', extra: { a: 1 } }))).toEqual({ v: 1, t: 'event', want: 'e1' })
  })
})

describe('fillEvent and isIncomplete', () => {
  it('a short QR event (no place) is incomplete; one with a place is not', () => {
    expect(isIncomplete({ where: '' })).toBe(true)
    expect(isIncomplete({ where: 'Linz' })).toBe(false)
  })
  it('fills only what is empty, never overwrites what the receiver holds', () => {
    const mine = { ...mk({ where: '', conditions: undefined, themes: undefined, organizer: undefined, hosts: undefined }), name: 'My own name' }
    const changed = fillEvent(mine, mk())
    expect(changed).toBe(true)
    expect(mine).toMatchObject({ name: 'My own name', where: 'Gasthof Alpenrose, Hinterstoder', conditions: 'Bring a warm jacket.', themes: ['trust', 'commons'], organizer: 'Verein Beispiel', hosts: ['Ben Example'] })
    expect(fillEvent(mine, mk({ where: 'Elsewhere' }))).toBe(false)
    expect(mine.where).toBe('Gasthof Alpenrose, Hinterstoder')
  })
})

describe('mayAnswer: who may get the event', () => {
  const ev = mk({ hosts: ['Someone Else'] })
  const s = (events) => ({ events, me: ME, people: [] })
  it('the event I just showed as a QR, within the window', () => {
    expect(mayAnswer(s([ev]), 'e1abc', { id: 'e1abc', at: 1000 }, 1000 + EVENT_SHOW_WINDOW_MS - 1)).toBe(true)
    expect(mayAnswer(s([ev]), 'e1abc', { id: 'e1abc', at: 1000 }, 1000 + EVENT_SHOW_WINDOW_MS + 1)).toBe(false)
  })
  it('an event of mine as host, without a QR', () => {
    expect(mayAnswer(s([mk()]), 'e1abc', null, 0)).toBe(true)
  })
  it('never another event, an event I only joined, or an unknown id', () => {
    expect(mayAnswer(s([ev]), 'e1abc', null, 0)).toBe(false)
    expect(mayAnswer(s([ev, mk({}, 'e2')]), 'e2', { id: 'e1abc', at: 0 }, 0)).toBe(true) // e2 hosted by me
    expect(mayAnswer(s([ev]), 'zzz', { id: 'zzz', at: 0 }, 0)).toBe(false)
  })
})

function harness(over = {}) {
  const sent = []
  const timers = []
  const state = { events: [], me: ME, people: [], ...over.state }
  let pending = over.pending ?? null
  let saves = 0
  let changes = 0
  const host = {
    state: () => state, save: () => { saves++ }, now: () => over.now ?? 1000,
    link: (ev) => linkOf(ev),
    send: async (peer, env) => { sent.push({ to: peer.id, env }) },
    pending: () => pending, setPending: (p) => { pending = p },
    changed: () => { changes++ },
    later: (fn, ms) => { timers.push({ fn, ms }) },
  }
  return { env: createEventEnvelopes(host), sent, timers, state, pending: () => pending, saves: () => saves, changes: () => changes }
}
const shortEv = () => ({ ...mk({ where: '', conditions: undefined, themes: undefined, organizer: undefined }), kind: 'peer' })

describe('the shower (holds the event, shows the QR)', () => {
  it('a person who connects right after the QR gets the sealed envelope with the full event', async () => {
    const h = harness({ state: { events: [mk()] } })
    h.env.shown('e1abc')
    await h.env.connected({ id: 'p1' })
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].to).toBe('p1')
    expect(h.sent[0].env).toMatchObject({ v: 1, t: 'event' })
    expect(h.sent[0].env.link).toContain('#ev=')
  })
  it('sends nothing when no QR was shown, or the window passed', async () => {
    const h = harness({ state: { events: [mk()] } })
    await h.env.connected({ id: 'p1' })
    expect(h.sent).toHaveLength(0)
    const late = harness({ state: { events: [mk()] }, now: 1000 })
    late.env.shown('e1abc')
    late.env.shown('e1abc', 1000 - EVENT_SHOW_WINDOW_MS - 5)
    await late.env.connected({ id: 'p1' })
    expect(late.sent).toHaveLength(0)
  })
  it('answers a want for the shown event with a link envelope, and refuses an event it never showed', async () => {
    const h = harness({ state: { events: [mk({ hosts: ['Other Person'] }), mk({ hosts: ['Other Person'] }, 'e9')] } })
    h.env.shown('e1abc')
    expect(await h.env.onEnvelope({ id: 'p1' }, { v: 1, t: 'event', want: 'e1abc' })).toBe('answered')
    expect(h.sent[0].env.link).toBeTruthy()
    expect(await h.env.onEnvelope({ id: 'p1' }, { v: 1, t: 'event', want: 'e9' })).toBe('ignored')
    expect(h.sent).toHaveLength(1)
  })
})

describe('the scanner (holds only the short event)', () => {
  it('asks the shower for the event as soon as the connect completes, and again later while it is still incomplete', async () => {
    const h = harness({ pending: shortEv() })
    await h.env.afterConnect({ id: 'shower' })
    expect(h.sent).toEqual([{ to: 'shower', env: { v: 1, t: 'event', want: 'e1abc' } }])
    expect(h.timers.map((t) => t.ms)).toEqual(EVENT_WANT_RETRY_MS)
    await h.timers[0].fn()
    expect(h.sent).toHaveLength(2)
  })
  it('does not ask when the event is complete, or when no event link came with the connect', async () => {
    const full = harness({ pending: { ...mk(), kind: 'peer' } })
    await full.env.afterConnect({ id: 's' })
    expect(full.sent).toHaveLength(0)
    const none = harness()
    await none.env.afterConnect({ id: 's' })
    expect(none.sent).toHaveLength(0)
  })
  it('the envelope fills the event waiting in the sheet, and its retries then stop', async () => {
    const h = harness({ pending: shortEv() })
    await h.env.afterConnect({ id: 'shower' })
    expect(await h.env.onEnvelope({ id: 'shower' }, { v: 1, t: 'event', link: linkOf(mk()) })).toBe('pending')
    expect(h.pending().where).toBe('Gasthof Alpenrose, Hinterstoder')
    expect(h.pending().conditions).toBe('Bring a warm jacket.')
    const before = h.sent.length
    await h.timers[0].fn()
    expect(h.sent).toHaveLength(before)
  })
  it('the envelope fills an event already joined (its sheet redraws), saves, and a repeat changes nothing', async () => {
    const held = mk({ where: '', conditions: undefined, themes: undefined, organizer: undefined })
    const h = harness({ state: { events: [held] } })
    expect(await h.env.onEnvelope({ id: 'shower' }, { v: 1, t: 'event', link: linkOf(mk()) })).toBe('filled')
    expect(held.where).toBe('Gasthof Alpenrose, Hinterstoder')
    expect(h.saves()).toBe(1)
    expect(h.changes()).toBe(1)
    expect(await h.env.onEnvelope({ id: 'shower' }, { v: 1, t: 'event', link: linkOf(mk()) })).toBe('ignored')
  })
  it('an envelope for an event the receiver neither holds nor waits for is dropped; so is a mangled link', async () => {
    const h = harness({ state: { events: [mk({}, 'other')] } })
    expect(await h.env.onEnvelope({ id: 'x' }, { v: 1, t: 'event', link: linkOf(mk()) })).toBe('ignored')
    expect(await h.env.onEnvelope({ id: 'x' }, { v: 1, t: 'event', link: 'https://x.example/#ev=%%%' })).toBe('ignored')
    expect(h.state.events).toHaveLength(1)
  })
})

describe('server lookup stays off and the QR page says so', () => {
  it('the QR page text names the device, not a server', () => {
    expect(S.qrEventHint).toMatch(/device|phone/i)
    expect(S.qrEventHint).not.toMatch(/server/i)
    expect(S.qrEventTrimmed).not.toMatch(/server/i)
  })
})

describe('zeta: Mastodon default instance, read only', () => {
  it('the default is mastodon.social and posting is off', () => {
    expect(MASTODON_DEFAULT_INSTANCE).toBe('mastodon.social')
    expect(MASTODON_POST_ENABLED).toBe(false)
    expect(S.w43connect.mastodonPostOff).toBe('posting comes with the TrustWeb account')
  })
  it('an event with Feed on and no own instance reads the default; its own instance wins; Feed off reads nothing', () => {
    expect(eventMastodonHost({ offers: { feed: true } })).toBe('mastodon.social')
    expect(eventMastodonHost({ offers: { feed: true }, mastodonInstance: 'fosstodon.org' })).toBe('fosstodon.org')
    expect(eventMastodonHost({})).toBeUndefined()
    expect(eventMastodonHost({ mastodonInstance: 'fosstodon.org' })).toBe('fosstodon.org')
  })
})

describe('theta: opt-in dashboard aggregates (client)', () => {
  const D0 = { meta: { iyg: { kind: 'informal', organizers: [] } } }
  it('off by default: nothing is shared, the constant stays false', () => {
    expect(DASHBOARD_SOCIAL_DEFAULTS).toBe(false)
    expect(shareLayoutOn(D0, 'iyg')).toBe(false)
    expect(dashboardSocial(D0, 'iyg')).toBe(false)
  })
  it('the switch turns the social defaults on for that community only, mints one anonymous slot, and survives parse and merge', () => {
    const on = setShareLayout(D0, 'iyg', true, () => 'a'.repeat(24))
    expect(shareLayoutOn(on, 'iyg')).toBe(true)
    expect(dashboardSocial(on, 'iyg')).toBe(true)
    expect(dashboardSocial(on, 'other')).toBe(false)
    expect(on.meta.iyg.slot).toBe('a'.repeat(24))
    expect(shareLayoutOn(parseCommunity(JSON.parse(JSON.stringify(on))), 'iyg')).toBe(true)
    const again = setShareLayout(on, 'iyg', true, () => 'b'.repeat(24))
    expect(again.meta.iyg.slot).toBe('a'.repeat(24))
  })
  it('switching off sticks over a device merge (explicit false, not a missing key)', () => {
    const on = setShareLayout(D0, 'iyg', true, () => 'a'.repeat(24))
    const off = setShareLayout(on, 'iyg', false, () => 'x')
    expect(shareLayoutOn(off, 'iyg')).toBe(false)
    expect(shareLayoutOn(mergeCommunity(on, off), 'iyg')).toBe(false)
  })
  it('the tile set is what I show here: managed and own, in tile order', () => {
    const d = setOwnTiles(D0, 'iyg', ['members', 'events'])
    expect(tileSetOf(d, 'iyg')).toEqual(['events', 'members'])
    expect(tileSetOf(toggleTile(d, 'iyg', 'docs'), 'iyg')).toEqual(['events', 'docs', 'members'])
  })
  it('percentages, biggest first, only tiles somebody shows; follow takes the ones most members show', () => {
    const agg = { n: 10, tiles: { events: 8, docs: 6, members: 2, bogus: 9 } }
    expect(tilePercents(agg)).toEqual([{ tile: 'events', pct: 80 }, { tile: 'docs', pct: 60 }, { tile: 'members', pct: 20 }])
    expect(followTiles(agg)).toEqual(['events', 'docs'])
    expect(tilePercents({ n: 0, tiles: {} })).toEqual([])
  })
})

describe('theta: community_server client (mocked endpoint)', () => {
  const calls = []
  const fake = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body } }
  it('documents its endpoints', () => { expect(COMMUNITY_AGG_PATH).toBe('/community/agg') })
  it('sends {communityId, slot, tiles} only: no name, key or other record data', async () => {
    calls.length = 0
    expect(await sendTileSet(fake(204), 'iyg', 'a'.repeat(24), ['events', 'docs'])).toBe(true)
    expect(calls[0].url).toBe('/community/agg')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toEqual({ communityId: 'iyg', slot: 'a'.repeat(24), tiles: ['events', 'docs'] })
  })
  it('a failed or refused send is false, never throws', async () => {
    expect(await sendTileSet(fake(500), 'iyg', 'a'.repeat(24), ['events'])).toBe(false)
    expect(await sendTileSet(async () => { throw new Error('offline') }, 'iyg', 'a'.repeat(24), ['events'])).toBe(false)
  })
  it('reads the aggregate; below the minimum or malformed it shows nothing', async () => {
    expect(AGG_MIN_MEMBERS).toBeGreaterThanOrEqual(3)
    calls.length = 0
    const got = await fetchAggregate(fake(200, { n: 10, tiles: { events: 8 } }), 'iyg')
    expect(got).toEqual({ n: 10, tiles: { events: 8 } })
    expect(calls[0].url).toBe('/community/agg/iyg')
    expect(await fetchAggregate(fake(200, { n: AGG_MIN_MEMBERS - 1, tiles: { events: 1 } }), 'iyg')).toBeNull()
    expect(await fetchAggregate(fake(404), 'iyg')).toBeNull()
    expect(parseAggregate({ n: 'x' })).toBeNull()
    expect(parseAggregate({ n: 5, tiles: { events: 9 } })).toBeNull()   // more than n members cannot show a tile
  })
  it('the strings say what is shared', () => {
    expect(S.w43connect.shareLayout).toBe('Share my tile layout anonymously')
    expect(S.w43connect.others(['Events 80 %', 'Docs 60 %'])).toBe('Other members show: Events 80 %, Docs 60 %')
    expect(S.w43connect.follow).toBe('Follow them?')
  })
})
