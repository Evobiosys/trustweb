// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-shared-resource (Jakob: "one resource visible in an event AND in a community, with synced updates"): a resource added "for the event and
 * its community" (resource_scope.ts addBoth, `synced`) travels as a sealed `event` envelope with `res` (apps/demo wire.ts parseRes), pair key per
 * connected person, over the existing relay (net.ts sendEvent). No server holds it.
 *   - Sent: my device sends a new, edited, switched-off or removed item to the connected people of the community and of its events. An edit is
 *     noticed by `syncFp` (a fingerprint of what travels), so no edit site needs a hook: `sweep()` runs after a save.
 *   - Passed on: guests are usually connected to the host only, so a HOST's device passes a new item on once to the others it is connected to (never
 *     back to the sender or the author); an unchanged item (same id, same time) is dropped, so hosts never loop.
 *   - Taken: only when I hold the community or the event and the sender belongs to either; last writer wins on the author's clock (a tie keeps what I
 *     hold); an update comes only from the author or from whoever delivered the item first; an item of mine is never overwritten; retracted = hidden
 *     (retractedAt), never deleted. A received item is read-only for me. An event-private item (wave45) is never sent: only `synced` items are.
 * Pure rules plus one engine whose transport the app hands in (main.ts), so the rules test without a relay.
 */
import type { EventEnvelope, ResRetraction } from '../../demo/src/types'
import { QID_RE } from '../../demo/src/types'
import type { AppState, InventoryItem, Person, ResBlock, ResourceKind, TwEvent } from './model'
import { isEventHost } from './event_roles'
import { namedHost } from './event_conference'
import { cleanHelloName } from './hello'
import { stripUnsafe } from './safe_text'
import { BLOCK_TEXT_MAX } from './resource_blocks'
import { REPLAY_GAP_MS } from './events_refetch'
import { communityOfEvent } from './event_visibility'
import { parseCommunity } from './ext/community-mighty/community_data'

export type Res = Exclude<NonNullable<EventEnvelope['res']>, ResRetraction>
export type Outcome = 'new' | 'updated' | 'ignored'
type Rec = Pick<AppState, 'people' | 'me' | 'inventory'> & Partial<Pick<AppState, 'events' | 'extData'>>

const SKEW_MS = 5 * 60_000
const TOMBSTONE_MS = 30 * 86_400_000
const TEXT_MAX = 120
const NAME_MAX = 40
const KINDS: readonly string[] = ['book', 'publication', 'reference', 'recording', 'link', 'other']
const BLOCKS_MAX = 200
const BLOCK_DEPTH = 6
/** wave46 iyg-reviewfix F4: the most items I keep from one sender, and from one community; host forwards per sender per window. */
export const PER_SENDER_MAX = 100
export const PER_SCOPE_MAX = 300
export const FORWARD_MAX = 20
export const FORWARD_WINDOW_MS = 10 * 60_000

const live = (p: Person): boolean => p.deleted_at === undefined && !p.via
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
const cleanName = (raw: unknown): string => cleanHelloName(String(raw ?? '')).slice(0, NAME_MAX)
const cleanText = (raw: unknown): string => stripUnsafe(String(raw ?? '')).replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
const eventsOf = (s: Rec, ids: readonly string[]): TwEvent[] => (s.events ?? []).filter((e) => ids.includes(e.id))
const eventIdsOf = (i: Pick<InventoryItem, 'eventId' | 'eventIds'>): string[] => i.eventIds ?? (i.eventId ? [i.eventId] : [])

/** Mine and sent: a both-scoped item I made (never a received one, never an event-private one). */
export const syncedMine = (i: InventoryItem): boolean => i.synced === true && !i.sharedBy

const retracted = (i: InventoryItem): boolean => i.retractedAt !== undefined || (!i.sharedBy && !i.included)

/** What travels, as a short fingerprint: any change of it is an edit. */
export function fingerprint(i: InventoryItem): string {
  const s = JSON.stringify([i.text, i.link, i.kind, i.blocks, retracted(i), i.communityId, eventIdsOf(i)])
  let h = 0x811c9dc5
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16) + s.length.toString(16)
}

