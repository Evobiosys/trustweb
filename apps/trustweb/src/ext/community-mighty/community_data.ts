// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 community-mighty: the module's slice of the record (`AppState.extData['community-mighty']`), its check and its device-sync
 * merge. Pure and small on purpose: the always-loaded stub (index.ts) registers the merge, the rest of the module loads only when on.
 * The consent to load Google Docs or Telegram is NOT here: a consent belongs to the device it was given on (community_view.ts).
 */
export const MODULE_ID = 'community-mighty'
export const NAV = ['home', 'spaces', 'events', 'members', 'docs', 'chat'] as const
export type NavId = (typeof NAV)[number]

export interface Resource { id: string; title: string; url: string; by: string; at: number }
/** One member's own ordering and visibility of the shared resource list. `from` = whose view it was forked from. */
export interface ResourceView { owner: string; order: string[]; hidden: string[]; from?: string }

/**
 * Wave 42: managed = has an organizer role and shared settings; informal = my own representation of a group, nobody else sees it.
 * organizers: 'me' or a person id. nav = the left-column sections this community shows (absent = the module's); ask = the
 * "Ask for support" button on top of the left column; audiences = the last audiences an ask used (newest first, REMEMBER_MAX).
 * name: a community made by MCP before this device knew its tag (adoptMetaTags).
 */
export type CommunityKind = 'managed' | 'informal'
export interface CommunityMeta { kind: CommunityKind; organizers: string[]; nav?: NavId[]; ask?: boolean; audiences?: string[]; name?: string }
export const REMEMBER_MAX = 5

export interface CommunityData {
  tag?: string
  navOff?: NavId[]
  resources?: Resource[]
  /** My view of the resource list. */
  mine?: ResourceView
  /** Other members' views that reached this device (none travel yet). */
  views?: ResourceView[]
  docsUrl?: string
  telegramUrl?: string
  /** Wave 42 community-support: per community (colour tag id) kind, organizers and left-column settings. */
  meta?: Record<string, CommunityMeta>
  /** Wave 40 review: docsUrl / telegramUrl were moved into the embeds record once; they are kept, never adopted again. */
  linksMoved?: true
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : [])

/** http(s) only; the normalised link or null. */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch { return null }
}

function parseView(v: unknown): ResourceView | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (!isStr(o.owner)) return undefined
  return { owner: o.owner, order: strs(o.order), hidden: strs(o.hidden), ...(isStr(o.from) ? { from: o.from } : {}) }
}

function parseMeta(v: unknown): Record<string, CommunityMeta> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, CommunityMeta> = {}
  for (const [id, raw] of Object.entries(v)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const nav = Array.isArray(o.nav) ? o.nav.filter((n): n is NavId => (NAV as readonly unknown[]).includes(n)) : []
    const audiences = strs(o.audiences).slice(0, REMEMBER_MAX)
    out[id] = {
      kind: o.kind === 'managed' ? 'managed' : 'informal', organizers: strs(o.organizers),
      ...(nav.length ? { nav } : {}), ...(o.ask === false ? { ask: false } : {}), ...(audiences.length ? { audiences } : {}), ...(isStr(o.name) && o.name ? { name: o.name } : {}),
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** Every field checked (the slice rides the device sync like any setting); unknown fields dropped. */
export function parseCommunity(raw: unknown): CommunityData {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const d: CommunityData = {}
  if (isStr(o.tag)) d.tag = o.tag
  if (Array.isArray(o.navOff)) d.navOff = o.navOff.filter((n): n is NavId => (NAV as readonly unknown[]).includes(n))
  if (Array.isArray(o.resources)) {
    d.resources = o.resources.filter((r): r is Resource => !!r && typeof r === 'object' && isStr(r.id) && isStr(r.title) && isStr(r.url) && isStr(r.by) && typeof r.at === 'number' && safeUrl(r.url) !== null)
  }
  const mine = parseView(o.mine)
  if (mine) d.mine = mine
  if (Array.isArray(o.views)) d.views = o.views.map(parseView).filter((v): v is ResourceView => v !== undefined)
  const meta = parseMeta(o.meta)
  if (meta) d.meta = meta
  if (isStr(o.docsUrl)) d.docsUrl = o.docsUrl
  if (isStr(o.telegramUrl)) d.telegramUrl = o.telegramUrl
  if (o.linksMoved === true) d.linksMoved = true
  return d
}

/**
 * Wave 40 review: the wave 39 Docs / Telegram links of this slice move into the embeds record ONCE (only the ones it lacks), and the slice is
 * marked, so a link later cleared in embeds is not brought back by the next mount. The old fields stay (nothing deleted). Null: nothing to do.
 */
export function legacyLinksPatch(d: CommunityData, have: { docsUrl?: string; telegramUrl?: string }): { patch: { docsUrl?: string; telegramUrl?: string } | null; next: CommunityData | null } {
  if (d.linksMoved || (!d.docsUrl && !d.telegramUrl)) return { patch: null, next: null }
  const patch = { ...(d.docsUrl && !have.docsUrl ? { docsUrl: d.docsUrl } : {}), ...(d.telegramUrl && !have.telegramUrl ? { telegramUrl: d.telegramUrl } : {}) }
  return { patch: Object.keys(patch).length ? patch : null, next: { ...d, linksMoved: true } }
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])]

