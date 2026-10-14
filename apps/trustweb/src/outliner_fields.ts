/**
 * The Manage outliner's fields (wave 7): which fields show in a person's simple and advanced view, where the user put them (per device),
 * and the collapsed row's TrustWeb icon and favourite-way link. Pure and DOM-free apart from the layout's localStorage key.
 *
 * Values: name, context and ring live on the person; every other field in `person.fields` by attribute id (packages/person-fields).
 * A ring change goes through the app's changeRing, never through here.
 */
import { PERSON_FIELDS } from '../../../packages/person-fields/src/fields'
import { channelLink, normalizeHandle, toE164 } from './channel'
import { ChatDirection } from './chat'
import { Channel } from './model'
import type { AppState, Person } from './model'

export const F_FIRST = 'tw-first'
export const F_LAST = 'tw-last'
export const F_CONTEXT = 'tw-context'
export const F_RING = 'tw-ring'
export const F_FAVOURITE = 'tw-favourite'
const F_PHONE = 'tw-phone'
const F_EMAIL = 'Bxw7k4FWptqp'
/** Tana's Last Name: the last-name slot above replaces it. */
const TANA_LAST = 'kb0JInYEW2lD'

export type FieldKind = 'text' | 'checkbox' | 'options' | 'ring'
export interface Slot { id: string; label: string; kind: FieldKind; options?: { id: string; label: string }[] }

const BUILTIN: Slot[] = [
  { id: F_FIRST, label: 'First name', kind: 'text' },
  { id: F_LAST, label: 'Last name', kind: 'text' },
  { id: F_CONTEXT, label: 'Context (met in which context / intending to connect)', kind: 'text' },
  { id: F_RING, label: 'Ring', kind: 'ring' },
]

const DEFAULT_SIMPLE = new Set([...BUILTIN.map((x) => x.id), F_FAVOURITE])
const KIND: Record<string, FieldKind> = { checkbox: 'checkbox', options: 'options' }

/** Every slot, simple defaults first, then the schema's fields in schema order. */
export const SLOTS: readonly Slot[] = [
  ...BUILTIN,
  ...PERSON_FIELDS.filter((f) => f.id !== TANA_LAST).map((f): Slot => ({ id: f.id, label: f.label, kind: KIND[f.type] ?? 'text', options: f.options })),
]
const BY_ID = new Map(SLOTS.map((x) => [x.id, x]))
export const slotOf = (id: string): Slot | undefined => BY_ID.get(id)

export const ACTIVE_WINDOW_MS = 7 * 86_400_000

export function value(p: Person, id: string): string {
  const [first, ...rest] = p.name.trim().split(/\s+/)
  if (id === F_FIRST) return first ?? ''
  if (id === F_LAST) return rest.join(' ')
  if (id === F_CONTEXT) return p.context
  if (id === F_RING) return p.ring
  return p.fields?.[id] ?? ''
}

/** Writes one non-ring field. A name keeps its 40 characters, a context its 80 (the add sheet's limits). */
export function setValue(p: Person, id: string, v: string): void {
  const t = v.trim()
  if (id === F_FIRST || id === F_LAST) {
    const first = id === F_FIRST ? t : value(p, F_FIRST)
    const last = id === F_LAST ? t : value(p, F_LAST)
    p.name = [first, last].filter(Boolean).join(' ').slice(0, 40) || p.name
  } else if (id === F_CONTEXT) p.context = t.slice(0, 80)
  else if (id !== F_RING) {
    const next = { ...(p.fields ?? {}) }
    if (t) next[id] = t.slice(0, 500); else delete next[id]
    p.fields = next
  }
}

export interface Layout { simple: string[]; advanced: string[] }
const LAYOUT_KEY = 'tw-outliner-layout'

/** Stored ids that still exist, each once; ids the stored layout lacks go to advanced (a new schema field), a new default-simple field to simple. */
export function reconcile(raw: Partial<Layout> | null): Layout {
  const seen = new Set<string>()
  const keep = (a: unknown): string[] => (Array.isArray(a) ? a : []).filter((id): id is string => typeof id === 'string' && BY_ID.has(id) && !seen.has(id) && !!seen.add(id))
  const simple = keep(raw?.simple)
  const advanced = keep(raw?.advanced)
  for (const x of SLOTS) if (!seen.has(x.id)) (DEFAULT_SIMPLE.has(x.id) ? simple : advanced).push(x.id)
  return { simple, advanced }
}

export function loadLayout(): Layout {
  try { return reconcile(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')) } catch { return reconcile(null) }
}
export function saveLayout(l: Layout): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)) } catch { /* storage blocked: the placement lasts this visit only */ }
}

/** Simple = placed there, plus every advanced field that has a value; advanced = the rest. */
export function sections(p: Person, l: Layout): Layout {
  const valued = l.advanced.filter((id) => value(p, id) !== '')
  return { simple: [...l.simple, ...valued], advanced: l.advanced.filter((id) => !valued.includes(id)) }
}

/** Moves a field to a section, before another field (append when that one is not in the section). Returns a new layout. */
export function moveField(l: Layout, id: string, to: keyof Layout, before: string | null): Layout {
  const out: Layout = { simple: l.simple.filter((x) => x !== id), advanced: l.advanced.filter((x) => x !== id) }
  const at = before === null ? -1 : out[to].indexOf(before)
  out[to].splice(at < 0 ? out[to].length : at, 0, id)
  return out
}

export enum Presence { Active = 'active', Quiet = 'quiet' }

/** Connected on TrustWeb: active when they wrote within the window, else quiet. Not connected: null. */
export function presence(s: Pick<AppState, 'chats'>, p: Person, now: number, windowMs = ACTIVE_WINDOW_MS): Presence | null {
  if (!p.peerId) return null
  const last = Math.max(0, ...(s.chats?.[p.peerId]?.messages ?? []).filter((m) => m.dir === ChatDirection.In).map((m) => m.at))
  return now - last <= windowMs ? Presence.Active : Presence.Quiet
}

export interface FavouriteLink { id: string; label: string; glyph: string; href: string }
const CHANNEL_OF: Record<string, Channel> = { signal: Channel.Signal, whatsapp: Channel.WhatsApp, matrix: Channel.Matrix }
const GLYPH: Record<string, string> = { email: '✉', call: '✆', sms: '✎', signal: 'S', whatsapp: 'W', matrix: 'M' }

/** The deep link of the favourite way to connect, when that way has a usable value. https links for the messengers (a custom scheme fails silently without the app, channel.ts). */
export function favouriteLink(p: Person): FavouriteLink | null {
  const id = value(p, F_FAVOURITE)
  const label = slotOf(F_FAVOURITE)?.options?.find((o) => o.id === id)?.label
  if (!label) return null
  const phone = toE164(value(p, F_PHONE))
  const email = value(p, F_EMAIL)
  const ch = CHANNEL_OF[id]
  const handle = ch && p.channels?.[ch] ? channelLink(ch, p.channels[ch] as string) : null
  const href = id === 'email' ? (email && !email.startsWith('https') ? mail(email) : null)
    : id === 'call' ? (phone && `tel:${phone}`)
    : id === 'sms' ? (phone && `sms:${phone}`)
    : handle
  return href ? { id, label, glyph: GLYPH[id], href } : null
}

function mail(v: string): string | null {
  const a = normalizeHandle(Channel.Delta, v)
  return a && a.includes('@') ? `mailto:${a}` : null
}
