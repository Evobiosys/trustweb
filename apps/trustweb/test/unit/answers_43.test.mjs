// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 answers-43: Jakob's answers of 2026-11-15 applied (alpha to iota). */
import { Ring } from '../../src/model.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { isEventHost, mayEdit, mayInvite, newEvent, revealedBy, localSettings, tagPerson } from '../../src/events.ts'
import { EVENT_SLUG_CASE, eventTagSlug, sameEventTag } from '../../src/event_tag.ts'
import { EVENT_SLUG_CASE as FEED_SLUG_CASE, sameEventTag as feedSame, tagOfEvent, feedList } from '../../src/feed_social.ts'
import { filterFeed } from '../../src/feed.ts'
import { DEFAULT_INVITE_POLICY, EVENT_OFFERS_DEFAULT, INVITE_POLICIES, applyEventSettings, nickFor, nicknamesOf, migrateNicknames, setNicknames } from '../../src/event_press.ts'
import { BADGE_PRESS, UNDO_FILTERS_MS, clearFiltersWithUndo, restoreFilters, snapshotFilters } from '../../src/web_focus.ts'
import { NEW_FROM_EVENT_RING } from '../../src/event_roles.ts'
import { clusterAngles, eventColour, eventColours } from '../../src/event_cluster.ts'
import { arcsGradient } from '../../src/colour_tags.ts'
import { MASTODON_LIMIT, mastodonTagUrl, fetchMastodonTag } from '../../src/mastodon_tag.ts'

const NOW = 1_700_000_000_000
const person = (id, name, ring = Ring.Friend, extra = {}) => ({ id, name, context: '', ring, metAt: NOW, lines: [], ...extra })
const ev = (extra = {}) => ({ ...newEvent({ name: 'Winter IYG', from: '2026-11-15T09:30', where: 'Wien' }, 'e1', NOW), ...extra })
const state = (people = [], me = 'Mia Probe') => ({ me: { id: 'me', displayName: me }, people })

describe('eta: the slug keeps case, every match ignores it', () => {
  it('slug keeps letter case, spaces to underscore, punctuation stripped', () => {
    expect(EVENT_SLUG_CASE).toBe('keep')
    expect(FEED_SLUG_CASE).toBe('keep')
    expect(eventTagSlug('Winter IYG')).toBe('event_Winter_IYG')
    expect(eventTagSlug(' Winter - IYG! ')).toBe('event_Winter_IYG')
    expect(tagOfEvent({ name: 'Winter IYG' })).toBe('event_Winter_IYG')
  })
  it('sameEventTag compares case-insensitively, both copies agree', () => {
    for (const same of [sameEventTag, feedSame]) {
      expect(same('event_Winter_IYG', 'event_winter_iyg')).toBe(true)
      expect(same('event_Winter_IYG', 'event_Summer')).toBe(false)
      expect(same(undefined, 'event_a')).toBe(false)
    }
  })
  it('the feed filter and feed_list find posts stored with the older lowercase tag', () => {
    const posts = [{ id: 'a', kind: 'social', at: 1, text: 'x', tag: 'event_winter_iyg' }, { id: 'b', kind: 'social', at: 2, text: 'y', tag: 'event_other' }]
    expect(filterFeed(posts, { tag: 'event_Winter_IYG' }).map((p) => p.id)).toEqual(['a'])
    const s = { ...state(), events: [ev({ attended: true })], feedPosts: [{ id: 'p1', text: 'hi', by: 'Mia', at: 5, tag: 'event_winter_iyg', eventId: 'e1' }] }
    expect(feedList(s, { eventId: 'e1' }).map((p) => p.text)).toEqual(['hi'])
  })
})

describe('beta: hosts, organizers and technical support may edit', () => {
  it('mayEdit', () => {
    const s = state([person('o', 'Olga Org'), person('t', 'Tia Tech'), person('h', 'Hana Host'), person('x', 'Xen Else')])
    const e = ev({ organizers: ['o'], techSupport: ['t'], hosts: ['h'], attended: true })
    for (const who of ['Olga Org', 'Tia Tech', 'Hana Host']) expect(mayEdit(e, who, s.people)).toBe(true)
    expect(mayEdit(e, 'Xen Else', s.people)).toBe(false)
    expect(mayEdit(e, 'Olga Org', s.people)).toBe(isEventHost(e, 'Olga Org', s.people))
  })
})

