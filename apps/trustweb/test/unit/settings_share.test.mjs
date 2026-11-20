// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 settings-suggest: suggest a settings group to a person, follow a person's group, accept / decline, auto-apply (settings_share.ts). */
import {
  SHARE_GROUPS, GROUP_SETTINGS, ME, groupValues, diffOf, applyValues, shareOf, suggest, follow, unfollow, setFollowAuto, receive, answer,
  dueFollowerUpdates, parseWire, pendingCount, takeOutgoing, dropOutgoing,
} from '../../src/settings_share.ts'
import { readSetting, settingById } from '../../src/settings_registry.ts'

let n = 0
const newId = () => `id${++n}`
const rec = (extra = {}) => ({ v: 1, people: [{ id: 'ben', name: 'Ben' }, { id: 'cy', name: 'Cy' }], ...extra })

describe('settings groups', () => {
  it('four groups, every id a valued registry setting, no id in two groups', () => {
    expect(SHARE_GROUPS).toEqual(['privacy', 'feed', 'notifications', 'events'])
    const all = SHARE_GROUPS.flatMap((g) => GROUP_SETTINGS[g])
    expect(new Set(all).size).toBe(all.length)
    for (const id of all) { const d = settingById(id); expect(d, id).toBeTruthy(); expect(d.type, id).not.toBe('action') }
  })
  it('groupValues reads the group; diffOf lists only what differs and is valid; applyValues writes it', () => {
    const r = rec()
    expect(groupValues(r, 'feed')).toEqual({ 'feed.on': false, 'feed.remote': false, 'feed.images': false })
    const values = { 'feed.on': true, 'feed.remote': false, 'feed.images': 'yes', 'chats.hidden': true, 'nope': 1 }
    expect(diffOf(r, 'feed', values)).toEqual([{ id: 'feed.on', from: false, to: true }])
    expect(applyValues(r, 'feed', values)).toEqual(['feed.on'])
    expect(readSetting(r, 'feed.on')).toBe(true)
    expect(r.chatsHidden).toBeUndefined()
  })
})

