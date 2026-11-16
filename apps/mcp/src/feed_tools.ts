// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 event-feed (POLICY P02, MCP parity): the Feed's actions as tools over the record file: post (to the Feed or to an event's Feed, or as a
 * reply), star, list. The record has no network: an event post stays on this phone until the app, which holds the relay, sends it (feed_view.ts).
 */
import { addSocialPost, editSocialPost, feedList, toggleStar } from '../../trustweb/src/feed_social.ts'
import { addEmbed, fetchEmbed, parsePostLink } from '../../trustweb/src/feed_embed.ts'
import type { FetchFn } from '../../trustweb/src/fediverse.ts'
import type { AppState } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
export interface FeedToolsEnv { load: () => Obj; commit: (change: (r: Obj) => void) => boolean; now: () => Date; embedFetch?: FetchFn }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })

export function feedTools(e: FeedToolsEnv): { read: Tool[]; write: Tool[] } {
  const read: Tool[] = [
    {
      name: 'feed_list', description: 'The Feed: my posts and the posts of the groups of events I attended, newest first. eventId (id) limits it to that event\'s tag event_<slug>; limit defaults to 150.',
      inputSchema: schema({ eventId: S('event id'), limit: { type: 'number', description: 'at most this many posts' } }),
      run: (a) => ({ posts: feedList(e.load() as unknown as AppState, { eventId: str(a.eventId).trim() || undefined, limit: typeof a.limit === 'number' ? a.limit : undefined }) }),
    },
  ]
  const write: Tool[] = [
    {
      name: 'feed_post', description: 'Post to the Feed (kept on this phone). eventId (id): a post on that event\'s Feed, carrying its tag event_<slug>. replyTo (a post id from feed_list): a reply.',
      inputSchema: schema({ text: S('the post'), eventId: S('event id'), replyTo: S('post id from feed_list it answers') }, ['text']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const s = r as unknown as AppState
          const eventId = str(a.eventId).trim() || undefined
          const replyTo = str(a.replyTo).trim() || undefined
          if (!str(a.text).trim()) throw new Error('text is required')
          if (eventId && !s.events?.some((ev) => ev.id === eventId)) throw new Error(`no event "${eventId}"`)
          const answered = replyTo ? feedList(s, {}).find((p) => p.id === replyTo) : undefined
          if (replyTo && !answered) throw new Error(`no post "${replyTo}" to reply to`)
          out = { ...addSocialPost(s, str(a.text), e.now().getTime(), { eventId, replyTo, replyText: answered?.text })! }
        })
        return out
      },
    },
    {
      name: 'feed_embed_link', description: 'Embed one post in the Feed from its link (Mastodon, Bluesky, PeerTube, Vimeo: author, text, thumbnail; other links, X and LinkedIn: a link card with the domain). One GET to the post\'s own host, only now. Returns the embed and whether it was new.',
      inputSchema: schema({ url: S('https link of one post') }, ['url']),
      run: async (a) => {
        const link = parsePostLink(str(a.url))
        if (!link) throw new Error('url must be one public https link')
        const embed = await fetchEmbed(link, e.embedFetch ?? (globalThis.fetch as unknown as FetchFn))
        let added = false
        e.commit((r) => { added = addEmbed(r as unknown as AppState, embed) })
        return { ...embed, added }
      },
    },
    {
      name: 'feed_edit', description: 'Change the text of one of my own Feed posts (post = its id from feed_list, social:<id>).',
      inputSchema: schema({ post: S('my post id from feed_list'), text: S('the new text') }, ['post', 'text']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => { const post = str(a.post).trim(); if (!post.startsWith('social:') || !editSocialPost(r as unknown as AppState, post.slice(7), str(a.text))) throw new Error(`no post "${post}" of mine, or empty text`); out = { post, edited: true } })
        return out
      },
    },
    {
      name: 'feed_star', description: 'Star or un-star a Feed post (post = its id from feed_list, e.g. social:<id>). Returns whether it is starred now.',
      inputSchema: schema({ post: S('post id from feed_list') }, ['post']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => { const post = str(a.post).trim(); if (!post) throw new Error('post is required'); out = { post, starred: toggleStar(r as unknown as AppState, post) } })
        return out
      },
    },
  ]
  return { read, write }
}
