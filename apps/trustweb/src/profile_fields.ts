// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b profile-page (Jakob item 27): the owner's own profile, modelled on Mastodon's "Edit profile" (display name, bio, up to four verified
 * links, pronouns-style extra fields) and Pixelfed's profile settings (location, languages), plus the own phone-book entry (prefix, first, middle,
 * last, suffix, nickname). Stored at `me.profile`, local only. Every field carries a visibility chip (me only | trusted | discoverable); the signed
 * directory record carries only the fields marked discoverable (directoryExtra). Pure: no DOM, no imports (apps/mcp runs it under plain node).
 */
export const FIELDS = ['prefix', 'first', 'middle', 'last', 'suffix', 'nickname', 'bio', 'pronouns', 'languages', 'location'] as const
export type FieldKey = (typeof FIELDS)[number]
export const VIS = ['me', 'trusted', 'discoverable'] as const
export type Vis = (typeof VIS)[number]
export type VisKey = FieldKey | 'links'
export interface ProfileLink { label: string; url: string; verified?: boolean }
export interface Profile { fields?: Partial<Record<FieldKey, string>>; links?: ProfileLink[]; vis?: Partial<Record<VisKey, Vis>> }
/** `nickname` is the existing me.nickname (event name reveal, event_press.ts); the other fields live in me.profile.fields. */
export interface HasProfile { profile?: Profile; nickname?: string; nicknames?: string[] }

export const LINK_MAX = 4
const TEXT_MAX = 60
const MAX: Partial<Record<FieldKey, number>> = { bio: 300, languages: 100 }
const LABEL_MAX = 30
const URL_MAX = 200

export const profileOf = (me: HasProfile): Profile => me.profile ?? {}
export const fieldOf = (me: HasProfile, k: FieldKey): string => (k === 'nickname' ? me.nickname : profileOf(me).fields?.[k]) ?? ''
export const maxOf = (k: FieldKey): number => MAX[k] ?? TEXT_MAX

function edit(me: HasProfile): Profile { return (me.profile ??= {}) }
function tidy(me: HasProfile): void {
  const p = me.profile
  if (!p) return
  if (p.fields && !Object.keys(p.fields).length) delete p.fields
  if (p.links && !p.links.length) delete p.links
  if (p.vis && !Object.keys(p.vis).length) delete p.vis
  if (!Object.keys(p).length) delete me.profile
}

/** Set (or, with an empty value, clear) text fields. Throws on an unknown key or an overlong value; nothing is stored on a throw. */
export function setFields(me: HasProfile, values: Record<string, unknown>): void {
  const next: [FieldKey, string][] = []
  for (const [k, v] of Object.entries(values)) {
    if (!(FIELDS as readonly string[]).includes(k)) throw new Error(`unknown field "${k}" (one of: ${FIELDS.join(', ')})`)
    const t = typeof v === 'string' ? v.trim() : ''
    if (t.length > maxOf(k as FieldKey)) throw new Error(`${k} is too long (max ${maxOf(k as FieldKey)})`)
    next.push([k as FieldKey, t])
  }
  for (const [k, t] of next) {
    if (k === 'nickname') {
      if (t) me.nickname = t; else delete me.nickname
      if (me.nicknames) { if (t) me.nicknames[0] = t; else me.nicknames.shift() }
      continue
    }
    const f = (edit(me).fields ??= {})
    if (t) f[k] = t; else delete f[k]
  }
  tidy(me)
}

export function addLink(me: HasProfile, label: string, url: string): void {
  const l = String(label ?? '').trim(); const u = String(url ?? '').trim()
  if (!l || l.length > LABEL_MAX) throw new Error(`a label of 1 to ${LABEL_MAX} characters is required`)
  let ok = false
  try { ok = new URL(u).protocol === 'https:' } catch { /* not a URL */ }
  if (!ok || u.length > URL_MAX) throw new Error(`the link must be an https address (max ${URL_MAX} characters)`)
  const links = (edit(me).links ??= [])
  if (links.some((x) => x.url === u)) { tidy(me); throw new Error('this link is already there') }
  if (links.length >= LINK_MAX) { tidy(me); throw new Error(`at most ${LINK_MAX} links`) }
  links.push({ label: l, url: u })
}

export function removeLink(me: HasProfile, url: string): void {
  const links = profileOf(me).links ?? []
  const i = links.findIndex((x) => x.url === url)
  if (i < 0) throw new Error('no such link')
  links.splice(i, 1)
  tidy(me)
}

export const visOf = (me: HasProfile, k: VisKey): Vis => profileOf(me).vis?.[k] ?? 'me'

export function setVis(me: HasProfile, k: VisKey, v: string): void {
  if (!(VIS as readonly string[]).includes(v)) throw new Error(`visibility must be one of: ${VIS.join(', ')}`)
  const vis = (edit(me).vis ??= {})
  if (v === 'me') delete vis[k]; else vis[k] = v as Vis
  tidy(me)
}

/** What the signed directory record may carry: only fields marked discoverable; links as "label\nurl" under link0..link3. */
export function directoryExtra(me: HasProfile): Record<string, string> {
  const p = profileOf(me); const out: Record<string, string> = {}
  for (const k of FIELDS) {
    if (k === 'first' || k === 'last' || visOf(me, k) !== 'discoverable') continue
    const v = fieldOf(me, k)
    if (v) out[k] = v
  }
  if (visOf(me, 'links') === 'discoverable') (p.links ?? []).forEach((l, i) => { out[`link${i}`] = `${l.label}\n${l.url}` })
  return out
}

/** The dependent toggles below Discoverable open with it and collapse when it goes off. */
export const moreOpenAfter = (discoverableNow: boolean): boolean => discoverableNow

type Fetcher = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; text: () => Promise<string> }>

/** Mastodon's rel="me" check: one GET (no cookies, no referrer), true when the page links back to `mine` with rel="me". Runs only on an explicit press. */
export async function verifyMeLink(url: string, mine: string, fetcher: Fetcher): Promise<boolean> {
  try {
    const r = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
    if (!r.ok) return false
    const html = (await r.text()).slice(0, 500_000)
    for (const m of html.matchAll(/<(?:a|link)\b[^>]*>/gi)) {
      const tag = m[0]
      if (/\brel\s*=\s*["']?[^"'>]*\bme\b/i.test(tag) && tag.includes(mine)) return true
    }
    return false
  } catch { return false }
}

/** answers-44a (Q7): what a check answers when the app's public address is unknown (MCP without the setting profile.origin). */
export const ORIGIN_NOT_SET = 'origin not set'

/**
 * The one rel="me" checker of the app's "Check" button and MCP profile_link_check: checks one of the owner's links against `origin` and sets or
 * clears its `verified` mark. Empty `origin`: nothing fetched, `reason` says so. A URL that is not one of the links throws.
 */
export async function checkProfileLink(me: HasProfile, url: string, origin: string, fetcher: Fetcher): Promise<{ verified: boolean; reason?: typeof ORIGIN_NOT_SET }> {
  const link = (profileOf(me).links ?? []).find((x) => x.url === url)
  if (!link) throw new Error('no such link')
  if (!origin) return { verified: false, reason: ORIGIN_NOT_SET }
  const verified = await verifyMeLink(url, origin, fetcher)
  if (verified) link.verified = true; else delete link.verified
  return { verified }
}
