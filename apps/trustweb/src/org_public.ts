// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The event's public face for the join sheet: GET /org/event/<srv>/public → {name, logo?}. No body, no headers, no credentials:
 * the request says which event, never who asks (I1, I2). Every error is swallowed; the sheet works without it (offline-first).
 */
import { logoOk } from './organizer_rules'

export interface OrgPublic { name: string; logo?: string }

type FetchFn = (url: string, init: { method: 'GET'; credentials: 'omit' }) => Promise<{ status: number; json: () => Promise<unknown> }>

const SRV_RE = /^[0-9a-f]{16}$/

export async function fetchPublic(fetchFn: FetchFn, srv: string): Promise<OrgPublic | null> {
  if (typeof srv !== 'string' || !SRV_RE.test(srv)) return null
  try {
    const r = await fetchFn(`/org/event/${srv}/public`, { method: 'GET', credentials: 'omit' })
    if (r.status !== 200) return null
    const j = await r.json()
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null
    const { name, logo } = j as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim() || name.length > 120) return null
    return typeof logo === 'string' && logoOk(logo) ? { name, logo } : { name }
  } catch {
    return null
  }
}

/** fetchPublic() on the page's own fetch. */
export const loadPublic = (srv: string): Promise<OrgPublic | null> => fetchPublic((u, i) => fetch(u, i), srv)
