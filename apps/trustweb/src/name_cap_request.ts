// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * "Ask for more (organizers)" (wave 21): a phone that hit the three-names cap asks the steward for a higher one ahead of an event.
 * POST /names/cap-request {code, secret, name, reason, wanted} -> 202 (sent), 429 (one request per address per day). Pure of DOM and strings.
 */
import { ConnectError, postTo } from './connect_code'
import type { ConnectClientDeps, ConnectRecord } from './connect_code'
import { namesOf } from './names_sync'

export const CAP_REASON_MAX = 280
export const CAP_WANTED_MAX = 50
export const CAP_WANTED_DEFAULT = 10

export interface CapRequestBody {
  code: string
  secret: string
  name: string
  reason: string
  wanted: number
}

/** The body for the steward, lengths capped like the server caps them; null when there is no reason or the code holds no name. */
export function capRequestBody(record: ConnectRecord, reason: string, wanted: number): CapRequestBody | null {
  const text = reason.trim().slice(0, CAP_REASON_MAX)
  const name = namesOf(record).name
  if (text === '' || name === '') return null
  const count = Number.isFinite(wanted) ? Math.min(Math.max(Math.trunc(wanted), 1), CAP_WANTED_MAX) : CAP_WANTED_DEFAULT
  return { code: record.code, secret: record.secret, name, reason: text, wanted: count }
}

export type CapRequestOutcome = 'sent' | 'throttled' | 'failed'

/** Sends the request. Never throws. */
export async function sendCapRequest(deps: ConnectClientDeps, record: ConnectRecord, reason: string, wanted: number): Promise<CapRequestOutcome> {
  const body = capRequestBody(record, reason, wanted)
  if (body === null) return 'failed'
  const res = await postTo(deps, '/names/cap-request', JSON.stringify(body))
  if (res === ConnectError.Network) return 'failed'
  return res.status === 202 ? 'sent' : res.status === 429 ? 'throttled' : 'failed'
}
