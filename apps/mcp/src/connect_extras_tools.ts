// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c connect-extras (POLICY P02, MCP parity): the Feed's sources (read, and set), the community Home's opt-in "Share my tile layout
 * anonymously", and the debug send of an event envelope. The record has no network: event_envelope_send queues the step for the open preview
 * (an app action card), which sends it through the same code as a real connect (apps/trustweb/src/event_envelope.ts).
 */
import { randomBytes } from 'node:crypto'
import { MODULE_ID, parseCommunity, setShareLayout } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import { MASTODON_DEFAULT_INSTANCE, MASTODON_POST_ENABLED } from '../../trustweb/src/mastodon_default.ts'
import { announce } from './events.ts'
import { commitTo, findPerson, load, needText, schema, S, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
const FOLLOWS_MAX = 50
/** The shape feed_sources.ts parseFollow accepts ("@user@host" or "#tag@host", public host name), repeated here because that module (enums) does not load under plain node; the app checks again when it reads. */
const FOLLOW = /^([@#])([A-Za-z0-9_]{1,64})@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})$/i
const followOf = (v: unknown): string | null => { const m = typeof v === 'string' ? FOLLOW.exec(v.trim()) : null; return m ? `${m[1]}${m[2]}@${m[3].toLowerCase()}` : null }
const httpsUrl = (v: string): boolean => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password } catch { return false } }
const feedOf = (r: Rec): Obj => (typeof r.feed === 'object' && r.feed !== null ? (r.feed as Obj) : {})

export function connectExtrasTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const commit = (change: (r: Rec) => void): boolean => commitTo(o.file, now, change)
  const sources = (r: Rec): Obj => {
    const f = feedOf(r)
    return { remote: f.remote === true, images: f.images === true, follows: Array.isArray(f.follows) ? f.follows : [], newsUrl: typeof f.newsUrl === 'string' ? f.newsUrl : '', mastodonDefaultInstance: MASTODON_DEFAULT_INSTANCE, mastodonPostEnabled: MASTODON_POST_ENABLED }
  }
  const read: Tool[] = [{
    name: 'feed_sources_get', description: 'The Feed\'s sources: remote ("Also show posts from" Mastodon or Pixelfed), images, followed accounts and hashtags, the news address, and the default Mastodon instance an event Feed reads when the event names none (posting is off).',
    inputSchema: schema({}), run: () => sources(load(o.file)),
  }]
  if (!o.write) return read
  const write: Tool[] = [
    {
      name: 'feed_sources_set', description: 'Change the Feed\'s sources: remote and images (true|false), follows (the whole list: "@user@host" or "#tag@host"), newsUrl (https; "" clears). Only what is given changes; a bad value changes nothing.',
      inputSchema: schema({ remote: { type: 'boolean' }, images: { type: 'boolean' }, follows: { type: 'array', items: { type: 'string' }, description: 'the whole list' }, newsUrl: S('https address of an RSS or JSON feed; empty clears') }),
      run: (a) => {
        const follows = a.follows === undefined ? undefined : (Array.isArray(a.follows) ? a.follows : null)
        if (follows === null) throw new Error('follows must be a list of "@user@host" or "#tag@host"')
        const norm = follows?.map((f) => { const p = followOf(f); if (!p) throw new Error(`not a follow: ${String(f).slice(0, 60)} (use "@user@host" or "#tag@host")`); return p })
        if (norm && norm.length > FOLLOWS_MAX) throw new Error(`at most ${FOLLOWS_MAX} follows`)
        const news = a.newsUrl === undefined ? undefined : String(a.newsUrl).trim()
        if (news && !httpsUrl(news)) throw new Error('the news address must be an https address')
        let out: Obj = {}
        commit((r) => {
          const f = { ...feedOf(r) }
          if (typeof a.remote === 'boolean') f.remote = a.remote
          if (typeof a.images === 'boolean') f.images = a.images
          if (norm) { if (norm.length) f.follows = [...new Set(norm)]; else delete f.follows }
          if (news !== undefined) { if (news) f.newsUrl = news; else delete f.newsUrl }
          r.feed = f
          out = sources(r)
        })
        return out
      },
    },
    {
      name: 'community_dashboard_share_set', description: 'Switch "Share my tile layout anonymously" for a community (id or name as community_list gives it): on sends only which Home tiles I show, under one random anonymous slot, to the community\'s server; off stops it (default off).',
      inputSchema: schema({ community: S('community id'), on: { type: 'boolean' } }, ['community', 'on']),
      run: (a) => {
        const id = needText(a.community, 'community')
        if (typeof a.on !== 'boolean') throw new Error('on is required (true or false)')
        commit((r) => {
          const d = parseCommunity((r.extData as Obj | undefined)?.[MODULE_ID])
          if (!d.meta?.[id]) throw new Error(`no community "${id}"`)
          r.extData = { ...(r.extData as Obj | undefined), [MODULE_ID]: setShareLayout(d, id, a.on as boolean, () => randomBytes(12).toString('hex')) }
        })
        return { community: id, shareLayout: a.on }
      },
    },
    {
      name: 'event_envelope_send', description: 'Debug: send the full event as a sealed envelope to one connected person, the same message a connect sends right after an event QR scan. Queued for the open preview as an approval card.',
      inputSchema: schema({ event: S('event id'), person: S('connected person (id or exact name)') }, ['event', 'person']),
      run: (a) => {
        const r = load(o.file)
        const id = needText(a.event, 'event')
        if (!((r.events as { id: string }[] | undefined) ?? []).some((e) => e.id === id)) throw new Error(`no event "${id}"`)
        const p = findPerson(r, a.person)
        if (!p.peerId) throw new Error(`${p.name} is not connected`)
        announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'event_envelope_send', summary: `event-envelope-send ${id}`, action: { type: 'event-envelope-send', args: { event: id, person: p.id } } })
        return { queued: true, event: id, person: p.id }
      },
    },
  ]
  return [...read, ...write]
}
