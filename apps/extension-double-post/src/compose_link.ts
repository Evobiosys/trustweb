// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Pure helpers: the TrustWeb address and the #compose= deep link. The URL fragment is
// never sent to a server by the browser, so the post text stays between the two tabs.

export const DEFAULT_BASE_URL = 'https://app.trustweb.one'
export const MAX_TEXT = 2000

const LOOPBACK = new Set(['127.0.0.1', 'localhost'])

/** Origin of a TrustWeb address, or null when it is not allowed (https anywhere, http only on loopback). */
export function normalizeBaseUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return url.origin
  return null
}

/** base/#compose=<urlencoded text>&from=<site>; null when there is no text. */
export function buildComposeLink(base: string, text: string, from: string): string | null {
  if (!text.trim()) return null
  const clipped = Array.from(text).slice(0, MAX_TEXT).join('')
  return `${base}/#compose=${encodeURIComponent(clipped)}&from=${encodeURIComponent(from)}`
}