describe('suggest and answer', () => {
  it('suggest queues a sealed-share message with the group values for that person', () => {
    const r = rec({ discoverable: true })
    const out = suggest(r, 'ben', 'privacy', 10, newId)
    expect(out.to).toBe('ben')
    expect(out.msg).toMatchObject({ k: 'settings-share', v: 1, t: 'suggest', group: 'privacy', at: 10 })
    expect(out.msg.values['profile.discoverable']).toBe(true)
    expect(takeOutgoing(r)).toEqual([out])
    dropOutgoing(r, out.id)
    expect(takeOutgoing(r)).toEqual([])
    expect(() => suggest(r, 'nobody', 'privacy', 10, newId)).toThrow(/person/)
    expect(() => suggest(r, 'ben', 'colours', 10, newId)).toThrow(/group/)
  })
  it('a received suggestion lands in the inbox with its diff; Accept applies, Decline drops, nothing applied before', () => {
    const r = rec()
    const msg = parseWire({ k: 'settings-share', v: 1, id: 's1', t: 'suggest', group: 'feed', values: { 'feed.on': true }, at: 5 })
    expect(receive(r, 'ben', msg, 6)).toBe('inbox')
    expect(readSetting(r, 'feed.on')).toBe(false)
    expect(pendingCount(r)).toBe(1)
    const [item] = shareOf(r).inbox
    expect(item).toMatchObject({ t: 'suggest', from: 'ben', group: 'feed' })
    expect(answer(r, item.id, true, 7, newId)).toEqual({ applied: ['feed.on'] })
    expect(readSetting(r, 'feed.on')).toBe(true)
    expect(pendingCount(r)).toBe(0)
    receive(r, 'ben', { ...msg, id: 's2', values: { 'feed.on': false } }, 8)
    expect(answer(r, shareOf(r).inbox[0].id, false, 9, newId)).toEqual({ applied: [] })
    expect(readSetting(r, 'feed.on')).toBe(true)
    expect(() => answer(r, 'gone', true, 9, newId)).toThrow(/suggestion/)
  })
  it('a newer suggestion from the same person and group replaces the older; one that changes nothing is not kept', () => {
    const r = rec()
    receive(r, 'ben', parseWire({ k: 'settings-share', v: 1, id: 'a', t: 'suggest', group: 'feed', values: { 'feed.on': true }, at: 1 }), 1)
    receive(r, 'ben', parseWire({ k: 'settings-share', v: 1, id: 'b', t: 'suggest', group: 'feed', values: { 'feed.remote': true }, at: 2 }), 2)
    expect(shareOf(r).inbox.map((i) => i.values)).toEqual([{ 'feed.remote': true }])
    expect(receive(r, 'cy', parseWire({ k: 'settings-share', v: 1, id: 'c', t: 'suggest', group: 'feed', values: { 'feed.on': false }, at: 3 }), 3)).toBe('ignored')
  })
  it('parseWire refuses malformed or foreign payloads', () => {
    expect(parseWire({ k: 'co-chat', msg: {} })).toBeNull()
    expect(parseWire({ k: 'settings-share', v: 2, id: 'x', t: 'suggest', group: 'feed', values: {}, at: 1 })).toBeNull()
    expect(parseWire({ k: 'settings-share', v: 1, id: 'x', t: 'suggest', group: 'nope', values: {}, at: 1 })).toBeNull()
    expect(parseWire({ k: 'settings-share', v: 1, id: 'x', t: 'follow', group: 'feed', at: 1 })).toBeNull()
    expect(parseWire({ k: 'settings-share', v: 1, id: 'x', t: 'suggest', group: 'feed', values: { 'feed.on': true, 'chats.hidden': true }, at: 1 }).values).toEqual({ 'feed.on': true })
  })
})

