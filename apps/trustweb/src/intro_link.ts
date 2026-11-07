// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 33: the dedicated intro link (Jakob 2026-11-07). `<origin>/#intro=<base64url(JSON)>` carries who asks (a name), who or what they
 * want an introduction to, an optional one-line why, and optionally the asker's own connect link so the introducer can hand it on.
 * Same link family as the event link (fragment only, never reaches a server). NOT signed: connect links carry no signature either,
 * so the receiver treats the name as a claim, shown as "<name> asks you ..." and acted on only by a tap. Pure and DOM-free.
 */
import { fromBase64Url, toBase64Url } from './event_link'
import { NAME_MAX } from './zone_share_link'
import { INTRO_TARGET_MAX } from './intro_ask'

export const INTRO_WHY_MAX = 140
const MAX_RAW = 6000

export interface IntroLink { by: string; target: string; why?: string; connect?: string }

export function encodeIntroLink(origin: string, link: IntroLink): string {
  const { by, target, why, connect } = link
  return `${origin}/#intro=${toBase64Url(JSON.stringify({ by, target, ...(why ? { why } : {}), ...(connect ? { connect } : {}) }))}`
}

/** The intro in a location.hash ("#intro=..."), or null for anything missing, mangled, invalid or oversized. A non-http(s) connect link is dropped. */
export function decodeIntroLink(hash: string): IntroLink | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('intro')
  if (!raw || raw.length > MAX_RAW) return null
  try {
    const o: unknown = JSON.parse(fromBase64Url(raw))
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
    const f = o as Record<string, unknown>
    const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max).trim() : '')
    const by = text(f.by, NAME_MAX)
    const target = text(f.target, INTRO_TARGET_MAX)
    if (!by || !target) return null
    const why = text(f.why, INTRO_WHY_MAX)
    const connect = typeof f.connect === 'string' && /^https?:\/\//.test(f.connect) ? f.connect : ''
    return { by, target, ...(why ? { why } : {}), ...(connect ? { connect } : {}) }
  } catch {
    return null
  }
}

/** The message the introducer sends to the target: who asks, why, and the asker's connect link when there is one. */
export function introDraft(l: IntroLink): string {
  return `${l.by} would like to be introduced to you${l.why ? ` (${l.why})` : ''}.${l.connect ? ` Connect with ${l.by}: ${l.connect}` : ''}`
}