/**
 * Two of my devices: resources join by id; my order keeps this device's first, then the other's additions; what either hid stays
 * hidden; other members' views by owner (the incoming one wins). Plain fields carry no stamp: the incoming value wins where it has one.
 */
export function mergeCommunity(mineRaw: unknown, theirsRaw: unknown): CommunityData {
  const a = parseCommunity(mineRaw)
  const b = parseCommunity(theirsRaw)
  const out: CommunityData = { ...a, ...b }
  const res = new Map([...(a.resources ?? []), ...(b.resources ?? [])].map((r) => [r.id, r]))
  if (res.size) out.resources = [...res.values()]
  if (a.mine || b.mine) {
    const hidden = union(a.mine?.hidden ?? [], b.mine?.hidden ?? [])
    const from = b.mine?.from ?? a.mine?.from
    out.mine = { owner: (b.mine ?? a.mine)!.owner, order: union(a.mine?.order ?? [], b.mine?.order ?? []).filter((id) => !hidden.includes(id)), hidden, ...(from ? { from } : {}) }
  }
  if (a.meta || b.meta) {
    out.meta = {}
    for (const id of new Set([...Object.keys(a.meta ?? {}), ...Object.keys(b.meta ?? {})])) {
      const x = a.meta?.[id]
      const y = b.meta?.[id]
      const both = { ...x, ...y } as CommunityMeta
      out.meta[id] = { ...both, organizers: union(x?.organizers ?? [], y?.organizers ?? []), ...(x?.audiences || y?.audiences ? { audiences: union(y?.audiences ?? [], x?.audiences ?? []).slice(0, REMEMBER_MAX) } : {}) }
    }
  }
  if (a.views || b.views) out.views = [...new Map([...(a.views ?? []), ...(b.views ?? [])].map((v) => [v.owner, v])).values()]
  return out
}

// ---- Wave 42 community-support: pure rules over the slice (no DOM, no imports: the MCP server reads this file too) ------------------

const ME = 'me'
type TagLike = { id: string; label?: string; colour: string; community?: boolean; system?: boolean }
type PersonLike = { id: string; fields?: Record<string, unknown>; deleted_at?: unknown; blocked?: number }
const PALETTE = ['#1565c0', '#2e7d32', '#c2185b', '#00838f', '#ef6c00', '#5d4037']
const norm = (x: string): string => x.trim().toLowerCase()
const holds = (p: PersonLike, tag: string): boolean => String(p.fields?.[tag]) === 'true'

/** The settings of one community; none saved = informal, nobody organising, ask button on. */
export function metaOf(d: CommunityData, tag: string): CommunityMeta & { ask: boolean } {
  const m = d.meta?.[tag]
  return { kind: 'informal', organizers: [], ...m, ask: m?.ask !== false }
}

const withMeta = (d: CommunityData, tag: string, patch: Partial<CommunityMeta>): CommunityData => ({ ...d, meta: { ...d.meta, [tag]: { ...metaOf(d, tag), ...patch } } })

/** Informal: its owner (me) edits. Managed: only an organizer. */
export function canEditSettings(d: CommunityData, tag: string): boolean {
  const m = metaOf(d, tag)
  return m.kind === 'informal' || m.organizers.includes(ME)
}

export function setKind(d: CommunityData, tag: string, kind: CommunityKind): CommunityData {
  if (!canEditSettings(d, tag)) return d
  const m = metaOf(d, tag)
  return withMeta(d, tag, { kind, organizers: kind === 'managed' && !m.organizers.length ? [ME] : m.organizers })
}

