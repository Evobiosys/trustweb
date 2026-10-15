/**
 * Event link (E2, wave 7): `<origin>/#ev=<base64url(JSON)>` (`#ev_host=` for the host's` carries the event itself and nothing about people (I1): only the
 * public fields the organizer chose to send. The fragment never reaches a server. Pure and DOM-free.
 */
import { newEvent } from './events'
import type { TwEvent } from './model'
import { SHORT_LINK_ORIGINS } from './short_link'

/** peer: what attendees forward to each other. host: the organizer's, which also names the tag (events.ts applyHostLink). */
export type LinkKind = 'peer' | 'host'

/** What travels: the event without my own attendance or when I made it, and the kind of link. */
export type LinkedEvent = Omit<TwEvent, 'createdAt' | 'attended' | 'fromLink' | 'tagLocked'> & { kind: LinkKind; by?: EventBy }

/** Who sent the link: their own name and own identity, nothing about third people (I1). */
export interface EventBy { name: string; did?: string }

const MAX_BYTES = 4096
const SRV = /^[0-9a-f]{16}$/

function toBase64Url(text: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(text))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** The origin event links carry: the page's own when it is a production app host, else the live app, so links open without this device. */
export function linkOrigin(pageOrigin: string): string {
  return SHORT_LINK_ORIGINS.includes(pageOrigin) ? pageOrigin : 'https://app.trustweb.one'
}

export function encodeEventLink(ev: TwEvent, origin: string, kind: LinkKind, by?: EventBy): string {
  const { id, name, from, to, where, conditions, themes, organizer, hosts, hostNamesTags, tagName } = ev
  const payload: LinkedEvent = { kind, id, name, from, where, ...(by?.name ? { by: { name: by.name, ...(by.did ? { did: by.did } : {}) } } : {}), ...(hosts?.length ? { hosts } : {}), ...(hostNamesTags !== undefined ? { hostNamesTags } : {}), ...(tagName ? { tagName } : {}), ...(to ? { to } : {}), ...(conditions ? { conditions } : {}), ...(themes?.length ? { themes } : {}), ...(organizer ? { organizer } : {}) }
  return `${origin}/#${kind === 'host' ? 'ev_host' : 'ev'}=${toBase64Url(JSON.stringify(payload))}${ev.srv ? `&srv=${ev.srv}` : ''}`
}

/** The event in a location.hash ("#ev=..." or the host link's "#ev_host=..."), or null for anything missing, mangled, invalid or over 4 KB. */
export function decodeEventLink(hash: string): LinkedEvent | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const raw = params.get('ev') ?? params.get('ev_host')
  if (!raw || raw.length > MAX_BYTES) return null
  try {
    const o: unknown = JSON.parse(fromBase64Url(raw))
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
    const f = o as Record<string, unknown>
    const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    const kind = f.kind
    if (kind !== 'peer' && kind !== 'host') return null
    const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((t) => typeof t === 'string') ? (v as string[]) : undefined)
    const id = text(f.id)
    const name = text(f.name)
    const from = text(f.from)
    const where = text(f.where)
    if (!id || !name || !from || where === undefined) return null
    const ev = newEvent({ name, from, where, to: text(f.to), conditions: text(f.conditions), organizer: text(f.organizer), themes: strings(f.themes), hosts: strings(f.hosts) }, id, 0)
    if (typeof ev === 'string') return null
    const tagName = text(f.tagName)?.trim()
    const b = typeof f.by === 'object' && f.by !== null ? (f.by as Record<string, unknown>) : undefined
    const byName = text(b?.name)?.trim()
    const byDid = text(b?.did)
    const { createdAt: _c, attended: _a, ...rest } = ev
    const srv = params.get('srv')
    return { ...rest, kind, ...(byName ? { by: { name: byName, ...(byDid ? { did: byDid } : {}) } } : {}), ...(srv && SRV.test(srv) ? { srv } : {}), ...(typeof f.hostNamesTags === 'boolean' ? { hostNamesTags: f.hostNamesTags } : {}), ...(tagName ? { tagName } : {}) }
  } catch {
    return null
  }
}
