// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob θ): Phanpy (MIT, github.com/cheeaun/phanpy) as an optional Mastodon client view. Pure, no DOM, no network
 * (apps/mcp loads it under plain node); in the main bundle with the stub (index.ts), the frame itself is in phanpy_body.ts.
 * Vendoring: the pinned release's dist is PHANPY_DIST_GZ_BYTES gzipped, above the 3 MB limit, and served from this app's own origin it would
 * share TrustWeb's storage; so the view frames the user's own Phanpy address (default phanpy.social), a third-party page on its own origin.
 * Phanpy logs in to the user's Mastodon instance by its own OAuth; TrustWeb stores only the address (extData.phanpy.url, absent = default).
 */
export const MODULE_ID = 'phanpy'
export const PHANPY_DEFAULT_URL = 'https://phanpy.social/'
/** The release checked for this decision (GitHub releases/latest, 2026-11-17): phanpy-dist.tar.gz = 3,408,647 bytes. */
export const PHANPY_PINNED_RELEASE = '2026.10.09.febb38d'
export const PHANPY_DIST_GZ_BYTES = 3_408_647
export const PHANPY_VENDOR_MAX_GZ = 3_000_000
export const PHANPY_VENDORED = PHANPY_DIST_GZ_BYTES <= PHANPY_VENDOR_MAX_GZ
/** Scripts and Phanpy's own storage on its own origin, its forms, and the login popup; no top navigation of TrustWeb. */
export const PHANPY_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

const HOST_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** "phanpy.social" or "https://host/path/" -> the https address; null for http, a port, credentials, no public name, or this app's own origin. */
export function parsePhanpyUrl(input: string, appOrigin: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let u: URL
  try { u = new URL(/^[a-z]+:/i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !HOST_RE.test(u.hostname) || /\.(localhost|local|internal|test|example|invalid)$/.test(u.hostname)) return null
  if (u.origin === appOrigin) return null
  return `${u.origin}${u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`}`
}

interface PhanpyData { url?: string }
type WithExt = { extData?: Record<string, unknown> }

const readPhanpy = (s: WithExt): PhanpyData => {
  const d = s.extData?.[MODULE_ID]
  const url = typeof d === 'object' && d !== null ? (d as PhanpyData).url : undefined
  return typeof url === 'string' ? { url } : {}
}

export const phanpyUrl = (s: WithExt): string => readPhanpy(s).url ?? PHANPY_DEFAULT_URL

/** Stores the address (empty or the default = nothing stored); throws a plain message for a bad one. Returns the address in force. */
export function setPhanpyUrl(s: WithExt, input: string, appOrigin: string): string {
  const url = input.trim() ? parsePhanpyUrl(input, appOrigin) : PHANPY_DEFAULT_URL
  if (!url) throw new Error('the Phanpy address must be an https address of another site')
  s.extData = { ...s.extData, [MODULE_ID]: url === PHANPY_DEFAULT_URL ? {} : { url } }
  return url
}
