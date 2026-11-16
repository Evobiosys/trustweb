// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 community-mighty: the module's slice of the record (`AppState.extData['community-mighty']`), its check and its device-sync
 * merge. Pure and small on purpose: the always-loaded stub (index.ts) registers the merge, the rest of the module loads only when on.
 * The consent to load Google Docs or Telegram is NOT here: a consent belongs to the device it was given on (community_view.ts).
 */
export const MODULE_ID = 'community-mighty'
export const NAV = ['home', 'spaces', 'events', 'members', 'docs', 'chat', 'timeline'] as const
export type NavId = (typeof NAV)[number]
/** Wave 43b community-shell: the Home dashboard's tiles (the rules sit at the end of this file). */
export const TILES = ['events', 'spaces', 'docs', 'members', 'resources', 'timeline'] as const
export type TileId = (typeof TILES)[number]
const tilesOf = (v: unknown): TileId[] => (Array.isArray(v) ? [...new Set(v.filter((t): t is TileId => (TILES as readonly unknown[]).includes(t)))] : [])

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
export interface CommunityMeta {
  kind: CommunityKind; organizers: string[]; nav?: NavId[]; ask?: boolean; audiences?: string[]; name?: string
  /** Wave 43b: my own Home tiles here, the tiles a manager fixed for everyone, and whether this community's events show in my calendar in its colour. */
  tiles?: TileId[]; managedTiles?: TileId[]; connectEvents?: true
  /** Wave 43c connect-extras (theta): my opt-in to share which tiles I show, anonymously (explicit false once switched off, so a device merge keeps it off), and my random anonymous slot at the community's server. */
  shareLayout?: boolean; slot?: string
}
export const REMEMBER_MAX = 5
/** Wave 43c: an anonymous slot is random lower-case hex, 16 to 64 characters (the server's check is the same). */
export const SLOT_RE = /^[0-9a-f]{16,64}$/

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
  /** Wave 43b: the Community chat page's "Only people of this community" (absent = on) and how often each Home tile was used (local counts only). */
  chatOnly?: false
  tileUse?: Record<string, number>
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
    const tiles = tilesOf(o.tiles)
    const managedTiles = tilesOf(o.managedTiles)
    out[id] = {
      kind: o.kind === 'managed' ? 'managed' : 'informal', organizers: strs(o.organizers),
      ...(Array.isArray(o.tiles) ? { tiles } : {}), ...(managedTiles.length ? { managedTiles } : {}), ...(o.connectEvents === true ? { connectEvents: true as const } : {}), ...(typeof o.shareLayout === 'boolean' ? { shareLayout: o.shareLayout } : {}), ...(isStr(o.slot) && SLOT_RE.test(o.slot) ? { slot: o.slot } : {}),
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
  if (o.chatOnly === false) d.chatOnly = false
  if (o.tileUse && typeof o.tileUse === 'object' && !Array.isArray(o.tileUse)) {
    const use = Object.fromEntries(Object.entries(o.tileUse).filter(([k, n]) => (TILES as readonly unknown[]).includes(k) && typeof n === 'number' && Number.isFinite(n) && n > 0))
    if (Object.keys(use).length) d.tileUse = use as Record<string, number>
  }
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
  if (a.tileUse || b.tileUse) out.tileUse = Object.fromEntries(TILES.filter((t) => a.tileUse?.[t] || b.tileUse?.[t]).map((t) => [t, Math.max(a.tileUse?.[t] ?? 0, b.tileUse?.[t] ?? 0)]))
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

export const withMeta = (d: CommunityData, tag: string, patch: Partial<CommunityMeta>): CommunityData => ({ ...d, meta: { ...d.meta, [tag]: { ...metaOf(d, tag), ...patch } } })

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

// ---- Wave 43b community-shell: menu, Home tiles, chat page scope, events colour (pure; no imports: the MCP server reads this file too) ----

/** Jakob (B35/B36): "other users set up their dashboard this way, follow them?" needs usage data shared between people; built disabled, only the local counts run. */
export const DASHBOARD_SOCIAL_DEFAULTS = false
/** Jakob (B8): the WhatsApp bridge is not built (pc24 job 37 has the context); its Advanced row shows disabled. */
export const WHATSAPP_BRIDGE_ENABLED = false

export type MenuId = NavId | 'ask'
/** B33: the menu below the community name. Ask for Support left the top; Timeline and Members (no longer on Home by default) follow. */
export const MENU_ORDER: readonly MenuId[] = ['home', 'spaces', 'events', 'docs', 'chat', 'ask', 'timeline', 'members']

/** The menu entries of a community in menu order: its left-column choice, plus Ask for Support unless switched off. */
export function menuItems(d: CommunityData, tag: string | null): MenuId[] {
  const shown = new Set<MenuId>(leftNav(d, tag))
  if (tag && metaOf(d, tag).ask) shown.add('ask')
  return MENU_ORDER.filter((i) => shown.has(i) && (i === 'ask' || (NAV as readonly string[]).includes(i)))
}

// ---- Home dashboard (B35/B36) ------------------------------------------------------------------------------------------------
export const DEFAULT_TILES: readonly TileId[] = ['events', 'spaces', 'docs', 'members']
const inOrder = (want: ReadonlySet<TileId>): TileId[] => TILES.filter((t) => want.has(t))

/** A manager: this community is managed and I am one of its organizers. */
export const isManager = (d: CommunityData, tag: string): boolean => { const m = metaOf(d, tag); return m.kind === 'managed' && m.organizers.includes('me') }

/** managed = tiles a manager fixed (a bordered section above mine); own = my choice, without the managed ones. */
export function homeTiles(d: CommunityData, tag: string): { managed: TileId[]; own: TileId[] } {
  const m = d.meta?.[tag]
  const managed = inOrder(new Set(m?.managedTiles ?? []))
  return { managed, own: (m?.tiles ?? DEFAULT_TILES).filter((t) => !managed.includes(t)) }
}

/** Shows or hides one of my tiles in this community; a managed tile stays. */
export function toggleTile(d: CommunityData, tag: string, tile: TileId): CommunityData {
  const { managed, own } = homeTiles(d, tag)
  if (managed.includes(tile)) return d
  return withMeta(d, tag, { tiles: inOrder(new Set(own.includes(tile) ? own.filter((t) => t !== tile) : [...own, tile])) })
}

/** Sets my tiles here at once (the known ones, in tile order); a layout offered from another community, or an MCP call. */
export const setOwnTiles = (d: CommunityData, tag: string, tiles: readonly string[]): CommunityData => withMeta(d, tag, { tiles: inOrder(new Set(TILES.filter((t) => tiles.includes(t)))) })

/** Only a manager sets the managed tiles (an empty list clears them); anyone else changes nothing. */
export function setManagedTiles(d: CommunityData, tag: string, tiles: readonly TileId[]): CommunityData {
  if (!isManager(d, tag) || !canEditSettings(d, tag)) return d
  return withMeta(d, tag, { managedTiles: inOrder(new Set(tiles)) })
}

/** While this community has no tile choice of its own, the layout of another community I use (the first one that has one); else null. */
export function startLayout(d: CommunityData, tag: string): TileId[] | null {
  if (d.meta?.[tag]?.tiles) return null
  const other = Object.entries(d.meta ?? {}).find(([id, m]) => id !== tag && m.tiles)
  return other ? homeTiles(d, other[0]).own : null
}

/** The local analytics hook: how often each tile was opened on this device. Nothing leaves the device (DASHBOARD_SOCIAL_DEFAULTS is off). */
export function recordTileUse(d: CommunityData, tile: string): CommunityData {
  if (!(TILES as readonly string[]).includes(tile)) return d
  return { ...d, tileUse: { ...d.tileUse, [tile]: (d.tileUse?.[tile] ?? 0) + 1 } }
}

// ---- Chat page (B8) ----------------------------------------------------------------------------------------------------------
export const chatOnlyCommunity = (d: CommunityData): boolean => d.chatOnly !== false

export function setChatOnly(d: CommunityData, only: boolean): CommunityData {
  const { chatOnly: _c, ...rest } = d
  return only ? rest : { ...rest, chatOnly: false }
}

/** The regular chats on the Community chat page: only people of the picked community (default), or all of them. */
export function communityChatRows<T extends { personId: string }>(rows: readonly T[], people: readonly { id: string; tags?: readonly string[] }[], tag: string | null, only: boolean): T[] {
  if (!only || !tag) return [...rows]
  const inCommunity = new Set(people.filter((p) => p.tags?.includes(tag)).map((p) => p.id))
  return rows.filter((r) => inCommunity.has(r.personId))
}

/** The communities the chat page's switcher offers. */
export const chatCommunities = (d: CommunityData, tags: readonly TagLike[]): { id: string; name: string }[] => listCommunities(d, tags, []).map((r) => ({ id: r.id, name: r.name }))

// ---- Events in my calendar (B33) ---------------------------------------------------------------------------------------------
export const connectEvents = (d: CommunityData, tag: string): boolean => d.meta?.[tag]?.connectEvents === true
export const setConnectEvents = (d: CommunityData, tag: string, on: boolean): CommunityData => withMeta(d, tag, { connectEvents: on ? true : undefined })

/** The colour a community's event wears in my personal calendar: its community colour, when that community is connected; else null. */
export function communityEventColour(d: CommunityData, tags: readonly { id: string; colour: string }[], ev: { communityId?: string }): string | null {
  return ev.communityId && connectEvents(d, ev.communityId) ? tags.find((t) => t.id === ev.communityId)?.colour ?? null : null
}

// ---- Community name (B33) ----------------------------------------------------------------------------------------------------
/** Long press on the community name: the new name goes on the tag label (and the settings name an MCP-made community carries). Null for an empty name or when I may not edit. */
export function renameCommunity<T extends { id: string; label?: string }>(d: CommunityData, tags: readonly T[], id: string, name: string): { data: CommunityData; tags: T[] } | null {
  const n = name.trim().slice(0, 40)
  if (!n || !canEditSettings(d, id)) return null
  return { data: d.meta?.[id]?.name !== undefined ? withMeta(d, id, { name: n }) : d, tags: tags.map((t) => (t.id === id ? { ...t, label: n } : t)) }
}

/* wave43c connect-extras (theta): opt-in dashboard aggregates. The client for the community's server is community_server.ts. */

export const shareLayoutOn = (d: CommunityData, tag: string): boolean => d.meta?.[tag]?.shareLayout === true

/** DASHBOARD_SOCIAL_DEFAULTS is the global master (off); a community's own opt-in switches the social defaults on for that community. */
export const dashboardSocial = (d: CommunityData, tag: string): boolean => DASHBOARD_SOCIAL_DEFAULTS || shareLayoutOn(d, tag)

/** "Share my tile layout anonymously": on mints my random slot once (`newSlot`, 16-64 hex characters); off keeps it so a later on counts me once. */
export function setShareLayout(d: CommunityData, tag: string, on: boolean, newSlot: () => string): CommunityData {
  const slot = d.meta?.[tag]?.slot ?? newSlot()
  return withMeta(d, tag, { shareLayout: on, slot })
}

/** The tiles I show in this community (managed and own), in tile order: what the opt-in sends. */
export function tileSetOf(d: CommunityData, tag: string): TileId[] {
  const { managed, own } = homeTiles(d, tag)
  return inOrder(new Set([...managed, ...own]))
}

/** What the server answers: how many members shared, and per tile how many of them show it. */
export interface TileAggregate { n: number; tiles: Record<string, number> }

/** The share of members showing each tile, whole percent, biggest first; unknown tiles and tiles nobody shows are left out. */
export function tilePercents(a: TileAggregate): { tile: TileId; pct: number }[] {
  if (a.n <= 0) return []
  return TILES.map((tile) => ({ tile, pct: Math.round(((a.tiles[tile] ?? 0) / a.n) * 100) })).filter((r) => r.pct > 0).sort((x, y) => y.pct - x.pct)
}

/** "Follow them": the tiles at least `minPct` percent of the members show. */
export const followTiles = (a: TileAggregate, minPct = 50): TileId[] => tilePercents(a).filter((r) => r.pct >= minPct).map((r) => r.tile)
