// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 feed-sources (POLICY P02, MCP parity): everything the Feed's Sources page changes, as tools over the record file: a source on or off with
 * its filters, the ranking weights, the "Never read public content" switch and the publish target. Nothing here publishes anywhere.
 */
import { algoOf, algoParts, FEED_EXTERNAL_PUBLISH_ENABLED, setAlgo, setNoPublicRead, setPublishTarget, setSource, sourceCfg, sourceOn, type FeedCfg, type SourceCfg } from '../../trustweb/src/feed_sources_page.ts'
import { commitTo, needText, S, schema, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

const feedOf = (r: Rec): FeedCfg => {
  const f = typeof r.feed === 'object' && r.feed !== null ? (r.feed as FeedCfg & Record<string, unknown>) : {}
  r.feed = f
  return f
}
const num = (v: unknown, what: string): number | undefined => {
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} must be a number from 0 to 1`)
  return v
}

export function feedSourcesTools(o: RecordToolsOptions): Tool[] {
  if (!o.write) return []
  const now = o.now ?? (() => new Date())
  const commit = (change: (f: FeedCfg) => void): void => { commitTo(o.file, now, (r) => change(feedOf(r))) }
  return [
    {
      name: 'feed_source_toggle', description: 'Switch one source of the Feed\'s Sources page on or off and set its filters. id: x, linkedin, facebook, instagram, tiktok, youtube (techno-feudal, off by default), bluesky, vimeo, substack, threads, mastodon, pixelfed, peertube, lemmy, friendica, rss, nostr. trustedOnly: still read, show only people I trust. publicAllowed false: drop its public posts. mute: the whole list of words to hide. Only what is given changes.',
      inputSchema: schema({ id: S('source id'), on: { type: 'boolean' }, trustedOnly: { type: 'boolean' }, publicAllowed: { type: 'boolean' }, mute: { type: 'array', items: { type: 'string' }, description: 'the whole list' } }, ['id']),
      run: (a) => {
        const id = needText(a.id, 'id')
        const patch: SourceCfg = {}
        for (const k of ['on', 'trustedOnly', 'publicAllowed'] as const) if (a[k] !== undefined) { if (typeof a[k] !== 'boolean') throw new Error(`${k} must be true or false`); patch[k] = a[k] as boolean }
        if (a.mute !== undefined) { if (!Array.isArray(a.mute)) throw new Error('mute must be a list of words'); patch.mute = a.mute.map(String) }
        let out: Record<string, unknown> = {}
        commit((f) => { setSource(f, id, patch); out = { id, on: sourceOn(f, id), ...sourceCfg(f, id) } })
        return out
      },
    },
    {
      name: 'feed_algorithm_set', description: 'The Feed\'s ranking, the sliders of the Sources page: recency, trust, source (each 0 to 1, defaults 0.6 / 0.3 / 0.1) and perSource (the whole map of source id to weight, 0 to 1). Returns the weights and the plain-language parts. Only what is given changes.',
      inputSchema: schema({ recency: { type: 'number' }, trust: { type: 'number' }, source: { type: 'number' }, perSource: { type: 'object', additionalProperties: { type: 'number' }, description: 'the whole map' } }),
      run: (a) => {
        const perSource = a.perSource === undefined ? undefined : Object.fromEntries(Object.entries(a.perSource as Record<string, unknown>).map(([k, v]) => [k, num(v, `perSource.${k}`) as number]))
        const patch = { recency: num(a.recency, 'recency'), trust: num(a.trust, 'trust'), source: num(a.source, 'source') }
        let out: Record<string, unknown> = {}
        commit((f) => {
          setAlgo(f, { ...(patch.recency !== undefined ? { recency: patch.recency } : {}), ...(patch.trust !== undefined ? { trust: patch.trust } : {}), ...(patch.source !== undefined ? { source: patch.source } : {}), ...(perSource ? { perSource } : {}) })
          const algo = algoOf(f)
          out = { algo, parts: algoParts(algo) }
        })
        return out
      },
    },
    {
      name: 'feed_no_public_read_set', description: 'The switch "Never read public content": on = the Feed reads no public place at all (not even mastodon.social); off (default) = reading is allowed, and each source\'s own filters decide what shows.',
      inputSchema: schema({ on: { type: 'boolean' } }, ['on']),
      run: (a) => {
        if (typeof a.on !== 'boolean') throw new Error('on is required (true or false)')
        commit((f) => setNoPublicRead(f, a.on as boolean))
        return { noPublicRead: a.on }
      },
    },
    {
      name: 'feed_publish_target_set', description: 'Where the Feed composer posts by default: fediverse (default), bluesky, pixelfed, vimeo, x, linkedin (x and linkedin are discouraged). Stores the preference only: posting to another network comes with its account link.',
      inputSchema: schema({ target: S('fediverse | bluesky | pixelfed | vimeo | x | linkedin') }, ['target']),
      run: (a) => {
        const target = needText(a.target, 'target')
        commit((f) => { setPublishTarget(f, target) })
        return { target, posting: FEED_EXTERNAL_PUBLISH_ENABLED }
      },
    },
  ]
}
