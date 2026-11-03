// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (Jakob 2026-10-31): what a QR code carries depends on where it is shown. Pure and DOM-free.
 *
 * Every payload stays a connect link (the old parameters first, so an older scanner just connects) plus `m=<kind>` and, where the
 * mode has a body, `x=<base64url JSON>`, both in the URL FRAGMENT so a scan never sends them to the app host (the connect parameters
 * stay in the query as before). An old code with m= and x= in the query still decodes. An event rides in the fragment exactly as
 * event_link.ts writes it (#ev=...), so the existing join path opens it; its `m=event` carries no body and stays in the query.
 * The body is inline. A relay token for bodies too long for a QR is a later step.
 */
import { fromBase64Url, toBase64Url } from './event_link'

/** What an introducer may pass on about a person: their public username only (default), the profile one ring closer, or nothing before asking. */
export type IntroducePermission = 'public' | 'one-ring-closer' | 'ask-first'
export const INTRODUCE_PERMISSIONS: readonly IntroducePermission[] = ['public', 'one-ring-closer', 'ask-first']
/** How a community takes new people: shared publicly, invited directly by me, or by an invite request. */
export type CommunityPermission = 'public' | 'invite' | 'request'

/**
 * The "profile" option puts the first messenger link typed on the person's card (Person.links, ONLY ME) into the code, which can be
 * a phone number. Hidden until a real acquaintance-level profile exists (review finding 4); the code path stays for then.
 */
export const QR_PROFILE_OPTION = false // the default; Settings > Advanced can turn it on (AppState.qrProfileOption, wave 28)

export const parseIntroducePermission = (v: unknown): IntroducePermission => INTRODUCE_PERMISSIONS.find((p) => p === v) ?? 'public'

export type QrContext =
  | { kind: 'web-root'; link: string }
  | { kind: 'person'; link: string; name: string; username?: string; introducePermission?: IntroducePermission; profile?: string }
  | { kind: 'community'; link: string; tag: string; people: string[]; permission?: CommunityPermission }
  | { kind: 'event'; link: string; eventLink: string }
  | { kind: 'item' | 'calendar' | 'group'; link: string; shareLink: string }

export interface QrOption { id: 'username' | 'profile'; on: boolean }
export interface QrMode {
  kind: QrContext['kind']
  payload: string
  /** Toggles under the code; the view words them. */
  options: QrOption[]
  /** The options that are on, for the sentence under the code. */
  chosen: QrOption['id'][]
}

/** What a scanner reads out of a mode payload; null = no mode (plain connect). */
export type ModeBody =
  | { kind: 'person'; username?: string; profile?: string }
  | { kind: 'tag'; tag: string; people: string[]; access: CommunityPermission }
  | { kind: 'event' }
  | { kind: 'item' | 'calendar' | 'group'; link: string }

/** Mode and body go behind the link's own fragment; with no body (event) the mode rides in the query. */
const withMode = (link: string, m: string, body?: unknown): string => {
  const [base, hash = ''] = link.split('#')
  if (body === undefined) return `${base}${base.includes('?') ? '&' : '?'}m=${m}${hash ? `#${hash}` : ''}`
  return `${base}#${hash ? `${hash}&` : ''}m=${m}&x=${toBase64Url(JSON.stringify(body))}`
}

export function mode(ctx: QrContext, on: readonly QrOption['id'][] = [], profileOption: boolean = QR_PROFILE_OPTION): QrMode {
  const done = (payload: string, options: QrOption['id'][] = []): QrMode => ({
    kind: ctx.kind, payload, options: options.map((id) => ({ id, on: on.includes(id) })), chosen: options.filter((id) => on.includes(id)),
  })
  switch (ctx.kind) {
    case 'web-root': return done(ctx.link)
    case 'person': {
      const perm = ctx.introducePermission ?? 'public'
      const offered: QrOption['id'][] = perm === 'ask-first' ? [] : [...(ctx.username ? ['username' as const] : []), ...(profileOption && perm === 'one-ring-closer' && ctx.profile ? ['profile' as const] : [])]
      const m = done(ctx.link, offered)
      if (!m.chosen.length) return m
      return { ...m, payload: withMode(ctx.link, 'person', { ...(m.chosen.includes('username') ? { u: ctx.username } : {}), ...(m.chosen.includes('profile') ? { p: ctx.profile } : {}) }) }
    }
    case 'community': return done(withMode(ctx.link, 'tag', { t: ctx.tag, i: ctx.people, a: ctx.permission ?? 'request' }))
    case 'event': return done(withMode(ctx.link.split('#')[0], 'event') + (ctx.eventLink.includes('#') ? ctx.eventLink.slice(ctx.eventLink.indexOf('#')) : ''))
    default: return done(withMode(ctx.link, ctx.kind, { l: ctx.shareLink }))
  }
}

const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')
const text = (v: unknown, max = 2000): string | undefined => (typeof v === 'string' && v ? v.slice(0, max) : undefined)
const USERNAME_MAX = 30
const TAG_MAX = 60
const PEOPLE_MAX = 200

/** The mode in a scanned link, or null for an old-format code, an unknown mode or a mangled body. Never throws. */
export function decodeModeLink(url: string): ModeBody | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const frag = new URLSearchParams(u.hash.replace(/^#/, ''))
  const param = (k: string): string | null => frag.get(k) ?? u.searchParams.get(k) // the query is how older codes carried them
  const m = param('m')
  if (m === 'event') return { kind: 'event' }
  if (m !== 'person' && m !== 'tag' && m !== 'item' && m !== 'calendar' && m !== 'group') return null
  let o: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(param('x') ?? ''))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    o = parsed as Record<string, unknown>
  } catch { return null }
  if (m === 'person') return { kind: 'person', ...(text(o.u, USERNAME_MAX) ? { username: text(o.u, USERNAME_MAX) } : {}), ...(text(o.p) ? { profile: text(o.p) } : {}) }
  if (m === 'tag') {
    const tag = text(o.t, TAG_MAX)
    return tag && strs(o.i) && (o.a === 'public' || o.a === 'invite' || o.a === 'request') ? { kind: 'tag', tag, people: o.i.slice(0, PEOPLE_MAX), access: o.a } : null
  }
  const link = text(o.l)
  return link ? { kind: m, link } : null
}