export const payloadOf = (i: InventoryItem, by: string): Res => ({
  id: i.id, text: i.text, communityId: i.communityId as string, eventIds: eventIdsOf(i), updatedAt: i.updatedAt ?? i.createdAt, by,
  ...(i.kind ? { kind: i.kind } : {}), ...(i.link ? { link: i.link } : {}), ...(i.blocks?.length ? { blocks: i.blocks } : {}), ...(retracted(i) ? { retracted: true as const } : {}),
})

/** Someone belongs to a scope: holds the community tag, is tagged with one of its events, or is named host of one. */
function inScope(s: Rec, p: Person, communityId: string, eventIds: readonly string[]): boolean {
  return live(p) && (String(p.fields?.[communityId]) === 'true' || eventIds.some((id) => p.events?.includes(id)) || eventsOf(s, eventIds).some((e) => namedHost(e, p.name, s.people)))
}
/** wave46 iyg-reviewfix F3: belongs to the community itself: holds its tag or is one of its organizers. */
const inCommunity = (s: Rec, p: Person, communityId: string): boolean =>
  live(p) && (String(p.fields?.[communityId]) === 'true' || parseCommunity(s.extData?.['community-mighty']).meta?.[communityId]?.organizers.includes(p.id) === true)
/** F3: may `p` speak for these events of this community: in the community, or attends / hosts every listed event I know. */
const mayShareInto = (s: Rec, p: Person, communityId: string, eventIds: readonly string[]): boolean => {
  const known = eventsOf(s, eventIds)
  return inCommunity(s, p, communityId) || (live(p) && known.length > 0 && known.every((e) => p.events?.includes(e.id) || namedHost(e, p.name, s.people)))
}
/** The connected people (a device to send to) of a scope. */
export const recipientsOf = (s: Rec, r: Pick<Res, 'communityId' | 'eventIds'>): Person[] => s.people.filter((p) => p.peerId && inScope(s, p, r.communityId, r.eventIds))

function cleanBlocks(v: unknown, depth = 0, budget = { n: BLOCKS_MAX }): ResBlock[] {
  if (!Array.isArray(v) || depth >= BLOCK_DEPTH) return []
  const out: ResBlock[] = []
  for (const b of v as Record<string, unknown>[]) {
    if (budget.n <= 0) break
    if (typeof b !== 'object' || b === null || typeof b.id !== 'string' || !QID_RE.test(b.id)) continue
    budget.n--
    out.push({ id: b.id, text: stripUnsafe(String(b.text ?? '')).replace(/\s+/g, ' ').trim().slice(0, BLOCK_TEXT_MAX), children: cleanBlocks(b.children, depth + 1, budget), ...(b.collapsed === true ? { collapsed: true as const } : {}) })
  }
  return out
}
const isHttps = (v: unknown): v is string => { try { return typeof v === 'string' && new URL(v).protocol === 'https:' } catch { return false } }

