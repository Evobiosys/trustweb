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
