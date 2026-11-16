// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-feed (MCP parity P02): feed_post, feed_star, feed_list over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const base = () => ({ v: 1, people: [], sameAs: {}, meetings: [], me: { id: 'me', displayName: 'Jakob' },
  events: [{ id: 'e1', name: 'Winter IYG', attended: true, from: '2026-11-14', where: 'x', createdAt: 1 }] })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpf-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-15T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('feed tools', () => {
  it('feed_list is a read; feed_post and feed_star are changes (only with writes on)', () => {
    const off = Object.keys(fixture(false).by)
    expect(off).toContain('feed_list')
    for (const n of ['feed_post', 'feed_star', 'feed_edit']) { expect(off).not.toContain(n); expect(Object.keys(fixture().by)).toContain(n) }
  })
  it('feed_post writes a post; with eventId it carries event_<slug>', () => {
    const f = fixture()
    expect(f.by.feed_post.run({ text: ' Hi all ' })).toMatchObject({ text: 'Hi all' })
    const out = f.by.feed_post.run({ text: 'Arrived', eventId: 'e1' })
    expect(out).toMatchObject({ tag: 'event_Winter_IYG', eventId: 'e1' })
    expect(f.rec().feedPosts).toHaveLength(2)
  })
  it('feed_post refuses empty text, an unknown event and a reply to nothing', () => {
    const f = fixture()
    expect(() => f.by.feed_post.run({ text: ' ' })).toThrow(/text/)
    expect(() => f.by.feed_post.run({ text: 'x', eventId: 'nope' })).toThrow(/no event/)
    expect(() => f.by.feed_post.run({ text: 'x', replyTo: 'ghost' })).toThrow(/no post/)
    expect(f.rec().feedPosts).toBeUndefined()
  })
  it('feed_post replies to a post feed_list shows, keeping a snapshot of it', () => {
    const f = fixture()
    const a = f.by.feed_post.run({ text: 'Q?' })
    expect(f.by.feed_post.run({ text: 'A', replyTo: `social:${a.id}` })).toMatchObject({ replyTo: `social:${a.id}`, replyText: 'Q?' })
  })
  it('feed_edit changes my own post', () => {
    const f = fixture()
    const a = f.by.feed_post.run({ text: 'typo' })
    expect(f.by.feed_edit.run({ post: `social:${a.id}`, text: 'fixed' })).toMatchObject({ edited: true })
    expect(f.rec().feedPosts[0].text).toBe('fixed')
    expect(() => f.by.feed_edit.run({ post: 'social:ghost', text: 'x' })).toThrow(/no post/)
  })
  it('feed_star toggles a star on a post id', () => {
    const f = fixture()
    const a = f.by.feed_post.run({ text: 'Q?' })
    expect(f.by.feed_star.run({ post: `social:${a.id}` })).toMatchObject({ starred: true })
    expect(f.rec().feedStars).toEqual([`social:${a.id}`])
    expect(f.by.feed_star.run({ post: `social:${a.id}` })).toMatchObject({ starred: false })
  })
  it('feed_list gives newest first, of one event, limited; starred flag shows', () => {
    const f = fixture()
    f.by.feed_post.run({ text: 'one' })
    f.by.feed_post.run({ text: 'two', eventId: 'e1' })
    const all = f.by.feed_list.run({})
    expect(all.posts.map((p) => p.text)).toEqual(expect.arrayContaining(['one', 'two']))
    expect(f.by.feed_list.run({ eventId: 'e1' }).posts.map((p) => p.text)).toEqual(['two'])
    expect(f.by.feed_list.run({ limit: 1 }).posts).toHaveLength(1)
    expect(() => f.by.feed_list.run({ eventId: 'nope' })).toThrow(/no event/)
  })
})
