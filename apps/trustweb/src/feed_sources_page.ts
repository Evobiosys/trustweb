// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 feed-sources (Jakob β): the model of the Feed's Sources page. Three sections of sources (techno-feudal, capitalist alternatives,
 * open-source + fediverse), per-source filters, the read rule, the transparent ranking and the publish target. Pure, no DOM, no network, no
 * runtime import of model.ts or feed.ts (apps/mcp loads this file under plain node): post kinds are compared as their string values.
 *
 * Read rule: "only people I trust" still reads the public place (mastodon.social) and keeps the posts whose author is trusted; only
 * `noPublicRead` ("Never read public content") stops the read. Nothing is ever published from these settings.
 */
export type SourceGroup = 'techno' | 'alt' | 'open'
export interface SourceDef {
  id: string
  group: SourceGroup
  /** Techno-feudal platforms: discouraged, off by default, each with an off-ramp line. */
  discouraged?: boolean
}

export const SOURCES: readonly SourceDef[] = [
  ...['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'].map((id): SourceDef => ({ id, group: 'techno', discouraged: true })),
  ...['bluesky', 'vimeo', 'substack', 'threads'].map((id): SourceDef => ({ id, group: 'alt' })),
  ...['mastodon', 'pixelfed', 'peertube', 'lemmy', 'friendica', 'rss', 'nostr'].map((id): SourceDef => ({ id, group: 'open' })),
]

export interface SourceCfg {
  /** Absent: the section's default (off for techno-feudal and capitalist alternatives, on for open-source). */
  on?: boolean
  /** Still read, show only posts of trusted people. */
  trustedOnly?: boolean
  /** False: this source's public posts are dropped. Absent: allowed. */
  publicAllowed?: boolean
  mute?: string[]
}

export interface AlgoCfg { recency: number; trust: number; source: number; perSource?: Record<string, number> }
export const ALGO_DEFAULT = { recency: 0.6, trust: 0.3, source: 0.1 } as const
/** A source without its own weight ranks at the middle. */
const SOURCE_WEIGHT_DEFAULT = 0.5
/** A post loses half its recency score every day. */
const HALF_LIFE_MS = 24 * 3_600_000

export interface FeedCfg { sources?: Record<string, SourceCfg>; algo?: Partial<AlgoCfg>; noPublicRead?: boolean; publishTarget?: string }

/** Posting to an external network needs an account link (a true external): off until that exists. */
export const FEED_EXTERNAL_PUBLISH_ENABLED = false

export const PUBLISH_TARGETS: readonly { id: string; discouraged?: boolean }[] = [
  { id: 'fediverse' }, { id: 'bluesky' }, { id: 'pixelfed' }, { id: 'vimeo' }, { id: 'x', discouraged: true }, { id: 'linkedin', discouraged: true },
]
export const PUBLISH_DEFAULT = 'fediverse'

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
const defOf = (id: string): SourceDef => {
  const d = SOURCES.find((s) => s.id === id)
  if (!d) throw new Error(`no source "${id}"`)
  return d
}

export const sourceCfg = (f: FeedCfg, id: string): SourceCfg => f.sources?.[id] ?? {}
export const sourceOn = (f: FeedCfg, id: string): boolean => sourceCfg(f, id).on ?? defOf(id).group === 'open'
export const publicReadAllowed = (f: FeedCfg): boolean => f.noPublicRead !== true

/** Writes only what differs from the default, so an untouched record stays untouched. */
export function setSource(f: FeedCfg, id: string, patch: SourceCfg): void {
  const def = defOf(id)
  const cur = { ...sourceCfg(f, id), ...patch }
  const next: SourceCfg = {}
  if (cur.on !== undefined && cur.on !== (def.group === 'open')) next.on = cur.on
  if (cur.trustedOnly === true) next.trustedOnly = true
  if (cur.publicAllowed === false) next.publicAllowed = false
  const mute = (cur.mute ?? []).map((w) => w.trim()).filter(Boolean)
  if (mute.length) next.mute = mute
  const all = { ...f.sources }
  if (Object.keys(next).length) all[id] = next; else delete all[id]
  if (Object.keys(all).length) f.sources = all; else delete f.sources
}

export function setNoPublicRead(f: FeedCfg, on: boolean): void {
  if (on) f.noPublicRead = true; else delete f.noPublicRead
}

