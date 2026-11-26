/**
 * Event link (E2, wave 7): `<origin>/#ev=<base64url(JSON)>` (`#ev_host=` for the host's` carries the event itself and nothing about people (I1): only the
 * public fields the organizer chose to send. The fragment never reaches a server. Pure and DOM-free.
 */
import { CONNECT_CODE_RE } from './connect_code'
import { newEvent } from './events'
import type { TwEvent } from './model'
import { SHORT_LINK_ORIGINS } from './short_link'

/** peer: what attendees forward to each other. host: the organizer's, which also names the tag (events.ts applyHostLink). */
export type LinkKind = 'peer' | 'host'

/** What travels: the event without my own attendance or when I made it, and the kind of link. */
export type LinkedEvent = Omit<TwEvent, 'createdAt' | 'attended' | 'fromLink' | 'tagLocked' | 'nameReveal' | 'confTo'> & { kind: LinkKind; by?: EventBy }

/** Who sent the link: their own name and own identity, nothing about third people (I1). */
export interface EventBy { name: string; did?: string; /** My nickname (Me.nickname): only the nickname reveal (events.ts revealedBy) may put it in a link as the name. */ nick?: string
  /** hotfix guest-visible: my persistent connect code (22 characters, connect_code.ts): reaches me like the did does, in a tenth of the room. Travels where the did travels. */ code?: string }

const MAX_BYTES = 4096
const SRV = /^[0-9a-f]{16}$/

export function toBase64Url(text: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(text))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** The origin event links carry: the page's own when it is a production app host, else the live app, so links open without this device. */
export function linkOrigin(pageOrigin: string): string {
  return SHORT_LINK_ORIGINS.includes(pageOrigin) ? pageOrigin : 'https://app.trustweb.one'
}

export function encodeEventLink(ev: TwEvent, origin: string, kind: LinkKind, by?: EventBy): string {
  const { id, name, from, to, core, where, conditions, themes, organizer, hosts, hostNamesTags, tagName, linkMode, hostDefault, showAll } = ev
  const payload: LinkedEvent = { kind, id, name, from, where, ...(by?.name ? { by: { name: by.name, ...(by.did ? { did: by.did } : {}), ...(by.code ? { code: by.code } : {}) } } : {}), ...(hosts?.length ? { hosts } : {}), ...(hostNamesTags !== undefined ? { hostNamesTags } : {}), ...(linkMode === 'event' ? { mode: 'event' as const } : {}), ...(showAll ? { showAll: true as const } : {}), ...(tagName ? { tagName } : {}), ...(hostDefault ? { hostDefault } : {}), ...(to ? { to } : {}), ...(core ? { core } : {}), ...(conditions ? { conditions } : {}), ...(themes?.length ? { themes } : {}), ...(organizer ? { organizer } : {}), ...(ev.conference?.length ? { conf: true } : {}) }   // wave44c event-autosave: only that a conference link waits, never the link
  return `${origin}/#${kind === 'host' ? 'ev_host' : 'ev'}=${toBase64Url(JSON.stringify(payload))}${ev.srv ? `&srv=${ev.srv}` : ''}`
}

/** wave47 invite-fits-chat: what an event link leaves out, step by step, so it fits a bounded carrier (one chat message, chat.ts CHAT_TEXT_MAX): 0 nothing; 1 my did
 * (the invited person holds me already; my name stays, and my 22-character connect code when I have one, so a blank browser can still reach me); 2 also the themes; 3 also the conditions; 4 also the organizer line. What makes the event work on the
 * other phone (id, name, dates, place, hosts, tag, mode, show-all) is never left out. Pure: the event handed in is not changed. */
export const LINK_LEAN_MAX = 4
export function leanForLink(ev: TwEvent, by: EventBy | undefined, lean: number): { ev: TwEvent; by?: EventBy } {
  const out: TwEvent = { ...ev }
  if (lean >= 2) delete out.themes
  if (lean >= 3) delete out.conditions
  if (lean >= LINK_LEAN_MAX) delete out.organizer
  return { ev: out, ...(by ? { by: lean >= 1 ? { name: by.name, ...(by.code ? { code: by.code } : {}) } : by } : {}) }
}

