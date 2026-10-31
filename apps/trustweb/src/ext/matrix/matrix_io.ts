// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Matrix module (wave 27): the only file that calls fetch, injected so tests stub it. Talks to the homeserver the person typed, nowhere else. */
import { SYNC_FILTER, parseWellKnown, type MatrixSession, type SyncBody } from './matrix'

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const API = '/_matrix/client/v3'

export function createClient(f: FetchLike) {
  const get = async (url: string, token?: string): Promise<unknown> => {
    const r = await f(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
    if (!r.ok) throw new Error(`matrix ${r.status}`)
    return r.json()
  }
  const login = async (hs: string, body: Record<string, unknown>): Promise<MatrixSession> => {
    const r = await f(`${hs}${API}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, initial_device_display_name: 'TrustWeb' }) })
    if (!r.ok) throw new Error(`matrix ${r.status}`)
    const j = (await r.json()) as { access_token?: string; user_id?: string; device_id?: string }
    if (!j.access_token) throw new Error('matrix: no token')
    return { hs, token: j.access_token, userId: j.user_id ?? '', ...(j.device_id ? { deviceId: j.device_id } : {}) }
  }
  return {
    /** The typed server, or the base_url its /.well-known/matrix/client names. */
    async discover(hs: string): Promise<string> {
      try { return parseWellKnown(await get(`${hs}/.well-known/matrix/client`)) ?? hs } catch { return hs }
    },
    flows: (hs: string): Promise<unknown> => get(`${hs}${API}/login`),
    loginPassword: (hs: string, user: string, password: string): Promise<MatrixSession> =>
      login(hs, { type: 'm.login.password', identifier: { type: 'm.id.user', user }, password }),
    loginToken: (hs: string, token: string): Promise<MatrixSession> => login(hs, { type: 'm.login.token', token }),
    async logout(s: MatrixSession): Promise<void> {
      await f(`${s.hs}${API}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: '{}' })
    },
    sync: (s: MatrixSession): Promise<SyncBody> =>
      get(`${s.hs}${API}/sync?timeout=0&filter=${encodeURIComponent(JSON.stringify(SYNC_FILTER))}`, s.token) as Promise<SyncBody>,
    messages: (s: MatrixSession, roomId: string): Promise<unknown> =>
      get(`${s.hs}${API}/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=30`, s.token),
  }
}
