// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-aggregator: a tag-timeline post carries its author's @user@host, so the Mastodon-style row shows the handle. */
import { fetchMastodonTag } from '../../src/mastodon_tag.ts'
import { handleOf } from '../../src/feed_row.ts'

const reply = (body) => Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) })
const status = (acct) => ({ id: '1', content: '<p>Hi</p>', created_at: '2026-11-15T10:00:00Z', visibility: 'public', url: 'https://mastodon.social/@a/1', account: { display_name: 'Ann', acct } })

describe('tag timeline handle', () => {
  it('a local account gets the instance host', async () => {
    const [p] = await fetchMastodonTag('mastodon.social', 'event_x', () => reply([status('ann')]))
    expect(p.handle).toBe('@ann@mastodon.social')
    expect(handleOf(p)).toBe('@ann@mastodon.social')
  })
  it('a remote account keeps its own host', async () => {
    const [p] = await fetchMastodonTag('mastodon.social', 'event_x', () => reply([status('ulrich@Bonn.social')]))
    expect(handleOf(p)).toBe('@ulrich@bonn.social')
  })
  it('a malformed acct gives no handle', async () => {
    const posts = await fetchMastodonTag('mastodon.social', 'event_x', () => reply([status('a b@c')]))
    expect(Array.isArray(posts)).toBe(true)
    expect(posts[0].handle).toBeUndefined()
  })
})