export function algoOf(f: FeedCfg): AlgoCfg {
  const a = f.algo ?? {}
  const out: AlgoCfg = { recency: a.recency ?? ALGO_DEFAULT.recency, trust: a.trust ?? ALGO_DEFAULT.trust, source: a.source ?? ALGO_DEFAULT.source }
  if (a.perSource && Object.keys(a.perSource).length) out.perSource = a.perSource
  return out
}

/** Weights are clamped to 0..1; `perSource`, when given, is the whole map. Stores nothing at the default. */
export function setAlgo(f: FeedCfg, patch: Partial<AlgoCfg>): void {
  const cur = algoOf(f)
  const next: Partial<AlgoCfg> = {}
  for (const k of ['recency', 'trust', 'source'] as const) {
    const v = clamp01(patch[k] ?? cur[k])
    if (v !== ALGO_DEFAULT[k]) next[k] = v
  }
  const per: Record<string, number> = {}
  for (const [id, w] of Object.entries(patch.perSource ?? cur.perSource ?? {})) { defOf(id); per[id] = clamp01(w) }
  if (Object.keys(per).length) next.perSource = per
  if (Object.keys(next).length) f.algo = next; else delete f.algo
}

export function setPublishTarget(f: FeedCfg, target: string): string {
  if (!PUBLISH_TARGETS.some((t) => t.id === target)) throw new Error(`no target "${target}"`)
  if (target === PUBLISH_DEFAULT) delete f.publishTarget; else f.publishTarget = target
  return target
}

export interface SourcePost { id: string; kind: string; at: number; text: string; personId?: string; news?: boolean }

/** The source a post was read from; web, answers and my own posts have none (they never pass a source filter). */
export function sourceIdOf(p: Pick<SourcePost, 'kind' | 'news'>): string | undefined {
  if (p.kind === 'remote') return 'mastodon'
  if (p.kind === 'follow') return p.news ? 'rss' : 'mastodon'
  if (p.kind === 'group') return 'nostr'
  return undefined
}

/** Posts that were read from a public place. */
const isPublicRead = (p: Pick<SourcePost, 'kind'>): boolean => p.kind === 'remote' || p.kind === 'follow'

/** The filters of the page applied to a list of posts. Pure: the read itself is skipped by the view when publicReadAllowed is false. */
export function filterBySources<T extends SourcePost>(posts: readonly T[], f: FeedCfg, trusted: (p: T) => boolean): T[] {
  return posts.filter((p) => {
    if (isPublicRead(p) && !publicReadAllowed(f)) return false
    const id = sourceIdOf(p)
    if (!id) return true
    if (!sourceOn(f, id)) return false
    const c = sourceCfg(f, id)
    if (c.publicAllowed === false && isPublicRead(p)) return false
    if (c.trustedOnly === true && !trusted(p)) return false
    const text = p.text.toLowerCase()
    return !(c.mute ?? []).some((w) => text.includes(w.toLowerCase()))
  })
}

/** Newest first, people I trust higher, a source's own weight: score = recency x recencyWeight + trusted x trustWeight + source weight x sourceWeight. */
export function rankPosts<T extends SourcePost>(posts: readonly T[], algo: AlgoCfg, now: number, trusted: (p: T) => boolean): T[] {
  const score = (p: T): number => {
    const id = sourceIdOf(p)
    return algo.recency * 0.5 ** (Math.max(0, now - p.at) / HALF_LIFE_MS) + algo.trust * (trusted(p) ? 1 : 0) + algo.source * ((id ? algo.perSource?.[id] : undefined) ?? SOURCE_WEIGHT_DEFAULT)
  }
  return posts.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s || b.p.at - a.p.at || a.p.id.localeCompare(b.p.id)).map((x) => x.p)
}

export type AlgoKey = 'recency' | 'trust' | 'source'
export interface AlgoPart { key: AlgoKey; level: 'high' | 'mid' | 'low' }

/** What the sliders say in words: the weights that count, heaviest first (the view turns them into a sentence). */
export function algoParts(a: Pick<AlgoCfg, AlgoKey>): AlgoPart[] {
  return (['recency', 'trust', 'source'] as const)
    .filter((key) => a[key] >= 0.05)
    .sort((x, y) => a[y] - a[x])
    .map((key) => ({ key, level: a[key] >= 0.5 ? 'high' : a[key] >= 0.2 ? 'mid' : 'low' }))
}