describe('gamma: everyone may invite by default', () => {
  it('default policy everyone; options stay hosts | trusted | everyone', () => {
    expect(DEFAULT_INVITE_POLICY).toBe('everyone')
    expect(INVITE_POLICIES).toEqual(['hosts', 'trusted', 'everyone'])
  })
  it('an attendee (and a newly invited person who joined) may invite; a non-attendee may not; hosts restricts', () => {
    const s = state([person('h', 'Hana Host')])
    expect(mayInvite(ev({ hosts: ['h'], attended: true }), s)).toBe(true)
    expect(mayInvite(ev({ hosts: ['h'], attended: false, fromLink: true }), s)).toBe(false)
    expect(mayInvite(ev({ hosts: ['h'], attended: true, invitePolicy: 'hosts' }), s)).toBe(false)
  })
  it('the default is not stored; hosts is', () => {
    const e = ev()
    applyEventSettings(e, { invitePolicy: 'hosts' }); expect(e.invitePolicy).toBe('hosts')
    applyEventSettings(e, { invitePolicy: 'everyone' }); expect(e.invitePolicy).toBeUndefined()
  })
})

describe('delta: clearing the filters can be undone', () => {
  const s = () => ({ uiRings: { show: ['event:e1', 'tag:x'], hide: ['person:p'], closest150: true, rankBy: 'frequent' }, membraneLimit: 8 })
  it('the badge press stays the list', () => expect(BADGE_PRESS).toBe('list'))
  it('snapshot, clear, restore gives the filter set back', () => {
    const st = s(); const before = JSON.stringify(st)
    const snap = snapshotFilters(st)
    clearFiltersWithUndo(st, () => {})
    expect(st.uiRings.show).toEqual([]); expect(st.uiRings.hide).toEqual([]); expect(st.uiRings.closest150).toBe(false)
    restoreFilters(st, snap)
    expect(st.uiRings.show).toEqual(['event:e1', 'tag:x']); expect(st.uiRings.hide).toEqual(['person:p']); expect(st.uiRings.closest150).toBe(true)
    expect(st.uiRings.rankBy).toBe('frequent'); expect(st.membraneLimit).toBe(8)
    expect(JSON.stringify(Object.keys(st.uiRings).sort())).toBe(JSON.stringify(Object.keys(JSON.parse(before).uiRings).sort()))
  })
  it('clearFiltersWithUndo offers a 5 second Undo that restores', () => {
    const st = s(); let offered
    clearFiltersWithUndo(st, (title, undo, ms) => { offered = { title, undo, ms } })
    expect(UNDO_FILTERS_MS).toBe(5000)
    expect(offered.ms).toBe(5000)
    expect(typeof offered.title).toBe('string')
    offered.undo()
    expect(st.uiRings.show).toEqual(['event:e1', 'tag:x'])
  })
  it('nothing on: no toast', () => {
    let called = false
    clearFiltersWithUndo({ uiRings: {} }, () => { called = true })
    expect(called).toBe(false)
  })
})

describe('epsilon: a community or an isolated event', () => {
  it('plain events offer nothing', () => expect(EVENT_OFFERS_DEFAULT).toEqual({ support: false, resources: false, feed: false }))
  it('communityId is set, cleared and stored locally', () => {
    const e = ev()
    applyEventSettings(e, { communityId: 'iyg-crew' }); expect(e.communityId).toBe('iyg-crew')
    expect(localSettings(e).communityId).toBe('iyg-crew')
    applyEventSettings(e, { communityId: '' }); expect(e.communityId).toBeUndefined()
  })
  it('a person added to a community event joins that community', () => {
    const s = { ...state([person('p1', 'Anna Gruber'), person('p2', 'Ben Bauer')]), events: [ev({ communityId: 'iyg-crew' })] }
    tagPerson(s, 'p1', 'e1')
    expect(s.people[0].fields?.['iyg-crew']).toBe('true')
    expect(s.people[1].fields).toBeUndefined()
  })
  it('an isolated event leaves the people alone', () => {
    const s = { ...state([person('p1', 'Anna Gruber')]), events: [ev()] }
    tagPerson(s, 'p1', 'e1')
    expect(s.people[0].fields).toBeUndefined()
  })
})

