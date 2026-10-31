// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Matrix module (wave 27, msg-matrix): pure parts, no DOM, no fetch. Matrix Client-Server API v3 shapes as documented at
 * spec.matrix.org; nothing here was run against a live server (see the report).
 */
import type { Channel, Person } from '../../model'
import type { ThreadSummary } from '../registry'

export const DEFAULT_HOMESERVER = 'https://matrix.org'

/** The deep link into Element X for a room id, alias or user id. ONE place to change the scheme (Element X documents no element:// room link). */
export const ELEMENT_LINK = (target: string): string => `https://matrix.to/#/${target}`

/** https only; http only for localhost (dev). Returns the origin, or null. A bare "host" is taken as https. */
export function normalizeHomeserver(input: string): string | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null
  let u: URL
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol === 'http:' && local) return u.origin
  return u.protocol === 'https:' && (local || u.hostname.includes('.')) ? u.origin : null
}

/** /.well-known/matrix/client body -> the homeserver base_url, or null. */
export function parseWellKnown(json: unknown): string | null {
  const hs = (json as { 'm.homeserver'?: { base_url?: unknown } } | null)?.['m.homeserver']
  return typeof hs?.base_url === 'string' ? normalizeHomeserver(hs.base_url) : null
}

/** GET /login body -> which flows TrustWeb can do. none = neither (e.g. a server that only does OIDC-native login). */
export function pickLogin(body: unknown): { password: boolean; sso: boolean; none: boolean } {
  const flows = (body as { flows?: { type?: unknown }[] } | null)?.flows
  const types = Array.isArray(flows) ? flows.map((f) => f?.type) : []
  const password = types.includes('m.login.password')
  const sso = types.includes('m.login.sso')
  return { password, sso, none: !password && !sso }
}

export const ssoRedirectUrl = (hs: string, redirectUrl: string): string =>
  `${hs}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(redirectUrl)}`

/** The loginToken a server appends when SSO sends the browser back. */
export const loginTokenFrom = (search: string): string | null => new URLSearchParams(search).get('loginToken')

/** What is kept on this device only (localStorage). Never the password. */
export interface MatrixSession { hs: string; token: string; userId: string; deviceId?: string }

export function parseSession(raw: string | null): MatrixSession | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<MatrixSession>
    return typeof s.hs === 'string' && typeof s.token === 'string' && s.token ? { hs: s.hs, token: s.token, userId: typeof s.userId === 'string' ? s.userId : '', ...(typeof s.deviceId === 'string' ? { deviceId: s.deviceId } : {}) } : null
  } catch { return null }
}

/** The sync filter: one timeline event per room, lazy members, no presence, only the state that names a room, only m.direct. */
export const SYNC_FILTER = {
  presence: { types: [] as string[] },
  account_data: { types: ['m.direct'] },
  room: {
    timeline: { limit: 1 },
    state: { lazy_load_members: true, types: ['m.room.name', 'm.room.canonical_alias'] },
    ephemeral: { types: [] as string[] },
    account_data: { types: [] as string[] },
  },
}

interface Ev { type?: string; origin_server_ts?: number; content?: Record<string, unknown>; event_id?: string; sender?: string }
interface SyncRoom { state?: { events?: Ev[] }; timeline?: { events?: Ev[] }; unread_notifications?: { notification_count?: number } }
export interface SyncBody { account_data?: { events?: Ev[] }; rooms?: { join?: Record<string, SyncRoom> } }

/** roomId -> the other user, from m.direct account data ({userId: [roomIds]}). */
export function parseDirect(sync: SyncBody): Record<string, string> {
  const ev = sync.account_data?.events?.find((e) => e.type === 'm.direct')
  const out: Record<string, string> = {}
  for (const [user, rooms] of Object.entries(ev?.content ?? {})) if (Array.isArray(rooms)) for (const r of rooms) if (typeof r === 'string') out[r] = user
  return out
}

/** Channel.Matrix's value; model.ts is not imported as a value so these pure parts load without the app's crypto packages. */
const MATRIX = 'matrix' as Channel.Matrix

type PersonLike = Pick<Person, 'id' | 'peerId' | 'channels'>

/** The peerId of the TrustWeb person whose Matrix id (Channel.Matrix, channel.ts) is this user; none without a peerId. */
export function matchPeer(userId: string, people: readonly PersonLike[]): string | undefined {
  const want = userId.toLowerCase()
  return people.find((p) => p.peerId && p.channels?.[MATRIX]?.toLowerCase() === want)?.peerId
}

/** A minimal filtered sync -> room list, newest first. */
export function parseSync(sync: SyncBody, people: readonly PersonLike[]): ThreadSummary[] {
  const direct = parseDirect(sync)
  const out: ThreadSummary[] = []
  for (const [id, room] of Object.entries(sync.rooms?.join ?? {})) {
    const state = room.state?.events ?? []
    const name = state.find((e) => e.type === 'm.room.name')?.content?.name
    const alias = state.find((e) => e.type === 'm.room.canonical_alias')?.content?.alias
    const dm = direct[id]
    const title = typeof name === 'string' && name ? name : typeof alias === 'string' && alias ? alias : dm ?? id
    const last = room.timeline?.events?.[room.timeline.events.length - 1]
    const peerId = dm ? matchPeer(dm, people) : undefined
    out.push({ id, title, lastAt: last?.origin_server_ts ?? 0, unread: room.unread_notifications?.notification_count ?? 0, ...(peerId ? { peerId } : {}) })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt)
}

export interface RoomMessage { id: string; sender: string; at: number; text: string; encrypted: boolean }

/** GET /rooms/{id}/messages?dir=b body -> text messages and encrypted placeholders, oldest first. No decryption (v1). */
export function parseMessages(body: unknown): RoomMessage[] {
  const chunk = (body as { chunk?: Ev[] } | null)?.chunk
  if (!Array.isArray(chunk)) return []
  const out: RoomMessage[] = []
  for (const e of chunk) {
    const base = { id: e.event_id ?? '', sender: e.sender ?? '', at: e.origin_server_ts ?? 0 }
    if (e.type === 'm.room.encrypted') out.push({ ...base, text: '', encrypted: true })
    else if (e.type === 'm.room.message' && e.content?.msgtype === 'm.text' && typeof e.content.body === 'string') out.push({ ...base, text: e.content.body, encrypted: false })
  }
  return out.sort((a, b) => a.at - b.at)
}
