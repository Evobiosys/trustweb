/**
 * The Manage outliner row's TrustWeb icon and favourite-way link (wave 7). Pure and DOM-free.
 * The favourite way and its phone and email live in `person.fields` by attribute id (packages/person-fields).
 */
import { PERSON_FIELDS } from '../../../packages/person-fields/src/fields'
import { channelLink, normalizeHandle, toE164 } from './channel'
import { ChatDirection } from './chat'
import { Channel } from './model'
import type { AppState, Person } from './model'

const F_FAVOURITE = 'tw-favourite'
const F_PHONE = 'tw-phone'
const F_EMAIL = 'Bxw7k4FWptqp'

const FAVOURITE_OPTIONS = PERSON_FIELDS.find((f) => f.id === F_FAVOURITE)?.options

export const ACTIVE_WINDOW_MS = 7 * 86_400_000

const value = (p: Person, id: string): string => p.fields?.[id] ?? ''

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
  const label = FAVOURITE_OPTIONS?.find((o) => o.id === id)?.label
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
