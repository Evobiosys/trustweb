// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 community-support: communities (managed / informal), per-community settings, audiences, the support inbox, intro targets, skill matches. */
import {
  metaOf, listCommunities, createCommunity, setKind, canEditSettings, setSettings, leftNav, rememberAudience, addMember, adoptMetaTags,
  communityAudience, parseCommunity, mergeCommunity, REMEMBER_MAX,
} from '../../src/ext/community-mighty/community_data.ts'
import { bundlePeople, BUNDLES, closeText, parseCloseText, isSupportText, audience } from '../../src/support_ask.ts'
import { inboxRows, cancelAsk, applyCancel, parseIntroTarget, skillMatches, categoryAsk } from '../../src/support_inbox.ts'

const APP = 'https://app.example/'
const P = (id, name, ring, fields = {}, peerId = `peer-${id}`) => ({ id, name, ring, fields, peerId: peerId ?? undefined, context: '', lines: [] })
const TAGS = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }, { id: 'garden', colour: '#2e7d32', label: 'Garden', community: true }]
const people = [P('a', 'Ada', 'closest'), P('b', 'Ben', 'close', { iyg: 'true' }), P('c', 'Cleo', 'friend', { iyg: 'true', plumber: 'true' }), P('d', 'Dan', 'acquaintance', { iyg: 'true' }), P('e', 'Eve', 'friend', {}, null)]

describe('community kind and organizers', () => {
  it('a community without settings is informal with nobody organising', () => {
    expect(metaOf({}, 'iyg')).toMatchObject({ kind: 'informal', organizers: [] })
  })
  it('setKind managed makes me the organizer; back to informal keeps the list', () => {
    const m = setKind({}, 'iyg', 'managed')
    expect(metaOf(m, 'iyg')).toMatchObject({ kind: 'managed', organizers: ['me'] })
    expect(metaOf(setKind(m, 'iyg', 'informal'), 'iyg').kind).toBe('informal')
  })
  it('settings: the owner of an informal community and the organizers of a managed one may change them, others may not', () => {
    expect(canEditSettings({}, 'iyg')).toBe(true)
    const managedByOther = { meta: { iyg: { kind: 'managed', organizers: ['p9'] } } }
    expect(canEditSettings(managedByOther, 'iyg')).toBe(false)
    expect(setSettings(managedByOther, 'iyg', { ask: false })).toBe(managedByOther)
    expect(canEditSettings(setKind({}, 'iyg', 'managed'), 'iyg')).toBe(true)
  })
  it('parse drops unknown kinds and bad nav; merge unions organizers and keeps five remembered audiences', () => {
    const d = parseCommunity({ meta: { iyg: { kind: 'weird', organizers: ['me', 4], nav: ['home', 'x'], audiences: ['a'] } } })
    expect(d.meta.iyg).toMatchObject({ kind: 'informal', organizers: ['me'], nav: ['home'], audiences: ['a'] })
    const m = mergeCommunity({ meta: { iyg: { kind: 'managed', organizers: ['me'] } } }, { meta: { iyg: { kind: 'managed', organizers: ['p2'] } } })
    expect(metaOf(m, 'iyg').organizers.sort()).toEqual(['me', 'p2'])
  })
})

describe('the community list', () => {
  it('lists the community tags with kind and member count, the chosen one marked', () => {
    const d = { tag: 'iyg', meta: { garden: { kind: 'managed', organizers: ['me'] } } }
    const rows = listCommunities(d, TAGS, people)
    expect(rows.map((r) => [r.id, r.name, r.kind, r.members, r.current])).toEqual([['iyg', 'IYG circle', 'informal', 3, true], ['garden', 'Garden', 'managed', 0, false]])
  })
  it('createCommunity defines a flagged tag and an informal entry; a known name is reused', () => {
    const out = createCommunity({}, TAGS, 'Book club', 'informal')
    expect(out.tags.find((t) => t.id === 'book-club')).toMatchObject({ label: 'Book club', community: true })
    expect(metaOf(out.data, 'book-club').kind).toBe('informal')
    expect(out.data.tag).toBe('book-club')
    expect(createCommunity({}, TAGS, 'iyg circle', 'informal').tags).toHaveLength(2)
    expect(createCommunity({}, TAGS, '   ', 'informal')).toBeNull()
  })
  it('an entry made elsewhere (MCP) with a name but no tag gets its tag on this device', () => {
    const d = { meta: { 'book-club': { kind: 'informal', organizers: [], name: 'Book club' } } }
    const tags = adoptMetaTags(d, TAGS)
    expect(tags.find((t) => t.id === 'book-club')).toMatchObject({ label: 'Book club', community: true })
    expect(adoptMetaTags(d, tags)).toBe(tags)
  })
})

describe('members', () => {
  it('addMember gives the person the membership tag once and leaves others alone', () => {
    const list = [P('x', 'Xan', 'friend')]
    expect(addMember(list, 'x', 'iyg')).toBe(true)
    expect(list[0].fields.iyg).toBe('true')
    expect(addMember(list, 'x', 'iyg')).toBe(false)
    expect(addMember(list, 'nobody', 'iyg')).toBe(false)
  })
})