/** A sealed res from `who` (a person of mine): stored or updated on my device. `holds` = I hold this community (its tag exists in my record). A retraction (F5) changes only an item I hold. */
export function applyIncoming(s: Rec, who: Person, p: Res | ResRetraction, now: number, holds: (tag: string) => boolean): Outcome {
  const have = s.inventory.find((i) => i.id === p.id)
  const retraction = 'text' in p ? undefined : p
  const full = 'text' in p ? p : undefined
  if (retraction || p.retracted) {
    if (!have?.sharedBy || have.communityId !== p.communityId || !live(who) || !mayShareInto(s, who, have.communityId, eventIdsOf(have))) return 'ignored'
    const at = Math.min(p.updatedAt, now + SKEW_MS)
    if (have.sharedFrom !== who.id && !sameName(who.name, have.sharedBy)) return 'ignored'
    if (at <= (have.updatedAt ?? have.createdAt)) return 'ignored'
    Object.assign(have, { updatedAt: at, included: false, retractedAt: at })
    return 'updated'
  }
  if (!full) return 'ignored'
  const mine = eventsOf(s, full.eventIds).filter((e) => e.attended || isEventHost(e, s.me.displayName, s.people))
  if (!live(who) || (!holds(full.communityId) && mine.length === 0) || !mayShareInto(s, who, full.communityId, full.eventIds)) return 'ignored'
  if (eventsOf(s, full.eventIds).some((e) => communityOfEvent(e) !== full.communityId)) return 'ignored' // F3: an event of another community
  const text = cleanText(full.text)
  if (!text) return 'ignored'
  const at = Math.min(full.updatedAt, now + SKEW_MS)
  const by = (eventsOf(s, full.eventIds).some((e) => namedHost(e, who.name, s.people)) && cleanName(full.by)) || cleanName(who.name) || 'TrustWeb'
  if (have && (!have.sharedBy || (have.sharedFrom !== who.id && !sameName(who.name, have.sharedBy)) || at <= (have.updatedAt ?? have.createdAt))) return 'ignored'
  if (!have && (s.inventory.filter((i) => i.sharedFrom === who.id).length >= PER_SENDER_MAX || s.inventory.filter((i) => i.sharedBy && i.communityId === full.communityId).length >= PER_SCOPE_MAX)) return 'ignored' // F4
  const blocks = full.blocks ? cleanBlocks(full.blocks) : []
  const fields: Partial<InventoryItem> = {
    text, communityId: full.communityId, eventId: full.eventIds[0], eventIds: [...full.eventIds], updatedAt: at, included: true,
    ...(full.kind && KINDS.includes(full.kind) ? { kind: full.kind as ResourceKind } : {}), ...(isHttps(full.link) ? { link: full.link } : {}), ...(blocks.length ? { blocks } : {}),
  }
  if (!have) { s.inventory.push({ id: full.id, audience: 'me', createdAt: now, sharedBy: by, sharedFrom: who.id, ...fields } as InventoryItem); return 'new' }
  for (const k of ['kind', 'link', 'blocks', 'retractedAt'] as const) delete have[k]
  Object.assign(have, fields)
  return 'updated'
}

export interface ResourceSyncHost<P extends { id: string }> {
  state(): AppState
  save(): void
  now(): number
  peers(): P[]
  send(peer: P, env: EventEnvelope): Promise<void>
  /** The community (colour tag id) exists in my record. */
  holdsCommunity(tag: string): boolean
  /** A received item changed: redraw what shows it. */
  changed(): void
}

