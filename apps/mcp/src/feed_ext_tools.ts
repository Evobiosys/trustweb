// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (POLICY P02, MCP parity): what the Feed's extensions let a person do, as tools over the record file. Follow a Bluesky /
 * PeerTube / Threads / Bridgy Fed account (feed_source_add) and stop (feed_source_remove); read a followed source now (feed_refresh: one GET
 * per source, nothing stored, the same "Never read public content" and source switches as the app); switch Phanpy or Bridgy Fed + Threads on
 * or off and set the Phanpy address (feed_extension_set); read one Bluesky post with its replies or one PeerTube video (feed_post_read).
 * Nothing here posts anywhere.
 */
import { BRIDGES_MODULE_ID, EXT_SWITCHES } from '../../trustweb/src/ext/bridges/bridges_model.ts'
import { MODULE_ID as PHANPY_ID, phanpyUrl, setPhanpyUrl } from '../../trustweb/src/ext/phanpy/phanpy_model.ts'
import { fetchPostThread, resolveHandle } from '../../trustweb/src/feed_bluesky.ts'
import { parsePostLink } from '../../trustweb/src/feed_embed.ts'
import { addExtFollow, EXT_KINDS, extKey, extSourceId, parseExtFollow, readExt, removeExtFollow } from '../../trustweb/src/feed_ext_sources.ts'
import type { ExtCfg, ExtItem } from '../../trustweb/src/feed_ext_sources.ts'
import { fetchVideo } from '../../trustweb/src/feed_peertube.ts'
import { publicReadAllowed, sourceOn } from '../../trustweb/src/feed_sources_page.ts'
import { isRemoteProblem } from '../../trustweb/src/remote_read.ts'
import type { FetchFn } from '../../trustweb/src/remote_read.ts'
import { commitTo, load, needText, S, schema } from './record_tools.ts'
import type { Rec, RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

const BRIDGY_NOTE = 'Bridgy Fed bridges only accounts whose owner opted in (on Bluesky: follow @ap.brid.gy; a web site: enter it at fed.brid.gy). Docs: https://fed.brid.gy/docs'

const feedOf = (r: Rec): ExtCfg => {
  const f = typeof r.feed === 'object' && r.feed !== null ? (r.feed as ExtCfg) : {}
  r.feed = f
  return f
}
const postOut = (i: ExtItem): Record<string, unknown> => ({ at: new Date(i.at).toISOString(), who: i.who, ...(i.handle ? { handle: i.handle } : {}), text: i.text, url: i.url, ...(i.card ? { card: i.card } : {}), ...(i.repostBy ? { repostBy: i.repostBy } : {}) })

export function feedExtTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const f = (): FetchFn => o.embedFetch ?? (globalThis.fetch as unknown as FetchFn)
  const reads: Tool[] = [
    {
      name: 'feed_refresh', description: 'Read one followed Feed source now (source = its key from feed_source_add, e.g. bluesky:alice.bsky.social, or "all"): its latest public posts (text, link, time), one GET per source. Nothing is stored. Refused under "Never read public content"; a source switched off on the Sources page answers problem "source-off".',
      inputSchema: schema({ source: S('a followed source key, or "all"') }, ['source']),
      run: async (a) => {
        const source = needText(a.source, 'source')
        const feed = feedOf(load(o.file))
        if (!publicReadAllowed(feed)) throw new Error('"Never read public content" is on: nothing is read')
        const list = (feed.extFollows ?? []).filter((x) => source === 'all' || extKey(x) === source)
        if (!list.length) throw new Error(`no followed source "${source}"`)
        const results = []
        for (const x of list) {
          if (!sourceOn(feed, extSourceId(x))) { results.push({ source: extKey(x), problem: 'source-off' }); continue }
          const got = await readExt(x, f())
          results.push(typeof got === 'string' ? { source: extKey(x), problem: got } : { source: extKey(x), posts: got.map(postOut) })
        }
        return { results }
      },
    },
    {
      name: 'feed_post_read', description: 'Read one public post in full from its link: a Bluesky post (bsky.app) with its direct replies, or a PeerTube video with its whole description. One or two GETs, only now; nothing stored.',
      inputSchema: schema({ url: S('https link of a Bluesky post or a PeerTube video') }, ['url']),
      run: async (a) => {
        const link = parsePostLink(needText(a.url, 'url'))
        if (link?.network === 'bluesky' && link.handle && link.rkey) {
          const did = await resolveHandle(link.handle, f())
          if (isRemoteProblem(did)) throw new Error(`Bluesky: ${did}`)
          const t = await fetchPostThread(`at://${did}/app.bsky.feed.post/${link.rkey}`, f())
          if (isRemoteProblem(t)) throw new Error(`Bluesky: ${t}`)
          return { post: postOut(t.post), replies: t.replies.map(postOut) }
        }
        if (link?.network === 'peertube' && link.id) {
          const v = await fetchVideo(link.host, link.id, f())
          if (isRemoteProblem(v)) throw new Error(`PeerTube: ${v}`)
          return { post: postOut(v) }
        }
        throw new Error('url must be a Bluesky or PeerTube post link')
      },
    },
  ]
  if (!o.write) return reads
  const commit = (change: (r: Rec) => void): void => { commitTo(o.file, now, change) }
  return [
    ...reads,
    {
      name: 'feed_source_add', description: `Follow an account in the Feed. kind: ${EXT_KINDS.join(', ')}. handle: bluesky "alice.bsky.social"; peertube "@channel@host" or its link; threads "@user@threads.net" (needs Fediverse sharing on; read through Bridgy Fed); bridgy: a Bluesky handle or an https web site, followed through Bridgy Fed. personId: the person it belongs to (optional). Switches that source on. Returns the source key.`,
      inputSchema: schema({ kind: S(EXT_KINDS.join(' | ')), handle: S('the address'), personId: S('optional person id') }, ['kind', 'handle']),
      run: (a) => {
        const kind = needText(a.kind, 'kind')
        if (!(EXT_KINDS as readonly string[]).includes(kind)) throw new Error(`kind must be one of: ${EXT_KINDS.join(', ')}`)
        const follow = parseExtFollow(kind, needText(a.handle, 'handle'))
        if (!follow) throw new Error(`"${String(a.handle)}" is not a ${kind} address`)
        const personId = typeof a.personId === 'string' && a.personId.trim() ? a.personId.trim() : undefined
        let added = false
        let on = false
        commit((r) => { const feed = feedOf(r); added = addExtFollow(feed, personId ? { ...follow, personId } : follow); on = sourceOn(feed, extSourceId(follow)) })
        return { source: extKey(follow), kind, handle: follow.handle, added, sourceOn: on, ...(kind === 'bridgy' ? { bridged: follow.handle, note: BRIDGY_NOTE } : {}) }
      },
    },
    {
      name: 'feed_source_remove', description: 'Stop following a Feed source (source = its key, e.g. bluesky:alice.bsky.social).',
      inputSchema: schema({ source: S('a followed source key') }, ['source']),
      run: (a) => {
        const source = needText(a.source, 'source')
        let removed = false
        commit((r) => { removed = removeExtFollow(feedOf(r), source) })
        return { source, removed }
      },
    },
    {
      name: 'feed_extension_set', description: `Settings > Feed > Extensions: switch ${EXT_SWITCHES.join(' or ')} on or off (phanpy: the Phanpy Mastodon client view, off by default; ${BRIDGES_MODULE_ID}: Bridgy Fed and Threads follows, on by default), and set the Phanpy address (url, https; empty = phanpy.social). Only what is given changes.`,
      inputSchema: schema({ id: S(EXT_SWITCHES.join(' | ')), on: { type: 'boolean' }, url: S('phanpy only: your Phanpy address') }, ['id']),
      run: (a) => {
        const id = needText(a.id, 'id')
        if (!(EXT_SWITCHES as readonly string[]).includes(id)) throw new Error(`id must be one of: ${EXT_SWITCHES.join(', ')}`)
        if (a.on !== undefined && typeof a.on !== 'boolean') throw new Error('on must be true or false')
        if (a.url !== undefined && id !== PHANPY_ID) throw new Error('url is for phanpy only')
        let url: string | undefined
        commit((rec) => {
          const r = rec as Rec & { extData?: Record<string, unknown> }
          if (typeof a.url === 'string') url = setPhanpyUrl(r, a.url, '')
          if (typeof a.on === 'boolean') {
            const tw = typeof r.twSettings === 'object' && r.twSettings !== null ? (r.twSettings as { extensions?: Record<string, boolean> }) : {}
            r.twSettings = { ...tw, extensions: { ...tw.extensions, [id]: a.on } }
          }
          if (id === PHANPY_ID) url = phanpyUrl(r)
        })
        return { id, ...(typeof a.on === 'boolean' ? { on: a.on } : {}), ...(url ? { url } : {}) }
      },
    },
  ]
}