describe('iota: a nickname per event, several nicknames', () => {
  it('Me.nickname migrates into nicknames[0], once', () => {
    const s = { me: { id: 'me', displayName: 'Mia', nickname: 'Mimi' } }
    expect(migrateNicknames(s)).toBe(true)
    expect(s.me.nicknames).toEqual(['Mimi'])
    expect(migrateNicknames(s)).toBe(false)
    expect(migrateNicknames({ me: { id: 'me', displayName: 'Mia' } })).toBe(false)
  })
  it('nicknamesOf reads nicknames, else the old field', () => {
    expect(nicknamesOf({ nickname: 'Mimi' })).toEqual(['Mimi'])
    expect(nicknamesOf({ nickname: 'Mimi', nicknames: ['Mimi', 'M'] })).toEqual(['Mimi', 'M'])
    expect(nicknamesOf({})).toEqual([])
  })
  it('setNicknames keeps the old field as the first one', () => {
    const me = {}
    setNicknames(me, ['Mimi', ' M ', 'Mimi', ''])
    expect(me).toEqual({ nickname: 'Mimi', nicknames: ['Mimi', 'M'] })
    setNicknames(me, [])
    expect(me).toEqual({})
  })
  it('the event nickname wins, else the first nickname', () => {
    expect(nickFor({ nickname: 'Mimi', nicknames: ['Mimi'] }, { myNickname: 'Winterfox' })).toBe('Winterfox')
    expect(nickFor({ nickname: 'Mimi' }, {})).toBe('Mimi')
    expect(nickFor({}, {})).toBeUndefined()
  })
  it('the Nickname reveal uses the event nickname', () => {
    expect(revealedBy({ name: 'Ada Probe', nick: 'Addy' }, { nameReveal: 'nick', myNickname: 'Winterfox' })).toEqual({ name: 'Winterfox' })
    expect(revealedBy({ name: 'Ada Probe', nick: 'Addy' }, { nameReveal: 'nick' })).toEqual({ name: 'Addy' })
    expect(revealedBy({ name: 'Ada Probe' }, { nameReveal: 'nick' })).toEqual({ name: 'Ada' })
  })
  it('myNickname is local, stored and cleared by settings', () => {
    const e = ev()
    applyEventSettings(e, { myNickname: ' Winterfox ' }); expect(e.myNickname).toBe('Winterfox')
    expect(localSettings(e).myNickname).toBe('Winterfox')
    applyEventSettings(e, { myNickname: '' }); expect(e.myNickname).toBeUndefined()
  })
})

describe('alpha: the event colour and community clustering', () => {
  it('a new person from an event stays Unsorted', () => expect(NEW_FROM_EVENT_RING).toBe(Ring.Unsorted))
  it('one deterministic colour per event tag, distinct for different events', () => {
    expect(eventColour('event_Winter_IYG')).toMatch(/^#[0-9a-f]{6}$/)
    expect(eventColour('event_Winter_IYG')).toBe(eventColour('event_winter_iyg'))
    expect(eventColour('event_Winter_IYG')).not.toBe(eventColour('event_Summer_Fest'))
  })
  it('eventColours: the colours of the events a person has', () => {
    const events = [{ id: 'e1', name: 'Winter IYG' }, { id: 'e2', name: 'Summer Fest', tagName: 'Summer' }]
    expect(eventColours({ events: ['e2', 'e1', 'zz'] }, events)).toEqual([eventColour('event_Summer'), eventColour('event_Winter_IYG')])
    expect(eventColours({}, events)).toEqual([])
    expect(arcsGradient(eventColours({ events: ['e1'] }, events))).toContain(eventColour('event_Winter_IYG'))
  })
  const angle = (p) => (p.angle !== undefined ? p.angle : (parseInt(p.id.slice(1), 10) * 97) % 360)
  const spread = (angles) => { const a = [...angles].sort((x, y) => x - y); const gaps = a.map((x, i) => ((a[(i + 1) % a.length] - x) + 360) % 360); return 360 - Math.max(...gaps) }
  it('people who share an event sit within one sector; others keep their own angle', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => person(id, id.toUpperCase(), Ring.Friend, id === 'p5' || id === 'p6' ? {} : { events: ['e1'] }))
    const out = clusterAngles(people, angle)
    expect(spread(['p1', 'p2', 'p3', 'p4'].map((id) => out.get(id)))).toBeLessThanOrEqual(60)
    expect(out.get('p5')).toBe(angle(people[4]))
    expect(out.get('p6')).toBe(angle(people[5]))
  })
  it('the same input gives the same angles; a dropped (stored) angle is kept; one-person groups stay put', () => {
    const people = [person('p1', 'A', Ring.Friend, { events: ['e1'], angle: 200 }), person('p2', 'B', Ring.Friend, { events: ['e1'] }), person('p3', 'C', Ring.Friend, { events: ['e2'] })]
    const a = clusterAngles(people, angle), b = clusterAngles(people, angle)
    expect([...a]).toEqual([...b])
    expect(a.get('p1')).toBe(200)
    expect(a.get('p3')).toBe(angle(people[2]))
  })
  it('community colour tags cluster too (holders of the same tag)', () => {
    const people = ['p1', 'p2', 'p3'].map((id) => person(id, id, Ring.Friend, { fields: { crew: 'true' } }))
    const out = clusterAngles(people, angle, ['crew'])
    expect(spread([...out.values()])).toBeLessThanOrEqual(60)
  })
})