export function setSettings(d: CommunityData, tag: string, patch: { nav?: NavId[]; ask?: boolean }): CommunityData {
  if (!canEditSettings(d, tag)) return d
  const nav = patch.nav?.filter((n) => (NAV as readonly unknown[]).includes(n))
  return withMeta(d, tag, { ...(nav?.length ? { nav } : {}), ...(patch.ask !== undefined ? { ask: patch.ask } : {}) })
}

/** The left-column sections of a community: its own choice, else the module's (navOff). */
export const leftNav = (d: CommunityData, tag: string | null): NavId[] => (tag && d.meta?.[tag]?.nav) || NAV.filter((n) => !d.navOff?.includes(n))

/** Remembered audiences: newest first, no repeats, REMEMBER_MAX. Using one is not a settings change, so anyone may. */
export function rememberAudience(d: CommunityData, tag: string, key: string): CommunityData {
  return withMeta(d, tag, { audiences: [key, ...(metaOf(d, tag).audiences ?? []).filter((k) => k !== key)].slice(0, REMEMBER_MAX) })
}

export interface CommunityRow { id: string; name: string; kind: CommunityKind; members: number; current: boolean }

/** Every community I have: the community tags (all tags when none is flagged) and any made by settings alone. `current` = the one chosen in d.tag. */
export function listCommunities(d: CommunityData, tags: readonly TagLike[], people: readonly PersonLike[]): CommunityRow[] {
  const flagged = tags.filter((t) => t.community === true)
  const base = flagged.length ? flagged : tags.filter((t) => t.system !== true)
  const live = people.filter((p) => !p.deleted_at && !(p.blocked && p.blocked > 0))
  return base.map((t) => ({ id: t.id, name: t.label ?? t.id, kind: metaOf(d, t.id).kind, members: live.filter((p) => holds(p, t.id)).length, current: d.tag === t.id }))
}

/** A new community (or the one of that name): its tag, an entry in the settings, and it becomes the chosen one. Null for an empty name. */
export function createCommunity(d: CommunityData, tags: readonly TagLike[], name: string, kind: CommunityKind): { data: CommunityData; tags: TagLike[]; id: string } | null {
  const n = norm(name)
  if (!n) return null
  const known = tags.find((t) => norm(t.label ?? t.id) === n || norm(t.id) === n)
  const slug = n.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'community'
  let id = known?.id ?? slug
  for (let i = 2; !known && tags.some((t) => t.id === id); i++) id = `${slug}-${i}`
  const added: TagLike[] = known ? [] : [{ id, colour: PALETTE[tags.length % PALETTE.length], label: name.trim(), ...(tags.some((t) => t.community) ? { community: true } : {}) }]
  const data = d.meta?.[id] ? { ...d, tag: id } : withMeta({ ...d, tag: id }, id, { kind, organizers: kind === 'managed' ? [ME] : [], ...(known ? {} : { name: name.trim() }) })
  return { data, tags: [...tags, ...added], id }
}

/** Entries that carry a name but have no tag on this device (made over MCP, or synced) get their tag. Same array back when nothing was missing. */
export function adoptMetaTags<T extends TagLike>(d: CommunityData, tags: readonly T[]): readonly (T | TagLike)[] {
  const miss = Object.entries(d.meta ?? {}).filter(([id, m]) => m.name && !tags.some((t) => t.id === id))
  if (!miss.length) return tags
  const flagged = tags.some((t) => t.community)
  return [...tags, ...miss.map(([id, m], i): TagLike => ({ id, colour: PALETTE[(tags.length + i) % PALETTE.length], label: m.name, ...(flagged ? { community: true } : {}) }))]
}

/** Adds the membership tag to a person; false when already a member or unknown. */
export function addMember(people: { id: string; fields?: Record<string, unknown> }[], personId: string, tag: string): boolean {
  const p = people.find((x) => x.id === personId)
  if (!p || holds(p, tag)) return false
  p.fields = { ...p.fields, [tag]: 'true' }
  return true
}

/** The default audience of an ask made inside this community: its members (zone tag), plus any extra people. */
export const communityAudience = (tag: string, include: readonly string[] = []): { zone: string; include: readonly string[] } => ({ zone: `tag:${tag}`, include })
