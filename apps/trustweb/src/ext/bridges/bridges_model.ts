// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob ι): Bridgy Fed and Threads as follow paths. Pure, no imports (apps/mcp loads it under plain node).
 * Bridgy Fed (https://fed.brid.gy/docs): a Bluesky account shows on the fediverse as `@<handle>@bsky.brid.gy`, a web site as
 * `@<domain>@web.brid.gy`; the other way round a fediverse account shows on Bluesky as `<user>.<host>.ap.brid.gy` and a web site as
 * `<domain>.web.brid.gy`. Only accounts whose owner opted in are bridged. Threads (fediverse sharing on) is `@<user>@threads.net`;
 * Threads serves no public read to a browser, so its posts are read through the Bridgy account on Bluesky's public AppView.
 */
import { isPublicHost } from '../../remote_read.ts'

export const BRIDGY_DOCS_URL = 'https://fed.brid.gy/docs'
/** The extension switch of Bridgy Fed + Threads follows (ext/bridges/index.ts), and the switches Settings > Feed > Extensions holds. */
export const BRIDGES_MODULE_ID = 'bridges'
export const EXT_SWITCHES = ['phanpy', BRIDGES_MODULE_ID] as const
/** Meta's DMA Art. 6(9) data portability needs Meta's approval of our application (docs/superpowers/specs/meta-portability-application.txt): a true external. */
export const META_PORTABILITY_ENABLED = false

const BSKY_BRIDGE = 'bsky.brid.gy'
const WEB_BRIDGE = 'web.brid.gy'
const AP_BRIDGE = 'ap.brid.gy'
const THREADS_HOST = 'threads.net'
const DID_RE = /^did:(plc:[a-z2-7]{8,64}|web:[a-z0-9.-]{4,253})$/
const THREADS_USER_RE = /^[a-z0-9._]{1,30}$/

/** A Bluesky handle (a public DNS name, lower case) or a did, from "@alice.bsky.social", a profile link or the bare handle; else null. */
export function bskyHandle(input: string): string | null {
  const raw = input.trim().replace(/^https:\/\/bsky\.app\/profile\/([^/?#]+)\/?$/i, '$1').replace(/^@/, '').toLowerCase()
  if (DID_RE.test(raw)) return raw
  return isPublicHost(raw) ? raw : null
}

/** The domain of a web site ("https://www.example.org/blog" -> "example.org"); only http(s) or a bare public name. */
export function websiteDomain(input: string): string | null {
  const raw = input.trim().toLowerCase()
  const m = /^(?:https?:\/\/)?([^/?#\s]+)(?:[/?#]\S*)?$/.exec(raw)
  if (!m || (/^[a-z]+:/.test(raw) && !/^https?:\/\//.test(raw))) return null
  const host = m[1].replace(/^www\./, '')
  return isPublicHost(host) ? host : null
}

export function bridgyFromBluesky(input: string): string | null {
  const h = bskyHandle(input)
  return h && !h.startsWith('did:') ? `@${h}@${BSKY_BRIDGE}` : null
}

export function bridgyFromWebsite(input: string): string | null {
  const d = websiteDomain(input)
  return d ? `@${d}@${WEB_BRIDGE}` : null
}

export const websiteOnBluesky = (domain: string): string => `${domain}.${WEB_BRIDGE}`

/** A fediverse account "@user@host" as Bridgy Fed names it on Bluesky (underscores become hyphens there); else null. */
export function bridgedOnBluesky(fedi: string): string | null {
  const m = /^@?([A-Za-z0-9_.-]{1,64})@([a-z0-9.-]+)$/.exec(fedi.trim())
  return m && isPublicHost(m[2]) ? `${m[1].toLowerCase().replace(/_/g, '-')}.${m[2]}.${AP_BRIDGE}` : null
}

/** "@user@threads.net" from "user", "@user", "user@threads.com" or a profile link; else null. */
export function threadsHandle(input: string): string | null {
  const raw = input.trim().toLowerCase()
  const link = /^https:\/\/(?:www\.)?threads\.(?:net|com)\/@([^/?#]+)\/?$/.exec(raw)
  const acct = /^@?([^@\s]+)(?:@threads\.(?:net|com))?$/.exec(raw)
  const user = link?.[1] ?? (raw.startsWith('http') ? undefined : acct?.[1])
  return user && THREADS_USER_RE.test(user) ? `@${user}@${THREADS_HOST}` : null
}