describe('zeta: Mastodon hashtag merge (read-only, public, one shot)', () => {
  const status = (id, extra = {}) => ({ id, created_at: '2026-11-15T10:00:00.000Z', url: `https://mastodon.social/@a/${id}`, content: '<p>Hello <b>IYG</b></p>', visibility: 'public', account: { display_name: 'Ann', acct: 'ann' }, ...extra })
  const reply = (body, ok = true, status_ = 200) => Promise.resolve({ ok, status: status_, headers: new Headers(), text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) })
  it('the URL is the public hashtag timeline, limit 20', () => {
    expect(MASTODON_LIMIT).toBe(20)
    expect(mastodonTagUrl('mastodon.social', 'event_Winter_IYG')).toBe('https://mastodon.social/api/v1/timelines/tag/event_Winter_IYG?limit=20')
    expect(mastodonTagUrl('not a host', 'event_x')).toBeNull()
  })
  it('fetches without credentials and maps statuses to read-only Feed posts marked with the instance', async () => {
    const calls = []
    const f = (url, init) => { calls.push({ url, init }); return reply([status('1'), status('2', { visibility: 'private' }), status('3', { content: '' })]) }
    const posts = await fetchMastodonTag('mastodon.social', 'event_Winter_IYG', f)
    expect(calls).toHaveLength(1)
    expect(calls[0].init?.credentials).not.toBe('include')
    expect(calls[0].init?.headers?.Authorization).toBeUndefined()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ id: 'mastodon:mastodon.social:1', kind: 'remote', who: 'Ann', context: 'mastodon.social', tag: 'event_Winter_IYG', text: 'Hello IYG', open: { kind: 'url', url: 'https://mastodon.social/@a/1' } })
  })
  it('a failure comes back as a problem, never as posts', async () => {
    const down = () => Promise.reject(new Error('cors'))
    expect(await fetchMastodonTag('mastodon.social', 'event_x', down)).toBe('unreachable')
    expect(await fetchMastodonTag('mastodon.social', 'event_x', () => reply({}, false, 429))).toBe('rate-limited')
    expect(await fetchMastodonTag('mastodon.social', 'event_x', () => reply({ nope: 1 }))).toBe('malformed')
  })
  it('mastodonInstance is a host, local, cleared by empty, refused when invalid', () => {
    const e = ev()
    applyEventSettings(e, { mastodonInstance: 'https://Mastodon.Social/' }); expect(e.mastodonInstance).toBe('mastodon.social')
    expect(localSettings(e).mastodonInstance).toBe('mastodon.social')
    expect(() => applyEventSettings(e, { mastodonInstance: 'not a host' })).toThrow(/mastodonInstance/)
    applyEventSettings(e, { mastodonInstance: '' }); expect(e.mastodonInstance).toBeUndefined()
  })
})

describe('the new per-event settings stay on this device', () => {
  it('an event link carries neither the community, the Mastodon instance nor my nickname', () => {
    const e = ev({ communityId: 'iyg-crew', mastodonInstance: 'mastodon.social', myNickname: 'Winterfox' })
    const link = encodeEventLink(e, 'https://app.example', 'peer', undefined)
    const back = JSON.stringify(decodeEventLink(link) ?? {})
    for (const secret of ['iyg-crew', 'mastodon.social', 'Winterfox']) { expect(link).not.toContain(secret); expect(back).not.toContain(secret) }
  })
})
