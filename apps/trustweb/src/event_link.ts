/**
 * Event link (E2, wave 7): `<origin>/#ev=<base64url(JSON)>` carries the event itself and nothing about people (I1): only the
 * public fields the organizer chose to send. The fragment never reaches a server. Pure and DOM-free.
 */
import { newEvent } from './events'
import type { TwEvent } from './model'

/** What travels: the event without my own attendance, my tags or when I made it. */
export type LinkedEvent = Omit<TwEvent, 'createdAt' | 'attended' | 'fromLink'>

const MAX_BYTES = 4096

function toBase64Url(text: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(text))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function encodeEventLink(ev: TwEvent, origin: string): string {
  const { id, name, from, to, where, conditions, themes, organizer } = ev
  const payload: LinkedEvent = { id, name, from, where, ...(to ? { to } : {}), ...(conditions ? { conditions } : {}), ...(themes?.length ? { themes } : {}), ...(organizer ? { organizer } : {}) }
  return `${origin}/#ev=${toBase64Url(JSON.stringify(payload))}`
}

/** The event in a location.hash ("#ev=..."), or null for anything missing, mangled, invalid or over 4 KB. */
export function decodeEventLink(hash: string): LinkedEvent | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('ev')
  if (!raw || raw.length > MAX_BYTES) return null
  try {
    const o: unknown = JSON.parse(fromBase64Url(raw))
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
    const f = o as Record<string, unknown>
    const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    const id = text(f.id)
    const name = text(f.name)
    const from = text(f.from)
    const where = text(f.where)
    if (!id || !name || !from || !where) return null
    const themes = Array.isArray(f.themes) && f.themes.every((t) => typeof t === 'string') ? (f.themes as string[]) : undefined
    const ev = newEvent({ name, from, where, to: text(f.to), conditions: text(f.conditions), organizer: text(f.organizer), themes }, id, 0)
    if (typeof ev === 'string') return null
    const { createdAt: _c, attended: _a, ...rest } = ev
    return rest
  } catch {
    return null
  }
}
