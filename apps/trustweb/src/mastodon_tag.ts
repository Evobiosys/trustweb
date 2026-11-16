// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 answers-43 (zeta): an event's optional Mastodon instance. The event Feed merges that instance's PUBLIC hashtag timeline of the event tag,
 * read-only: no login, no cookies (fediverse.ts getJson), posts marked with the instance name and linking to the original. Nothing is read before the host
 * named the instance and someone opens the event's Feed.
 */
import { PostKind } from './feed'
import type { Post } from './feed'
import { FetchProblem, getJson, htmlToText, instanceBase, isProblem, parseInstance, safeRemoteUrl } from './fediverse'
import type { FetchFn } from './fediverse'

export const MASTODON_LIMIT = 20

/** https://<instance>/api/v1/timelines/tag/<slug>?limit=20, or null when the instance is no public host name. */
export function mastodonTagUrl(host: string, slug: string, allowLocal = false): string | null {
  const h = parseInstance(host, allowLocal)
  return h ? `${instanceBase(h)}/api/v1/timelines/tag/${encodeURIComponent(slug)}?limit=${MASTODON_LIMIT}` : null
}

/** Wave 44: "@user@host" from a Mastodon acct ("user" on the instance itself, "user@host" elsewhere); undefined when it is not one. */
function handleOfAcct(acct: unknown, host: string): string | undefined {
  if (typeof acct !== 'string') return undefined
  const m = /^([A-Za-z0-9_.-]{1,64})(?:@([A-Za-z0-9.-]{1,253}))?$/.exec(acct.trim())
  return m ? `@${m[1]}@${(m[2] ?? host).toLowerCase()}` : undefined
}

function toPost(v: unknown, host: string, slug: string, allowLocal: boolean): Post | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.content !== 'string' || typeof o.created_at !== 'string') return null
  if (o.visibility !== undefined && o.visibility !== 'public') return null
  const at = Date.parse(o.created_at)
  const text = htmlToText(o.content)
  if (!Number.isFinite(at) || !text) return null
  const account = typeof o.account === 'object' && o.account !== null ? (o.account as Record<string, unknown>) : {}
  const who = [account.display_name, account.acct].find((n): n is string => typeof n === 'string' && n.trim() !== '')
  const handle = handleOfAcct(account.acct, host)
  return {
    id: `mastodon:${host}:${o.id.slice(0, 64)}`, kind: PostKind.Remote, who: who?.slice(0, 80) ?? host, at, text, context: host, dummy: false, tag: slug,
    ...(handle ? { handle } : {}),
    open: { kind: 'url', url: safeRemoteUrl(o.url, allowLocal) ?? `${instanceBase(host)}/` },
  }
}

/** The public posts under the event's tag on that instance as Feed posts, or why not. */
export async function fetchMastodonTag(instance: string, slug: string, f: FetchFn, allowLocal = false): Promise<Post[] | FetchProblem> {
  const host = parseInstance(instance, allowLocal)
  const url = mastodonTagUrl(instance, slug, allowLocal)
  if (!host || !url) return FetchProblem.Malformed
  const v = await getJson(url, f)
  if (isProblem(v)) return v
  if (!Array.isArray(v)) return FetchProblem.Malformed
  return v.slice(0, MASTODON_LIMIT).map((x) => toPost(x, host, slug, allowLocal)).filter((p): p is Post => p !== null)
}