describe('left column and remembered audiences', () => {
  it('the left column defaults to the module sections; a community can choose its own', () => {
    expect(leftNav({}, 'iyg')).toContain('home')
    const d = setSettings({}, 'iyg', { nav: ['members', 'docs'] })
    expect(leftNav(d, 'iyg')).toEqual(['members', 'docs'])
    expect(leftNav(d, 'garden')).toContain('events')
  })
  it('the ask button is on by default and can be switched off', () => {
    expect(metaOf({}, 'iyg').ask).toBe(true)
    expect(metaOf(setSettings({}, 'iyg', { ask: false }), 'iyg').ask).toBe(false)
  })
  it('remembers the last audiences, newest first, no repeats, at most five', () => {
    let d = {}
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) d = rememberAudience(d, 'iyg', k)
    expect(metaOf(d, 'iyg').audiences).toEqual(['c', 'f', 'e', 'd', 'b'])
    expect(REMEMBER_MAX).toBe(5)
  })
})

describe('audiences', () => {
  it('the default audience of an ask is the community: Friends and closer holding its tag, Closest few always in', () => {
    const got = audience(people, communityAudience('iyg'), (p, t) => p.fields?.[t] === 'true').map((p) => p.id)
    expect(got.sort()).toEqual(['a', 'b', 'c'])
  })
  it('Closest few and Closest allies are bundles that combine with the community', () => {
    expect(BUNDLES).toEqual(['closest-few', 'closest-allies'])
    expect(bundlePeople(people, 'closest-few').map((p) => p.id)).toEqual(['a'])
    expect(bundlePeople(people, 'closest-allies').map((p) => p.id)).toEqual(['a', 'b'])
    const ch = communityAudience('garden', ['b'])
    expect(audience(people, ch, () => false).map((p) => p.id).sort()).toEqual(['a', 'b'])
  })
  it('a person without a peer is never in a bundle', () => {
    expect(bundlePeople([P('z', 'Zed', 'closest', {}, null)], 'closest-few')).toEqual([])
  })
})

describe('support inbox', () => {
  const now = 1000
  const s = {
    supportAsks: [{ id: 'm1', chips: ['listen'], note: 'hi', until: 5000, to: ['peer-a', 'peer-b'], here: ['peer-a'] }, { id: 'old', chips: [], note: '', until: 10, to: [], here: [] }],
    supportIn: [{ id: 't1', peerId: 'peer-c', chips: ['call'], note: '', until: 4000 }, { id: 't0', peerId: 'peer-c', chips: [], note: '', until: 5, }],
    people,
  }
  it('one list: my open asks and the ones sent to me, open ones only, soonest end first', () => {
    const rows = inboxRows(s, now)
    expect(rows.map((r) => [r.kind, r.id])).toEqual([['theirs', 't1'], ['mine', 'm1']])
    expect(rows[0].who).toBe('Cleo')
    expect(rows[1]).toMatchObject({ answered: 1, asked: 2 })
  })
  it('an empty inbox is an empty list, never a half-built one', () => {
    expect(inboxRows({ people }, now)).toEqual([])
  })
  it('cancel closes my own ask and tells who was asked; an unknown or foreign id changes nothing', () => {
    const out = cancelAsk(s.supportAsks, 'm1', now)
    expect(out.cancelled.to).toEqual(['peer-a', 'peer-b'])
    expect(out.asks.find((a) => a.id === 'm1')).toBeUndefined()
    expect(cancelAsk(s.supportAsks, 'zzz', now).cancelled).toBeNull()
  })
  it('the cancel text round-trips and counts as a support text', () => {
    const t = closeText(APP, 'm1')
    expect(parseCloseText(APP, t)).toBe('m1')
    expect(isSupportText(APP, t)).toBe(true)
    expect(parseCloseText(APP, `${APP}?support-cancel=`)).toBeNull()
  })
  it('a cancel from a peer removes only that peer\'s copy of the ask', () => {
    const list = [{ id: 'm1', peerId: 'peer-a', chips: [], note: '', until: 9 }, { id: 'm1', peerId: 'peer-b', chips: [], note: '', until: 9 }]
    expect(applyCancel(list, 'm1', 'peer-a').map((x) => x.peerId)).toEqual(['peer-b'])
    expect(applyCancel(list, 'nope', 'peer-a')).toHaveLength(2)
  })
})

