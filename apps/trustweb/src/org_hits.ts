import { logoOk } from './organizer_rules'

/** Organizer counters (wave 8): one anonymous POST per milestone, so the organizer sees how many opened, joined and tagged. Never who (I1, I2). */
export type HitKind = 'opened' | 'joined' | 'tagged'

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; keepalive: boolean }) => Promise<unknown>

/** Fire and forget: errors are swallowed, nothing is retried. The body is the event's server id and the kind, nothing else. */
export function hit(fetchFn: FetchFn, srv: string, kind: HitKind): void {
  try {
    fetchFn('/org/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: srv, kind }), keepalive: true }).catch(() => undefined)
  } catch {
    // never blocks the UI
  }
}

/** hit() on the page's own fetch. */
export const sendHit = (srv: string, kind: HitKind): void => hit((u, i) => fetch(u, i), srv, kind)

export interface EventPublic { name: string; logo: string | null }
type GetFn = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
const SRV_RE = /^[0-9a-f]{16}$/

/** The join sheet's name and logo from GET /org/event/<srv>/public; null on any failure. A logo that is not a small safe data URL is dropped. */
export async function fetchEventPublic(getFn: GetFn, srv: string): Promise<EventPublic | null> {
  if (!SRV_RE.test(srv)) return null
  try {
    const r = await getFn(`/org/event/${srv}/public`)
    if (!r.ok) return null
    const j = (await r.json()) as { name?: unknown; logo?: unknown } | null
    if (!j || typeof j.name !== 'string') return null
    const logo = logoOk(j.logo) ? j.logo : null
    return { name: j.name, logo }
  } catch {
    return null
  }
}

/** fetchEventPublic() on the page's own fetch. */
export const loadEventPublic = (srv: string): Promise<EventPublic | null> => fetchEventPublic((u) => fetch(u), srv)
