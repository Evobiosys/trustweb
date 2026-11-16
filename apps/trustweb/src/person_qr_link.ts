// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-people-picker: the QR code on ONE person's card is made for exactly that person: the connect link plus `to=<their DID>`
 * (their local id when no DID is known yet) in the FRAGMENT, so a scan never sends it to the app host. Pure and DOM-free.
 */
const KEY = 'to'
/** Wave 44 steer-people-picker-2: the name the code was made for, so a refused scanner can say who it belongs to (the owner chose to hand the code to that person). */
const FOR = 'for'

/** `link` (may hold a fragment already) bound to one person. */
export function personQrLink(link: string, p: { id: string; did?: string; name?: string }): string {
  const q = new URLSearchParams([[KEY, p.did ?? p.id]])
  if (p.name) q.set(FOR, p.name.slice(0, 40))
  return link + (link.includes('#') ? '&' : '#') + q.toString()
}

/** The person a link was made for; null for a generic link. Never throws. */
export function personQrTarget(url: string): string | null {
  const at = url.indexOf('#')
  return at < 0 ? null : new URLSearchParams(url.slice(at + 1)).get(KEY)
}

/** The name the code was made for; '' when the code carries none. */
export function personQrFor(url: string): string {
  const at = url.indexOf('#')
  return at < 0 ? '' : new URLSearchParams(url.slice(at + 1)).get(FOR) ?? ''
}

/** A code made for ONE person (`to=<DID>`) that someone else scanned: who it was made for, else null. A local id in `to` (no DID known to the maker) cannot be checked and passes. */
export function foreignCode(url: string, ownDid: string | undefined): { name: string } | null {
  const to = personQrTarget(url)
  return to !== null && to.startsWith('did:') && to !== ownDid ? { name: personQrFor(url) } : null
}