describe('intros and skills', () => {
  it('"at <name>" targets a person; anything else is a free-text category', () => {
    expect(parseIntroTarget('at Anna Berger')).toEqual({ kind: 'person', name: 'Anna Berger' })
    expect(parseIntroTarget('  At  anna ')).toEqual({ kind: 'person', name: 'anna' })
    expect(parseIntroTarget('plumber')).toEqual({ kind: 'category', category: 'plumber' })
    expect(parseIntroTarget('attorney')).toEqual({ kind: 'category', category: 'attorney' })
    expect(parseIntroTarget('  ')).toBeNull()
    expect(parseIntroTarget('at ')).toBeNull()
  })
  it('people with a matching skill: tag, context or note, connected people only', () => {
    const list = [P('c', 'Cleo', 'friend', { plumber: 'true' }), { ...P('f', 'Finn', 'friend'), context: 'Retired Plumber, Graz' }, { ...P('g', 'Gus', 'friend'), lines: [{ text: 'does plumbing on weekends' }] }, P('h', 'Hal', 'friend', {}, null), P('i', 'Ida', 'friend', { gardener: 'true' })]
    list[3].fields = { plumber: 'true' }
    expect(skillMatches(list, 'Plumber').map((p) => p.id)).toEqual(['c', 'f', 'g'])
    expect(skillMatches(list, ' ')).toEqual([])
  })
  it('a category ask goes to the matching people as a normal support ask', () => {
    const ask = categoryAsk('plumber', [people[2]], 1000, 'id1')
    expect(ask).toMatchObject({ id: 'id1', to: ['peer-c'], note: 'plumber' })
    expect(ask.until).toBeGreaterThan(1000)
  })
})

import { communityChatLive } from '../../src/ext/community_mode/chat_row.ts'
describe('community chat row (B13)', () => {
  const tg = 'https://t.me/mygroup'
  it('hidden when no group chat is linked, shown when one is linked for the community in force', () => {
    expect(communityChatLive(undefined, undefined)).toBe(false)
    expect(communityChatLive({ embeds: { byTag: { garden: { telegramUrl: tg } } }, 'community-mighty': { tag: 'iyg' } }, undefined)).toBe(false)
    expect(communityChatLive({ embeds: { byTag: { iyg: { telegramUrl: tg } } }, 'community-mighty': { tag: 'iyg' } }, undefined)).toBe(true)
    expect(communityChatLive({ embeds: { byTag: { iyg: { telegramUrl: tg } } } }, 'iyg')).toBe(true)
    expect(communityChatLive({ embeds: { byTag: { iyg: { docsUrl: 'https://docs.google.com/document/d/abc/edit' } } } }, 'iyg')).toBe(false)
  })
})

import { agentAsks, approveAgentAsk, discardAgentAsk, planFlush } from '../../src/support_flush.ts'
describe('flush of asks written over MCP', () => {
  const A = (id, extra) => ({ id, chips: [], note: '', until: 5000, to: ['peer-a'], here: [], ...extra })
  it('queued asks go out and lose the mark; cancelled ones are withdrawn and dropped; ended queued ones are dropped unsent', () => {
    const plan = planFlush([A('q', { queued: true }), A('c', { cancelled: true }), A('e', { queued: true, until: 5 }), A('n')], 1000)
    expect(plan.send.map((a) => a.id)).toEqual(['q'])
    expect(plan.withdraw.map((a) => a.id)).toEqual(['c'])
    expect(plan.keep.map((a) => a.id)).toEqual(['q', 'n'])
    expect(plan.keep[0].queued).toBeUndefined()
  })
})

describe('I9: an ask an agent prepared over MCP waits for a tap in the app', () => {
  const A = (id, extra) => ({ id, chips: [], note: 'a ride', until: 5000, to: ['peer-a'], here: [], ...extra })
  it('the flush never sends it and keeps it marked; an in-app queued ask (no agent mark) still goes out', () => {
    const plan = planFlush([A('m', { queued: true, agent: true }), A('q', { queued: true })], 1000)
    expect(plan.send.map((a) => a.id)).toEqual(['q'])
    expect(plan.keep.map((a) => a.id)).toEqual(['m', 'q'])
    expect(plan.keep[0]).toMatchObject({ queued: true, agent: true })
    expect(plan.keep[1].queued).toBeUndefined()
  })
  it('agentAsks lists the waiting ones that are still open; an ended one is dropped by the flush, unsent', () => {
    const list = [A('m', { queued: true, agent: true }), A('old', { queued: true, agent: true, until: 5 }), A('n')]
    expect(agentAsks(list, 1000).map((a) => a.id)).toEqual(['m'])
    expect(planFlush(list, 1000).keep.map((a) => a.id)).toEqual(['m', 'n'])
  })
  it('Send: the marks go, the ask is returned to be sent; unknown id or an ask that is not waiting: nothing', () => {
    const list = [A('m', { queued: true, agent: true }), A('n')]
    const out = approveAgentAsk(list, 'm')
    expect(out.ask).toMatchObject({ id: 'm', to: ['peer-a'] })
    expect(out.asks.find((a) => a.id === 'm').queued).toBeUndefined()
    expect(out.asks.find((a) => a.id === 'm').agent).toBeUndefined()
    expect(approveAgentAsk(list, 'n').ask).toBeNull()
    expect(approveAgentAsk(list, 'zz').ask).toBeNull()
  })
  it('Discard: the ask is gone, unsent; an ask that is not waiting stays', () => {
    const list = [A('m', { queued: true, agent: true }), A('n')]
    expect(discardAgentAsk(list, 'm').map((a) => a.id)).toEqual(['n'])
    expect(discardAgentAsk(list, 'n').map((a) => a.id)).toEqual(['m', 'n'])
  })
})
