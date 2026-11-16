// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-people-picker: the QR code on ONE person's card is made for exactly that person: the connect link plus `to=<their DID>`
 * (their local id when no DID is known yet) in the FRAGMENT, never their name, so a scan never sends it to the app host. Pure and DOM-free.
 */
const KEY = 'to'

/** `link` (may hold a fragment already) bound to one person. */
export function personQrLink(link: string, p: { id: string; did?: string }): string {
  const q = new URLSearchParams([[KEY, p.did ?? p.id]])
  return link + (link.includes('#') ? '&' : '#') + q.toString()
}

/** The person a link was made for; null for a generic link. Never throws. */
export function personQrTarget(url: string): string | null {
  const at = url.indexOf('#')
  return at < 0 ? null : new URLSearchParams(url.slice(at + 1)).get(KEY)
}

/** A code made for ONE person (`to=<DID>`) that someone else scanned: true when it is not mine. A local id in `to` (no DID known to the maker) cannot be checked and passes. */
export function foreignCode(url: string, ownDid: string | undefined): boolean {
  const to = personQrTarget(url)
  return to !== null && to.startsWith('did:') && to !== ownDid
}
