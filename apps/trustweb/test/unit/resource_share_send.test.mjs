// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * answers-44b item 3: a shared block or line goes to a chat (the existing chat send path) or to the Feed (the existing post path); the copy is
 * exactly the projection plus its back-reference (resource id + block id). Fake data only. */
import { createActions } from '../../src/actions.ts'
import { addSocialPost } from '../../src/feed_social.ts'
import { markdownToBlocks, shareMessage, shareProjection, shareRefTag, SHARE_VIA } from '../../src/resource_blocks.ts'
import { defineResourceShareActions, postShareToFeed, resourceShare } from '../../src/resource_share_send.ts'
import { S } from '../../src/strings.ts'

const ids = () => { let n = 0; return () => `b${++n}` }
const item = () => ({ id: 'r1', text: 'Reading', blocks: markdownToBlocks('- A\n  - A1\n- B', ids()) })
const state = () => ({ me: { displayName: 'Me' }, events: [], feedPosts: [], inventory: [item(), { id: 'r2', text: 'x', protected: true, blocks: markdownToBlocks('- s', ids()) }] })

describe('the copy that travels', () => {
  it('via: link, chat, feed', () => expect(SHARE_VIA).toEqual(['link', 'chat', 'feed']))
  it('chat message = the projection, then the back-reference; nothing else of the resource', () => {
    const p = shareProjection(item(), 'b1', 'block')
    expect(shareRefTag(p.ref)).toBe('ref:r1.b1')
    expect(shareMessage(p)).toBe('- A\n  - A1\n\nref:r1.b1')
    expect(shareMessage(shareProjection(item(), 'b1', 'line'))).toBe('A\n\nref:r1.b1')
    expect(shareMessage(p)).not.toContain('B')
  })
  it('feed post = the projection text with the ref tag (feed_post path)', () => {
    const s = state()
    const post = postShareToFeed(s, shareProjection(item(), 'b2', 'line'), 5)
    expect(post).toMatchObject({ text: 'A1', tag: 'ref:r1.b2', by: 'Me', at: 5 })
    expect(s.feedPosts).toHaveLength(1)
  })
  it('an event post keeps its event tag over a given tag', () => {
    const s = { ...state(), events: [{ id: 'e1', name: 'Fest' }] }
    expect(addSocialPost(s, 'hi', 1, { eventId: 'e1', tag: 'ref:x.y' }).tag).toBe('event_Fest')
    expect(addSocialPost(s, 'hi', 2, { tag: 'ref:x.y' }).tag).toBe('ref:x.y')
  })
})

describe('the share sheet routes', () => {
  const host = (over = {}) => {
    const calls = { link: [], sent: [], toasts: [], sheets: [], saved: 0 }
    const s = state()
    const h = {
      state: () => s, save: () => { calls.saved++ }, link: (p) => calls.link.push(p),
      people: () => [{ id: 'p1', name: 'Pat', peerId: 'k1' }, { id: 'p2', name: 'Off', peerId: undefined }],
      sendChat: async (personId, text) => { calls.sent.push([personId, text]); return true },
      sheet: (kids) => { const box = document.createElement('div'); box.append(...kids); calls.sheets.push(box) }, closeSheet: () => {},
      toast: (m) => calls.toasts.push(m), ...over,
    }
    return { h, calls, s }
  }
  it('link = the existing QR/link route', () => {
    const { h, calls } = host()
    resourceShare(h)(shareProjection(item(), 'b1', 'line'), 'link')
    expect(calls.link).toHaveLength(1)
  })
  it('chat: a picker of connected people only; a pick sends the message through sendChat', async () => {
    const { h, calls } = host()
    resourceShare(h)(shareProjection(item(), 'b1', 'block'), 'chat')
    const box = calls.sheets[0]
    expect(box.querySelectorAll('[data-res-share-pick]')).toHaveLength(1)
    box.querySelector('[data-res-share-pick="p1"]').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.sent).toEqual([['p1', '- A\n  - A1\n\nref:r1.b1']])
    expect(calls.toasts).toContain(S.resShare.sent('Pat'))
  })
  it('chat: a message the chat cannot take says so', async () => {
    const { h, calls } = host({ sendChat: async () => false })
    resourceShare(h)(shareProjection(item(), 'b1', 'line'), 'chat')
    calls.sheets[0].querySelector('[data-res-share-pick="p1"]').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.toasts).toContain(S.resShare.notSent)
  })
  it('feed: posts and saves', () => {
    const { h, calls, s } = host()
    resourceShare(h)(shareProjection(item(), 'b1', 'line'), 'feed')
    expect(s.feedPosts[0]).toMatchObject({ text: 'A', tag: 'ref:r1.b1' })
    expect(calls.saved).toBe(1)
    expect(calls.toasts).toContain(S.resShare.posted)
  })
})

describe('MCP parity action resource-share-chat (approval card)', () => {
  it('needs approval, sends the projection to the person, refuses a protected resource', () => {
    const sent = []
    const s = state()
    const reg = createActions()
    defineResourceShareActions(reg, { state: () => s, canShare: (i) => !i.protected, sendChat: (p, t) => { sent.push([p, t]); return Promise.resolve(true) } })
    const c = reg.check({ type: 'resource-share-chat', args: { id: 'r1', blockId: 'b1', scope: 'line', person: 'p1' } })
    expect(c.ok && c.action.auto).toBe(false)
    reg.run(c.action)
    expect(sent).toEqual([['p1', 'A\n\nref:r1.b1']])
    expect(() => reg.do('resource-share-chat', { id: 'r2', blockId: 'b1', scope: 'line', person: 'p1' })).toThrow(/protected/)
  })
})