describe('follow', () => {
  it('follow: one delegation per group (liquid-delegation), a follow request queued, waiting until the first update', () => {
    const r = rec()
    const out = follow(r, 'ben', 'privacy', false, 1, newId)
    expect(out.msg).toMatchObject({ t: 'follow', group: 'privacy', on: true })
    expect(shareOf(r).book).toEqual([{ from: ME, to: 'ben', topic: 'privacy', auto: false, since: 1 }])
    expect(shareOf(r).waiting).toEqual(['ben/privacy'])
    follow(r, 'cy', 'privacy', true, 2, newId)
    expect(shareOf(r).book.map((d) => d.to)).toEqual(['cy'])
    expect(takeOutgoing(r).map((o) => [o.to, o.msg.t, o.msg.on])).toEqual([['ben', 'follow', true], ['ben', 'follow', false], ['cy', 'follow', true]])
  })
  it('the followed side: a follow request waits for Allow; Allow records the follower and sends the group at once', () => {
    const r = rec({ discoverable: true })
    expect(receive(r, 'ben', parseWire({ k: 'settings-share', v: 1, id: 'f', t: 'follow', group: 'privacy', on: true, at: 1 }), 1)).toBe('inbox')
    expect(shareOf(r).book).toEqual([])
    const req = shareOf(r).inbox[0]
    expect(req).toMatchObject({ t: 'follow', from: 'ben', group: 'privacy' })
    answer(r, req.id, true, 2, newId)
    expect(shareOf(r).book).toEqual([{ from: 'ben', to: ME, topic: 'privacy', auto: false, since: 2 }])
    const [sent] = takeOutgoing(r)
    expect(sent).toMatchObject({ to: 'ben', msg: { t: 'suggest', group: 'privacy', follow: true } })
    expect(sent.msg.values['profile.discoverable']).toBe(true)
    expect(dueFollowerUpdates(r, 3, newId)).toBe(0)
  })
  it('the followed side: a change to the group goes to every follower once; other groups do not', () => {
    const r = rec()
    for (const who of ['ben', 'cy']) {
      receive(r, who, parseWire({ k: 'settings-share', v: 1, id: `f-${who}`, t: 'follow', group: 'feed', on: true, at: 1 }), 1)
      answer(r, shareOf(r).inbox[0].id, true, 2, newId)
    }
    for (const o of takeOutgoing(r)) dropOutgoing(r, o.id)
    r.chatsHidden = true
    expect(dueFollowerUpdates(r, 3, newId)).toBe(0)
    r.feed = { on: true }
    expect(dueFollowerUpdates(r, 4, newId)).toBe(2)
    expect(takeOutgoing(r).map((o) => [o.to, o.msg.values['feed.on'], o.msg.follow])).toEqual([['ben', true, true], ['cy', true, true]])
    expect(dueFollowerUpdates(r, 5, newId)).toBe(0)
    receive(r, 'cy', parseWire({ k: 'settings-share', v: 1, id: 'u', t: 'follow', group: 'feed', on: false, at: 6 }), 6)
    expect(shareOf(r).book.map((d) => d.from)).toEqual(['ben'])
  })
  it('the follower: an update from the person I follow clears waiting; auto-apply takes it at once, else it waits in the inbox', () => {
    const r = rec()
    follow(r, 'ben', 'feed', true, 1, newId)
    const upd = (id, on) => parseWire({ k: 'settings-share', v: 1, id, t: 'suggest', group: 'feed', values: { 'feed.on': on }, at: 2, follow: true })
    expect(receive(r, 'ben', upd('u1', true), 2)).toBe('applied')
    expect(readSetting(r, 'feed.on')).toBe(true)
    expect(shareOf(r).waiting).toEqual([])
    setFollowAuto(r, 'feed', false)
    expect(receive(r, 'ben', upd('u2', false), 3)).toBe('inbox')
    expect(readSetting(r, 'feed.on')).toBe(true)
    expect(shareOf(r).inbox[0]).toMatchObject({ follow: true, from: 'ben' })
    // auto-apply never trusts someone I do not follow on that group
    expect(receive(r, 'cy', { ...upd('u3', false), group: 'feed' }, 4)).toBe('inbox')
    unfollow(r, 'feed')
    expect(shareOf(r).book).toEqual([])
  })
  it('shareOf reads junk as empty and caps the inbox', () => {
    expect(shareOf({ settingsShare: 'junk' })).toEqual({ inbox: [], book: [], sent: {}, outbox: [], waiting: [] })
    const r = rec()
    for (let i = 0; i < 80; i++) receive(r, `p${i}`, parseWire({ k: 'settings-share', v: 1, id: `x${i}`, t: 'follow', group: 'feed', on: true, at: i }), i)
    expect(shareOf(r).inbox.length).toBe(50)
  })
})

describe('who can be picked', () => {
  it('direct = not seen through a friend, closest rings first; fof = seen through a friend; only people the relay reaches, never deleted, archived or nameless', async () => {
    const { reachable } = await import('../../src/settings_share.ts')
    const P = (id, ring, extra = {}) => ({ id, name: id, ring, ...extra })
    const people = [P('ac', 'acquaintance'), P('fr', 'friend'), P('cl', 'closest'), P('nodid', 'close'), P('arch', 'none'), P('gone', 'close', { deleted_at: 'x' }),
      P('fof', 'acquaintance', { via: 'fr' }), P('anon', 'acquaintance', { via: 'fr', anonymous: true })]
    const didOf = (id) => (id === 'nodid' ? undefined : `did:${id}`)
    expect(reachable(people, 'direct', didOf).map((p) => p.id)).toEqual(['cl', 'fr', 'ac'])
    expect(reachable(people, 'fof', didOf).map((p) => p.id)).toEqual(['fof'])
  })
})