export function createResourceSync<P extends { id: string }>(h: ResourceSyncHost<P>) {
  /** peer id -> item id -> the updatedAt last sent there (this session). */
  const sent = new Map<string, Map<string, number>>()
  const askedAt = new Map<string, number>()
  /** F4: when this device last forwarded something a sender gave it (person id -> times). */
  const forwarded = new Map<string, number[]>()
  /** My synced items as of the last sweep (AppState.resKnown, this device only, so it survives a reload): one that vanishes from the list is retracted for the others; a retracted entry stays as the tombstone catch-up re-sends (30 days). */
  const known = (): Record<string, Res> => (h.state().resKnown ??= {})
  const myName = (): string => cleanName(h.state().me.displayName) || 'TrustWeb'

  async function push(r: Res, to: readonly Person[]): Promise<number> {
    let n = 0
    for (const who of to) {
      const peer = h.peers().find((x) => x.id === who.peerId)
      if (!peer) continue
      const wire: Res | ResRetraction = r.retracted ? { id: r.id, retracted: true, updatedAt: r.updatedAt, communityId: r.communityId } : r // F5: a retraction carries no content
      await h.send(peer, { v: 1, t: 'event', res: wire }).then(() => { (sent.get(peer.id) ?? sent.set(peer.id, new Map()).get(peer.id)!).set(r.id, r.updatedAt); n++ }, () => undefined)
    }
    return n
  }
  const iHostAny = (ids: readonly string[]): boolean => eventsOf(h.state(), ids).some((e) => isEventHost(e, h.state().me.displayName, h.state().people))

  return {
    /** After a save: new, edited, switched-off and removed items of mine go out. How many sends went. */
    async sweep(): Promise<number> {
      const s = h.state()
      let n = 0
      const mine = s.inventory.filter(syncedMine)
      for (const i of mine) {
        const fp = fingerprint(i)
        if (fp === i.syncFp && (!known()[i.id]?.retracted || retracted(i))) continue // a removed item that came back (restored from the trash) goes out again
        i.updatedAt = i.syncFp === undefined ? i.updatedAt ?? i.createdAt : Math.max(h.now(), (i.updatedAt ?? i.createdAt) + 1)
        i.syncFp = fp
        h.save()
        const r = payloadOf(i, myName())
        known()[i.id] = r
        n += await push(r, recipientsOf(s, r))
      }
      for (const [id, last] of Object.entries(known())) {
        if (mine.some((i) => i.id === id)) continue
        if (h.now() - last.updatedAt > TOMBSTONE_MS) { delete known()[id]; continue }
        if (last.retracted) continue
        const r: Res = { ...last, retracted: true, updatedAt: Math.max(h.now(), last.updatedAt + 1) }
        known()[id] = r
        h.save()
        n += await push(r, recipientsOf(s, r))
      }
      return n
    },
    /** A sealed res from a connected peer. True when it was new or newer and kept (a host then passes it on once). */
    async onEnvelope(peer: { id: string }, r: Res | ResRetraction): Promise<boolean> {
      const s = h.state()
      const who = s.people.find((p) => p.peerId === peer.id && live(p))
      if (!who || applyIncoming(s, who, r, h.now(), h.holdsCommunity) === 'ignored') return false
      h.save()
      h.changed()
      const item = s.inventory.find((i) => i.id === r.id) as InventoryItem
      if (iHostAny(eventIdsOf(item))) {
        const kept = payloadOf(item, item.sharedBy ?? '')
        const recent = (forwarded.get(who.id) ?? []).filter((t) => h.now() - t < FORWARD_WINDOW_MS)
        forwarded.set(who.id, recent)
        if (recent.length >= FORWARD_MAX) return true // F4: kept, not passed on
        recent.push(h.now())
        // F3: only into the scopes the sender belongs to on my device: the community when it is in it, else just the events it attends or hosts
        const scope = { communityId: inCommunity(s, who, kept.communityId) ? kept.communityId : '', eventIds: kept.eventIds.filter((id) => who.events?.includes(id) || eventsOf(s, [id]).some((e) => namedHost(e, who.name, s.people))) }
        await push(kept, recipientsOf(s, scope).filter((p) => p.id !== who.id && !sameName(p.name, kept.by)))
      }
      return true
    },
    /** A person just connected or joined: they get what changed since the last send, from the author's and a host's device; at most once per REPLAY_GAP_MS. */
    async catchUp(peer: { id: string }): Promise<number> {
      const s = h.state()
      const who = s.people.find((p) => p.peerId === peer.id && live(p))
      if (!who || h.now() - (askedAt.get(peer.id) ?? -Infinity) < REPLAY_GAP_MS) return 0
      askedAt.set(peer.id, h.now())
      let n = 0
      for (const i of s.inventory) {
        if (!(syncedMine(i) || (i.sharedBy && i.communityId && iHostAny(eventIdsOf(i))))) continue
        const r = payloadOf(i, i.sharedBy ?? myName())
        if (!r.communityId || sameName(who.name, r.by) || !inScope(s, who, r.communityId, r.eventIds) || (sent.get(peer.id)?.get(r.id) ?? -Infinity) >= r.updatedAt) continue
        n += await push(r, [who])
      }
      for (const r of Object.values(known())) { // an item I removed: its retraction reaches whoever was offline
        if (!r.retracted || sameName(who.name, r.by) || !inScope(s, who, r.communityId, r.eventIds) || (sent.get(peer.id)?.get(r.id) ?? -Infinity) >= r.updatedAt || s.inventory.some((i) => i.id === r.id)) continue
        n += await push(r, [who])
      }
      return n
    },
  }
}
export type ResourceSync = ReturnType<typeof createResourceSync>