/** Wave 43b: the short form the event QR uses (`#evs=` / `#evs_host=`): [id, name, from, to, core from, core to, hosts, mode, tag name] as a JSON array,
 * the same fields as the long form; `mode` is 'e' for the event-only variant (B5); the tag name as the long form carries it (P4). Empty tail entries are dropped. */
export const shortFields = (ev: Pick<LinkedEvent, 'id' | 'name' | 'from' | 'to' | 'core' | 'hosts' | 'linkMode' | 'tagName' | 'hostDefault'>): string => {
  const a: unknown[] = [ev.id, ev.name, ev.from, ev.to ?? '', ev.core?.from ?? '', ev.core?.to ?? '', ev.hosts ?? [], ev.linkMode === 'event' ? 'e' : '', ev.tagName ?? '', ev.hostDefault ?? '']
  while (a.length && (a[a.length - 1] === '' || (Array.isArray(a[a.length - 1]) && !(a[a.length - 1] as unknown[]).length))) a.pop()
  return toBase64Url(JSON.stringify(a))
}

function expandShort(v: unknown, kind: LinkKind): unknown {
  if (!Array.isArray(v)) return null
  const [id, name, from, to, cf, ct, hosts, m, tagName, hostDefault] = v as unknown[]
  return { kind, id, name, from, where: '', ...(to ? { to } : {}), ...(cf || ct ? { core: { from: cf, to: ct } } : {}), ...(Array.isArray(hosts) && hosts.length ? { hosts } : {}), ...(m === 'e' ? { mode: 'event' } : {}), ...(typeof tagName === 'string' && tagName ? { tagName } : {}), ...(hostDefault ? { hostDefault } : {}) }
}

/** The event in a location.hash ("#ev=..." or the host link's "#ev_host=..."), or null for anything missing, mangled, invalid or over 4 KB. */
export function decodeEventLink(hash: string): LinkedEvent | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const compact = params.get('evs') ?? params.get('evs_host')
  const raw = compact ?? params.get('ev') ?? params.get('ev_host')
  if (!raw || raw.length > MAX_BYTES) return null
  try {
    const o: unknown = compact === null ? JSON.parse(fromBase64Url(raw)) : expandShort(JSON.parse(fromBase64Url(raw)), params.has('evs_host') ? 'host' : 'peer')
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
    const c = typeof f.core === 'object' && f.core !== null ? (f.core as Record<string, unknown>) : undefined
    const core = f.core === undefined ? undefined : { from: text(c?.from) ?? '', to: text(c?.to) ?? '' }
    const fields = { name, from, where, to: text(f.to), conditions: text(f.conditions), organizer: text(f.organizer), themes: strings(f.themes), hosts: strings(f.hosts) }
    // A mangled core time costs only the core, never the event.
    const withCore = newEvent({ ...fields, core }, id, 0)
    const ev = withCore === 'core' ? newEvent(fields, id, 0) : withCore
    if (typeof ev === 'string') return null
    const tagName = text(f.tagName)?.trim()
    const b = typeof f.by === 'object' && f.by !== null ? (f.by as Record<string, unknown>) : undefined
    const byName = text(b?.name)?.trim()
    const byDid = text(b?.did)
    const byCode = text(b?.code)
    const { createdAt: _c, attended: _a, ...rest } = ev
    const srv = params.get('srv')
    return { ...rest, kind, ...(byName ? { by: { name: byName, ...(byDid ? { did: byDid } : {}), ...(byCode && CONNECT_CODE_RE.test(byCode) ? { code: byCode } : {}) } } : {}), ...(srv && SRV.test(srv) ? { srv } : {}), ...(typeof f.hostNamesTags === 'boolean' ? { hostNamesTags: f.hostNamesTags } : {}), ...(tagName ? { tagName } : {}), ...(f.mode === 'event' ? { linkMode: 'event' as const } : {}), ...(f.hostDefault === 'open' || f.hostDefault === 'discoverable' || f.hostDefault === 'off' ? { hostDefault: f.hostDefault } : {}), ...(f.showAll === true ? { showAll: true as const } : {}), ...(f.conf === true ? { confHidden: true as const } : {}) }
  } catch {
    return null
  }
}
